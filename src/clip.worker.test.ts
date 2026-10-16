import { afterEach, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ inputDispose: vi.fn(), outputDispose: vi.fn(), infer: vi.fn(), post: vi.fn() }));
vi.mock('@huggingface/transformers', () => ({
  env: { backends: { onnx: { wasm: {} } } },
  AutoProcessor: { from_pretrained: async () => async () => ({ pixels: { dispose: runtime.inputDispose } }) },
  CLIPVisionModelWithProjection: { from_pretrained: async () => runtime.infer },
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
