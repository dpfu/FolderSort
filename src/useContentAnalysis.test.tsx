/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useContentAnalysis } from './useContentAnalysis';
import type { LibraryImage } from './libraryStore';
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), analyze: vi.fn(), dispose: vi.fn() }));
vi.mock('./libraryStore', () => ({
  clearContentAnalysis: vi.fn(), getImageBlob: async () => new Blob(['image'], { type: 'image/png' }),
  imageIsOnBoard: () => false, listImages: mocks.read, saveImageMetadata: mocks.save,
}));
vi.mock('./clipClient', () => ({
  ClipError: class ClipError extends Error { constructor(message: string, readonly stage: string) { super(message); } },
  ClipClient: class {
    cache = async () => {}; initialize = async () => {}; analyze = mocks.analyze; dispose = mocks.dispose;
  },
}));
const images: LibraryImage[] = [{ id: 'one', projectId: 'p', path: 'one.png', categoryId: null, mime: 'image/png', size: 1, addedAt: 1 }];
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue([]); mocks.save.mockResolvedValue(undefined); mocks.analyze.mockResolvedValue({ model: 'test', vector: 'embedding' }); });
afterEach(cleanup);
it('reports a failed index write and recomputes unsaved embeddings on retry', async () => {
  mocks.save.mockRejectedValueOnce(new Error('Storage full'));
  const { result } = renderHook(() => useContentAnalysis(images));
  await waitFor(() => expect(result.current.progress.phase).toBe('error'));
  expect(result.current.progress.done).toBe(0);
  expect(result.current.progress.error).toContain('Storage full');
  await act(async () => { await result.current.start(); });
  expect(result.current.progress.phase).toBe('ready');
  expect(result.current.progress.done).toBe(1);
  expect(mocks.analyze).toHaveBeenCalledTimes(2);
  expect(mocks.save).toHaveBeenCalledTimes(2);
});
it('can retry a failed cache read instead of retaining a rejected hydration promise', async () => {
  mocks.read.mockRejectedValueOnce(new Error('Temporary read failure'));
  const { result } = renderHook(() => useContentAnalysis(images));
  await waitFor(() => expect(result.current.progress.phase).toBe('error'));
  await act(async () => { await result.current.start(); });
  expect(result.current.progress.phase).toBe('ready');
  expect(mocks.analyze).toHaveBeenCalledTimes(1);
});
