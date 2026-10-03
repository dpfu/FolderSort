import { CLIP_MODEL, CLIP_REVISION, contentMatches, contentOrder, normalizeVector, packVector, unpackVector, type ClipJob, type ClipProgress, type EmbeddedImage } from './contentSimilarity';
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage, env, type Tensor } from '@huggingface/transformers';

// Use hardware acceleration when available, otherwise a single CPU thread. Both
// run outside the UI and work without cross-origin isolation on GitHub Pages.
// MobileCLIP's image-only fp32 model is 45.5 MB; no text model loads.
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;
const runtime = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/';
if (env.backends.onnx.webgpu) env.backends.onnx.webgpu.powerPreference = 'low-power';

const vectors = new Map<string, Float32Array>();
type Runtime = { processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>; model: CLIPVisionModelWithProjection; device: 'webgpu' | 'wasm' };
let modelPromise: Promise<Runtime> | null = null;
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
    if (job.kind === 'init') await loadModel();
    else if (job.kind === 'cache') { for (const image of job.images) vectors.set(image.id, unpackVector(image.clip)); }
    else if (job.kind === 'order') result = contentOrder(embedded(job.ids));
    else if (job.kind === 'similar') result = contentMatches(embedded(job.candidates), embedded(job.references), job.limit);
    else {
      let runtime = await loadModel();
      stage = 'image';
      const image = job.kind === 'pixels' ? new RawImage(job.pixels, job.width, job.height, 4) : await readImage(job.blob);
      stage = 'inference';
      const inputs = await runtime.processor(image);
      let output: { image_embeds: Tensor };
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
      try {
        const vector = normalizeVector(output.image_embeds.data as Float32Array);
        vectors.set(job.id, vector);
        result = packVector(vector);
      } finally {
        for (const tensor of Object.values(inputs)) if (tensor instanceof Object && 'dispose' in tensor) (tensor as Tensor).dispose();
        for (const tensor of Object.values(output)) tensor.dispose();
      }
    }
    self.postMessage({ requestId: job.requestId, result });
  } catch (cause) {
    self.postMessage({ requestId: job.requestId, error: cause instanceof Error ? cause.message : String(cause), stage });
  }
};
