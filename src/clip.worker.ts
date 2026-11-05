import { CLIP_MODEL, CLIP_REVISION, CLIP_DIMENSIONS, contentMatches, contentOrder, textMatches, labelMatches, normalizeVector, packVector, unpackVector, type ClipJob, type ClipProgress, type EmbeddedImage } from './contentSimilarity';
import { AutoProcessor, AutoTokenizer, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, RawImage, env, type Tensor } from '@huggingface/transformers';

// Use hardware acceleration when available, otherwise a single CPU thread. Both
// run outside the UI and work without cross-origin isolation on GitHub Pages.
// Both encoders use the same pinned checkpoint and fp32 projection space.
// Browser Cache Storage keeps the downloaded weights/tokenizer across sessions.
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;
const runtime = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/';
if (env.backends.onnx.webgpu) env.backends.onnx.webgpu.powerPreference = 'low-power';

const vectors = new Map<string, Float32Array>();
type Runtime = { processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>; model: CLIPVisionModelWithProjection; device: 'webgpu' | 'wasm' };
let modelPromise: Promise<Runtime> | null = null;
type TextRuntime = { tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>; model: CLIPTextModelWithProjection; device: Runtime['device'] };
let textModelPromise: Promise<TextRuntime> | null = null;
const textVectors = new Map<string, Float32Array>();
let inference: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = inference.then(task); inference = next.catch(() => {}); return next;
}
let gpuFailed = false;
let lastPercent = -1;
let lastProgressAt = -Infinity;
const progress = (value: ClipProgress) => self.postMessage({ progress: value });
function loadModel() {
  if (!modelPromise) {
    progress({ phase: 'loading' });
    const options = { revision: CLIP_REVISION, progress_callback: (event: { status: string; file?: string; progress?: number }) => {
      if (event.status === 'progress' && event.file?.endsWith('.onnx') && event.progress !== undefined) {
        const percent = Math.floor(event.progress);
        if (percent !== lastPercent && (performance.now() - lastProgressAt > 250 || percent === 100)) {
          lastPercent = percent; lastProgressAt = performance.now(); progress({ phase: 'loading', percent });
        }
      }
    } };
    modelPromise = (async () => {
      const gpu = (navigator as typeof navigator & { gpu?: { requestAdapter: (options: { powerPreference: string }) => Promise<{ isFallbackAdapter?: boolean; info?: { isFallbackAdapter?: boolean } } | null> } }).gpu;
      const adapter = !gpuFailed && gpu ? await gpu.requestAdapter({ powerPreference: 'low-power' }).catch(() => null) : null;
      let device: Runtime['device'] = adapter && !adapter.isFallbackAdapter && !adapter.info?.isFallbackAdapter ? 'webgpu' : 'wasm';
      if (device === 'wasm' && !gpuFailed) env.backends.onnx.wasm!.wasmPaths = {
        mjs: `${runtime}ort-wasm-simd-threaded.mjs`, wasm: `${runtime}ort-wasm-simd-threaded.wasm`,
      };
      const processor = await AutoProcessor.from_pretrained(CLIP_MODEL, options);
      let model;
      try { model = await CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL, { ...options, dtype: 'fp32', device }); }
      catch (cause) {
        if (device !== 'webgpu') throw cause;
        gpuFailed = true; device = 'wasm';
        model = await CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL, { ...options, dtype: 'fp32', device });
      }
      progress({ phase: 'ready' });
      return { processor, model, device };
    })();
  }
  return modelPromise;
}

function loadTextModel(): Promise<TextRuntime> {
  if (!textModelPromise) textModelPromise = (async () => {
    const vision = await loadModel();
    progress({ phase: 'loading', model: 'text' });
    let percent = -1, at = -Infinity;
    const options = { revision: CLIP_REVISION, progress_callback: (event: { status: string; file?: string; progress?: number }) => {
      const next = Math.floor(event.progress || 0);
      if (event.status === 'progress' && event.file?.endsWith('.onnx') && next !== percent && (performance.now() - at > 250 || next === 100)) {
        percent = next; at = performance.now(); progress({ phase: 'loading', model: 'text', percent });
      }
    } };
    const tokenizer = await AutoTokenizer.from_pretrained(CLIP_MODEL, options);
    let device = vision.device, model;
    try { model = await CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL, { ...options, dtype: 'fp32', device }); }
    catch (cause) {
      if (device !== 'webgpu') throw cause;
      device = 'wasm';
      model = await CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL, { ...options, dtype: 'fp32', device });
    }
    progress({ phase: 'ready', model: 'text' });
    return { tokenizer, model, device };
  })().catch(cause => { textModelPromise = null; throw cause; });
  return textModelPromise;
}

