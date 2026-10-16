/** @vitest-environment jsdom */
import { StrictMode } from 'react';
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
  await waitFor(() => expect(mocks.images).toHaveBeenCalledTimes(2));
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
it('does not let a refresh started before a newer refresh replace the newer project list', async () => {
  const older = deferred<Array<{ id: string; name: string; createdAt: number; updatedAt: number }>>();
  mocks.images.mockResolvedValue([image('a')]);
  const { result } = renderHook(() => useProjectLibrary(vi.fn()));
  act(() => result.current.selectProject('a'));
  await waitFor(() => expect(mocks.images).toHaveBeenCalledTimes(1));
  mocks.projects.mockReturnValueOnce(older.promise).mockResolvedValue([{ id: 'a', name: 'Latest name', createdAt: 1, updatedAt: 3 }]);
  let first!: Promise<unknown>;
  act(() => { first = result.current.refresh(); });
  await act(async () => { await result.current.refresh(); });
  await act(async () => { older.resolve([{ id: 'a', name: 'Old name', createdAt: 1, updatedAt: 1 }]); await first; });
  expect(result.current.projects[0].name).toBe('Latest name');
});
it('keeps a local board update when an older collection read finishes afterwards', async () => {
  const older = deferred<LibraryImage[]>();
  mocks.images.mockReturnValue(older.promise);
  const { result } = renderHook(() => useProjectLibrary(vi.fn()));
  act(() => result.current.selectProject('a'));
  await waitFor(() => expect(mocks.images).toHaveBeenCalledTimes(1));
  const moved = { ...image('a'), boardX: 640, boardY: 320 };
  act(() => result.current.setImages([moved]));
  await act(async () => { older.resolve([image('a')]); });
  expect(result.current.images).toEqual([moved]);
});
it('keeps an optimistic settings update over an older project-list refresh', async () => {
  mocks.images.mockResolvedValue([image('a')]);
  const older = deferred<Array<{ id: string; name: string; createdAt: number; updatedAt: number }>>();
  const { result } = renderHook(() => useProjectLibrary(vi.fn()));
  act(() => result.current.selectProject('a'));
  await waitFor(() => expect(mocks.images).toHaveBeenCalledTimes(1));
  mocks.projects.mockReturnValueOnce(older.promise);
  let read!: Promise<unknown>;
  act(() => { read = result.current.refresh(); });
  act(() => result.current.setProjects([{ id: 'a', name: 'Current', createdAt: 1, updatedAt: 3, settings: { clipEnabled: false } }]));
  await act(async () => { older.resolve([{ id: 'a', name: 'Old', createdAt: 1, updatedAt: 1 }]); await read; });
  expect(result.current.projects[0].settings?.clipEnabled).toBe(false);
});
it('keeps the new project in the list when its initial collection load starts during refresh', async () => {
  mocks.images.mockResolvedValue([]);
  const { result } = renderHook(() => useProjectLibrary(vi.fn()));
  const project = { id: 'new', name: 'New project', createdAt: 1, updatedAt: 1 };
  const pending = deferred<typeof project[]>();
  mocks.projects.mockReturnValueOnce(pending.promise);
  let read!: Promise<unknown>;
  act(() => { result.current.selectProject(project.id); read = result.current.refresh(project.id); });
  expect(mocks.images).not.toHaveBeenCalled();
  await act(async () => { pending.resolve([project]); await read; });
  expect(mocks.images).toHaveBeenCalledExactlyOnceWith(project.id);
  expect(result.current.projects).toContainEqual(project);
});
it('loads the selected project under development Strict Mode effect replay', async () => {
  const project = { id: 'strict', name: 'Strict project', createdAt: 1, updatedAt: 1 };
  mocks.projects.mockResolvedValue([project]); mocks.images.mockResolvedValue([image(project.id)]);
  const error = vi.fn();
  const { result } = renderHook(() => useProjectLibrary(error), { wrapper: ({ children }) => <StrictMode>{children}</StrictMode> });
  await waitFor(() => expect(result.current.images).toEqual([image(project.id)]));
  expect(result.current.activeId).toBe(project.id);
  expect(result.current.projects).toEqual([project]); expect(error).not.toHaveBeenCalled();
});
