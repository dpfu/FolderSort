// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { decodeImage } from './decodeImage';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function decoder() {
  const images: HTMLImageElement[] = [];
  vi.stubGlobal('Image', function () { const image = document.createElement('img'); images.push(image); return image; });
  const revoke = vi.fn(); vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: revoke });
  return { images, revoke };
}
it('releases a pending decode on abort and ignores its later load', async () => {
  const { images, revoke } = decoder(), abort = new AbortController();
  const pending = decodeImage(new Blob(), abort.signal), late = images[0].onload;
  abort.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(revoke).toHaveBeenCalledOnce(); expect(images[0].onload).toBeNull();
  late?.call(images[0], new Event('load')); expect(revoke).toHaveBeenCalledOnce();
});
it('retains a successful decode until its owner releases it, exactly once', async () => {
  const { images, revoke } = decoder(); const pending = decodeImage(new Blob());
  images[0].dispatchEvent(new Event('load')); const decoded = await pending;
  expect(revoke).not.toHaveBeenCalled(); decoded.release(); decoded.release(); expect(revoke).toHaveBeenCalledOnce();
});
it('releases a stalled decode after the existing timeout', async () => {
  vi.useFakeTimers(); const { revoke } = decoder(), pending = decodeImage(new Blob());
  const rejected = expect(pending).rejects.toThrow('Image cannot be decoded');
  await vi.advanceTimersByTimeAsync(15000); await rejected; expect(revoke).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
