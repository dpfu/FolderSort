/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useProjectLibrary } from './useProjectLibrary';
import type { LibraryImage } from './libraryStore';
const mocks = vi.hoisted(() => ({ images: vi.fn(), projects: vi.fn() }));
vi.mock('./libraryStore', () => ({
  getActiveProjectId: async () => undefined, listProjects: mocks.projects, listImages: mocks.images,
  listCategories: async (id: string) => [{ id: `${id}-stash`, projectId: id, name: id, createdAt: 1 }],
}));
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; };
const image = (projectId: string, id = projectId): LibraryImage => ({ id, projectId, path: id + '.png', mime: 'image/png', size: 1, addedAt: 1, categoryId: null });
beforeEach(() => { vi.clearAllMocks(); mocks.projects.mockResolvedValue([]); });
afterEach(cleanup);
it('keeps a late read or refresh from the previous project out of the current collection', async () => {
  const a = deferred<LibraryImage[]>(), b = deferred<LibraryImage[]>();
  mocks.images.mockImplementation(id => id === 'a' ? a.promise : b.promise);
  const { result } = renderHook(() => useProjectLibrary(vi.fn()));
  act(() => result.current.selectProject('a'));
  await waitFor(() => expect(mocks.images).toHaveBeenCalledWith('a'));
  act(() => result.current.selectProject('b'));
  await waitFor(() => expect(mocks.images).toHaveBeenCalledWith('b'));
  let oldRefresh!: Promise<unknown>;
  act(() => { oldRefresh = result.current.refresh('a'); });
  await waitFor(() => expect(mocks.images).toHaveBeenCalledTimes(3));
  await act(async () => { b.resolve([image('b')]); });
  expect(result.current.images).toEqual([image('b')]);
  await act(async () => { a.resolve([image('a')]); await oldRefresh; });
  expect(result.current.images).toEqual([image('b')]);
  expect(result.current.categories[0].projectId).toBe('b');
});
it('discards an older read of the same project when a newer refresh finishes first', async () => {
  const older = deferred<LibraryImage[]>();
  mocks.images.mockReturnValueOnce(older.promise).mockResolvedValue([image('a', 'latest')]);
  const { result } = renderHook(() => useProjectLibrary(vi.fn()));
  act(() => result.current.selectProject('a'));
  await waitFor(() => expect(mocks.images).toHaveBeenCalledTimes(1));
  await act(async () => { await result.current.refresh('a'); });
  await act(async () => { older.resolve([image('a', 'stale')]); });
  expect(result.current.images).toEqual([image('a', 'latest')]);
});
