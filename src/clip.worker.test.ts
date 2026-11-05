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
  expect(runtime.textLoad).toHaveBeenCalledWith(CLIP_MODEL, expect.objectContaining({ revision: CLIP_REVISION, dtype: 'fp32' }));
  expect(runtime.textInfer).not.toHaveBeenCalled();
  await worker.onmessage({ data: { kind: 'cache', requestId: 2, images: [{ id: 'one', clip: packVector(vector) }] } });
  for (const requestId of [3, 4]) await worker.onmessage({ data: { kind: 'search', requestId, candidates: ['one'], query: 'handshakes', limit: 3 } });
  expect(runtime.textInfer).toHaveBeenCalledOnce();
  expect(runtime.post).toHaveBeenCalledWith({ requestId: 4, result: [{ id: 'one', referenceId: '', distance: 0 }] });
  expect(runtime.inputDispose).toHaveBeenCalledOnce(); expect(runtime.outputDispose).toHaveBeenCalledOnce();
});