async function encodeTexts(texts: string[]): Promise<Float32Array[]> {
  const missing = [...new Set(texts)].filter(text => !textVectors.has(text));
  for (let offset = 0; offset < missing.length; offset += 8) {
    const batch = missing.slice(offset, offset + 8);
    await serial(async () => {
      let runtime = await loadTextModel();
      const inputs = runtime.tokenizer(batch, { padding: 'max_length', truncation: true });
      let output: { text_embeds: Tensor } | undefined;
      try {
        try { output = await runtime.model(inputs) as { text_embeds: Tensor }; }
        catch (cause) {
          if (runtime.device !== 'webgpu') throw cause;
          await runtime.model.dispose();
          runtime = { ...runtime, device: 'wasm', model: await CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL, { revision: CLIP_REVISION, dtype: 'fp32', device: 'wasm' }) };
          textModelPromise = Promise.resolve(runtime);
          output = await runtime.model(inputs) as { text_embeds: Tensor };
        }
        const data = output.text_embeds.data as Float32Array;
        if (data.length !== batch.length * CLIP_DIMENSIONS) throw new Error('Unexpected CLIP text embedding size');
        batch.forEach((text, index) => textVectors.set(text, normalizeVector(data.subarray(index * CLIP_DIMENSIONS, (index + 1) * CLIP_DIMENSIONS))));
      } finally {
        for (const tensor of Object.values(inputs)) (tensor as Tensor).dispose();
        for (const tensor of Object.values(output || {})) tensor.dispose();
      }
    });
  }
  const result = texts.map(text => textVectors.get(text)!);
  // A bounded, session-only query cache; weights themselves are saved by Transformers.js.
  while (textVectors.size > 256) textVectors.delete(textVectors.keys().next().value!);
  return result;
}

async function readImage(blob: Blob): Promise<RawImage> {
  const bitmap = await createImageBitmap(blob);
  try {
    // Never copy an original-sized RGBA array to JS. Preprocessing is bounded to
    // 512 px, preserving aspect ratio and compositing transparency onto white.
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Image canvas unavailable');
    context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return new RawImage(context.getImageData(0, 0, width, height).data, width, height, 4);
  } finally { bitmap.close(); }
}

function embedded(ids: string[]): EmbeddedImage[] {
  return ids.flatMap((id) => { const vector = vectors.get(id); return vector ? [{ id, vector }] : []; });
}

self.onmessage = async (event: MessageEvent<ClipJob & { requestId: number }>) => {
  const job = event.data;
  let stage = 'model';
  try {
    let result = null;
    if (job.kind === 'init') await loadTextModel();
    else if (job.kind === 'cache') { for (const image of job.images) vectors.set(image.id, unpackVector(image.clip)); }
    else if (job.kind === 'order') result = contentOrder(embedded(job.ids));
    else if (job.kind === 'similar') result = contentMatches(embedded(job.candidates), embedded(job.references), job.limit);
    else if (job.kind === 'search') {
      stage = 'text';
      const query = job.query.trim();
      result = query ? textMatches(embedded(job.candidates), (await encodeTexts([query]))[0], job.limit) : [];
    }
    else if (job.kind === 'labels') {
      stage = 'text';
      const labels = [...new Set(job.labels)].slice(0, 160);
      const embeddings = await encodeTexts(labels.map(label => `a photo of ${label.toLocaleLowerCase()}`));
      result = labelMatches(embedded(job.references), labels.map((label, index) => ({ label, vector: embeddings[index] })), job.limit);
    }
    else {
      result = await serial(async () => {
      let runtime = await loadModel();
      stage = 'image';
      const image = job.kind === 'pixels' ? new RawImage(job.pixels, job.width, job.height, 4) : await readImage(job.blob);
      stage = 'inference';
      const inputs = await runtime.processor(image);
      let output: { image_embeds: Tensor } | undefined;
      try {
        try { output = await runtime.model(inputs) as { image_embeds: Tensor }; }
        catch (cause) {
          if (runtime.device !== 'webgpu') throw cause;
          // Some browsers expose WebGPU but fail on an operation or lose their
          // device. Keep the same fp32 embeddings and retry on the worker CPU.
          gpuFailed = true;
          await runtime.model.dispose(); modelPromise = null;
          runtime = await loadModel();
          output = await runtime.model(inputs) as { image_embeds: Tensor };
        }
        const vector = normalizeVector(output.image_embeds.data as Float32Array);
        vectors.set(job.id, vector);
        return packVector(vector);
      } finally {
        for (const tensor of Object.values(inputs)) if (tensor instanceof Object && 'dispose' in tensor) (tensor as Tensor).dispose();
        for (const tensor of Object.values(output || {})) tensor.dispose();
      }
      });
    }
    self.postMessage({ requestId: job.requestId, result });
  } catch (cause) {
    self.postMessage({ requestId: job.requestId, error: cause instanceof Error ? cause.message : String(cause), stage });
  }
};
