// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useImageAnalysis } from './useImageAnalysis';
import type { LibraryImage } from './libraryStore';
const store = vi.hoisted(() => ({ listImages: vi.fn(), getImageBlob: vi.fn(), saveImageMetadata: vi.fn() }));
vi.mock('./libraryStore', () => store);
it('re-reads durable metadata after a failed flush rather than reporting unsaved dates as complete', async () => {
  const image = { id: 'a', projectId: 'p' } as LibraryImage;
  store.listImages.mockResolvedValue([image]); store.getImageBlob.mockResolvedValue(new File(['test'], 'a.jpg', { lastModified: 1234 }));
  store.saveImageMetadata.mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined);
  const { result, unmount } = renderHook(() => useImageAnalysis([image]));
  await act(async () => { await expect(result.current.ensure('dates')).rejects.toThrow('Disk full'); });
  expect(result.current.progress.running).toBe(false);
  await act(async () => { await result.current.ensure('dates'); });
  expect(store.listImages).toHaveBeenCalledTimes(2); expect(store.saveImageMetadata).toHaveBeenCalledTimes(2);
  expect(result.current.metadata.get('a')?.fileModifiedAt).toBe(1234); unmount();
});
