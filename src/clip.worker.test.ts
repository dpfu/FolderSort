import { afterEach, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ inputDispose: vi.fn(), outputDispose: vi.fn(), infer: vi.fn(), post: vi.fn(), textLoad: vi.fn(), textInfer: vi.fn() }));
vi.mock('@huggingface/transformers', () => ({
  env: { backends: { onnx: { wasm: {} } } },
  AutoProcessor: { from_pretrained: async () => async () => ({ pixels: { dispose: runtime.inputDispose } }) },
  CLIPVisionModelWithProjection: { from_pretrained: async () => runtime.infer },
  AutoTokenizer: { from_pretrained: async () => (texts: string[]) => ({ tokens: { texts, dispose: runtime.inputDispose } }) },
  CLIPTextModelWithProjection: { from_pretrained: async (...args: unknown[]) => { runtime.textLoad(...args); return runtime.textInfer; } },
  RawImage: class {},
}));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules(); });
async function run() {
  const worker = { postMessage: runtime.post, onmessage: undefined as unknown as (event: { data: object }) => Promise<void> };
  vi.stubGlobal('self', worker); vi.stubGlobal('navigator', {});
  await import('./clip.worker');
  await worker.onmessage({ data: { kind: 'pixels', requestId: 1, id: 'one', width: 1, height: 1, pixels: new Uint8ClampedArray(4) } });
}
it('releases input tensors even when inference fails before producing output', async () => {
  runtime.infer.mockRejectedValue(new Error('Inference failed'));
  await run();
  expect(runtime.inputDispose).toHaveBeenCalledOnce();
  expect(runtime.post).toHaveBeenCalledWith({ requestId: 1, error: 'Inference failed', stage: 'inference' });
});
it('releases both input and output tensors after saving a successful embedding', async () => {
  const vector = new Float32Array(512); vector[0] = 1;
  runtime.infer.mockResolvedValue({ image_embeds: { data: vector, dispose: runtime.outputDispose } });
  await run();
  expect(runtime.inputDispose).toHaveBeenCalledOnce(); expect(runtime.outputDispose).toHaveBeenCalledOnce();
  expect(runtime.post).toHaveBeenCalledWith(expect.objectContaining({ requestId: 1, result: expect.objectContaining({ vector: expect.any(String) }) }));
});

it('preloads the matching text model on initialization, and reuses query embeddings', async () => {
  const worker = { postMessage: runtime.post, onmessage: undefined as unknown as (event: { data: object }) => Promise<void> };
  vi.stubGlobal('self', worker); vi.stubGlobal('navigator', {});
  const { CLIP_MODEL, CLIP_REVISION, packVector } = await import('./contentSimilarity');
  const vector = new Float32Array(512); vector[0] = 1;
  runtime.textInfer.mockResolvedValue({ text_embeds: { data: vector, dispose: runtime.outputDispose } });
  await import('./clip.worker');
  await worker.onmessage({ data: { kind: 'init', requestId: 1 } });
  expect(runtime.textLoad).toHaveBeenCalledWith(CLIP_MODEL, expect.objectContaining({ revision: CLIP_REVISION, dtype: 'q8', device: 'wasm' }));
  expect(runtime.textInfer).not.toHaveBeenCalled();
  await worker.onmessage({ data: { kind: 'cache', requestId: 2, images: [{ id: 'one', clip: packVector(vector) }] } });
  for (const requestId of [3, 4]) await worker.onmessage({ data: { kind: 'search', requestId, candidates: ['one'], query: 'handshakes', limit: 3 } });
  expect(runtime.textInfer).toHaveBeenCalledOnce();
  expect(runtime.post).toHaveBeenCalledWith({ requestId: 4, result: [{ id: 'one', referenceId: '', distance: 0 }] });
  expect(runtime.inputDispose).toHaveBeenCalledOnce(); expect(runtime.outputDispose).toHaveBeenCalledOnce();
});

it('bounds folder-label inference to one prompt, including when WebGPU is available', async () => {
  const worker = { postMessage: runtime.post, onmessage: undefined as unknown as (event: { data: object }) => Promise<void> };
  vi.stubGlobal('self', worker); vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } });
  const vector = new Float32Array(512); vector[0] = 1;
  runtime.textInfer.mockImplementation(async ({ tokens }) => {
    expect(tokens.texts).toHaveLength(1);
    return { text_embeds: { data: vector, dispose: runtime.outputDispose } };
  });
  const { packVector } = await import('./contentSimilarity');
  await import('./clip.worker');
  await worker.onmessage({ data: { kind: 'cache', requestId: 1, images: [{ id: 'one', clip: packVector(vector) }] } });
  const labels = Array.from({ length: 12 }, (_, index) => `Label ${index}`);
  await worker.onmessage({ data: { kind: 'labels', requestId: 2, references: ['one'], labels, limit: 3 } });
  expect(runtime.textLoad).toHaveBeenCalledOnce();
  expect(runtime.textLoad).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ dtype: 'q8', device: 'wasm' }));
  expect(runtime.textInfer).toHaveBeenCalledTimes(12);
  expect(runtime.inputDispose).toHaveBeenCalledTimes(12); expect(runtime.outputDispose).toHaveBeenCalledTimes(12);
  expect(runtime.post).toHaveBeenCalledWith({ requestId: 2, result: expect.any(Array) });
});

it('reports a failed quantized load without allocating an fp32 text fallback', async () => {
  const worker = { postMessage: runtime.post, onmessage: undefined as unknown as (event: { data: object }) => Promise<void> };
  vi.stubGlobal('self', worker); vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } });
  runtime.textLoad.mockImplementationOnce(() => { throw new Error('Not enough memory'); });
  await import('./clip.worker');
  await worker.onmessage({ data: { kind: 'init', requestId: 1 } });
  expect(runtime.textLoad).toHaveBeenCalledOnce();
  expect(runtime.post).toHaveBeenCalledWith({ requestId: 1, error: 'Not enough memory', stage: 'model' });
});
