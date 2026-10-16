/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImageThumbnailCache } from './imageThumbnails';
import { useThumbnailUrls } from './useThumbnailUrls';
const storage = vi.hoisted(() => ({ thumbnail: vi.fn() }));
vi.mock('./libraryStore', () => ({ getImageThumbnail: storage.thumbnail, getImageBlob: vi.fn(), saveImageThumbnail: vi.fn() }));
let cache: ImageThumbnailCache;
const renders = new Map<string, number>();
function Photo({ id }: { id: string }) {
  useThumbnailUrls(cache, [id]);
  renders.set(id, (renders.get(id) || 0) + 1);
  return <span data-testid={id}>{cache.urls.get(id) || (cache.failed.has(id) ? 'failed' : 'waiting')}</span>;
}
beforeEach(() => {
  cache = new ImageThumbnailCache(); renders.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  URL.createObjectURL = vi.fn(() => 'blob:thumbnail'); URL.revokeObjectURL = vi.fn();
  storage.thumbnail.mockReset().mockResolvedValue(new Blob(['cached']));
});
afterEach(() => { cleanup(); cache.dispose(); vi.unstubAllGlobals(); });
it('loading a thumbnail updates its photo without rerendering unrelated images', async () => {
  render(<><Photo id="one" /><Photo id="two" /></>);
  cache.setVisible(['one']);
  await waitFor(() => expect(screen.getByTestId('one').textContent).toBe('blob:thumbnail'));
  expect(renders.get('two')).toBe(1);
  expect(storage.thumbnail).toHaveBeenCalledExactlyOnceWith('one');
});
it('notifies the affected photo on failures and cache eviction', async () => {
  storage.thumbnail.mockRejectedValueOnce(new Error('Missing thumbnail'));
  render(<><Photo id="bad" /><Photo id="removed" /></>);
  cache.setVisible(['bad']);
  await waitFor(() => expect(screen.getByTestId('bad').textContent).toBe('failed'));
  cache.urls.set('removed', 'blob:old');
  // Change the photo subscription once so it observes this seeded retained URL.
  cleanup(); render(<Photo id="removed" />);
  expect(screen.getByTestId('removed').textContent).toBe('blob:old');
  for (let index = 0; index < 241; index++) cache.urls.set(`retained-${index}`, `blob:${index}`);
  cache.setVisible([]);
  await waitFor(() => expect(screen.getByTestId('removed').textContent).toBe('waiting'));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:old');
});
