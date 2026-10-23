/** @vitest-environment jsdom */
import * as React from 'react';
import 'fake-indexeddb/auto';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useActionHistory, type ProjectAction } from './useActionHistory';
import { useBoardActions } from './useBoardActions';
import { restoreStashAnchor, useBoardPreferences } from './useBoardPreferences';
import { filterBrowserImages, readImageBrowserView, browserGeometry } from './imageBrowserView';
import { fitBoardView } from './stashView';
import { addImages, createCategory, createProject, listImages, saveImageMetadata, type LibraryImage, type LibraryCategory } from './libraryStore';

afterEach(() => { cleanup(); localStorage.clear(); });
const image = (id: string, categoryId: string | null, placement: 'board' | 'tray' = 'tray'): LibraryImage => ({ id, projectId: 'p', path: `${id}.png`, mime: 'image/png', size: 1, addedAt: 1, categoryId, placement });
const stashes: LibraryCategory[] = ['Parent', 'Parent/Child', 'Other'].map((name, index) => ({ id: String(index), name, projectId: 'p', createdAt: 1 }));

it('keeps assignment filters independent of board placement and includes nested stashes', () => {
  const images = [image('a', null, 'board'), image('b', '0'), image('c', '1'), image('d', '2', 'board')];
  const view = { filter: 'all' as const, stash: 'all', onBoard: false, query: '' };
  expect(filterBrowserImages(images, stashes, new Set(['a', 'd']), { ...view, filter: 'unsorted' }).map(image => image.id)).toEqual(['a']);
  expect(filterBrowserImages(images, stashes, new Set(['a', 'd']), { ...view, filter: 'sorted' }).map(image => image.id)).toEqual(['b', 'c', 'd']);
  expect(filterBrowserImages(images, stashes, new Set(), { ...view, stash: '0' }).map(image => image.id)).toEqual(['b', 'c']);
  expect(filterBrowserImages(images, stashes, new Set(['a', 'd']), { ...view, onBoard: true }).map(image => image.id)).toEqual(['a', 'd']);
  expect(filterBrowserImages(images, stashes, new Set(), { ...view, query: 'child' }).map(image => image.id)).toEqual(['c']);
  expect(images.map(image => image.categoryId)).toEqual([null, '0', '1', '2']);
});

it('recovers malformed preferences and computes a scrollable bounded grid for 3000 images', () => {
  localStorage.setItem('folder-sort-browser:p', '{broken');
  expect(readImageBrowserView('p').filter).toBe('all');
  localStorage.setItem('folder-sort-browser:p', JSON.stringify({ width: 9999, size: -10, filter: 'missing', focus: 9 }));
  expect(readImageBrowserView('p')).toMatchObject({ width: 560, size: 72, filter: 'all', focus: 0 });
  const grid = browserGeometry(344, 96, 3000);
  expect(grid.columns).toBe(3);
  expect(grid.imageWidth * grid.columns + 12 * (grid.columns - 1) + grid.padding * 2).toBeCloseTo(344);
  expect(grid.rowHeight).toBeGreaterThan(grid.imageHeight + 24);
  expect(grid.height).toBeGreaterThan(grid.imageHeight * 1000);
});

it('updates legacy browser defaults while retaining intentional sizing and filters', () => {
  localStorage.setItem('folder-sort-browser:p', JSON.stringify({ width: 344, size: 96, filter: 'sorted', query: 'test' }));
  expect(readImageBrowserView('p')).toMatchObject({ size: 120, filter: 'sorted', query: 'test' });
  expect(readImageBrowserView('p').width).toBeGreaterThan(344);
  localStorage.setItem('folder-sort-browser:p', JSON.stringify({ version: 2, width: 344, size: 96 }));
  expect(readImageBrowserView('p')).toMatchObject({ width: 344, size: 96 });
  localStorage.setItem('folder-sort-browser:p', JSON.stringify({ width: 400, size: 144 }));
  expect(readImageBrowserView('p')).toMatchObject({ width: 400, size: 144 });
});

it('restores stash anchors in a new workspace instance without replacing other anchors or projects', () => {
  const first = renderHook(() => useBoardPreferences('p'));
  act(() => first.result.current[1](current => ({ ...current, anchors: { a: { x: 40, y: 80 }, b: { x: 200, y: 80 } } })));
  first.unmount();
  const reopened = renderHook(() => useBoardPreferences('p'));
  const other = renderHook(() => useBoardPreferences('other'));
  act(() => restoreStashAnchor('p', 'a', { x: 24, y: 80 }));
  expect(reopened.result.current[0].anchors).toEqual({ a: { x: 24, y: 80 }, b: { x: 200, y: 80 } });
  expect(other.result.current[0].anchors).toEqual({});
  reopened.unmount();
  act(() => restoreStashAnchor('p', 'a', { x: 8, y: 80 }));
  expect(renderHook(() => useBoardPreferences('p')).result.current[0].anchors.a).toEqual({ x: 8, y: 80 });
});

const action = (projectId: string, message: string): ProjectAction => ({ projectId, kind: 'layout', label: 'Undo move', message, detail: '', restored: '', restore: async () => {} });
it('undoes batched edits in order, rejects stale async records and ends history on project switch', () => {
  const { result, rerender } = renderHook(({ id }) => useActionHistory(id), { initialProps: { id: 'a' } });
  act(() => { result.current.remember(action('a', 'first')); result.current.remember(action('a', 'second')); });
  expect(result.current.current?.message).toBe('second');
  act(() => result.current.pop(result.current.current!.id));
  expect(result.current.current?.message).toBe('first');
  rerender({ id: 'b' });
  act(() => { result.current.remember(action('a', 'late')); result.current.invalidateFrom(0); });
  expect(result.current.current).toBeNull();
  act(() => result.current.remember(action('b', 'new')));
  rerender({ id: 'a' }); expect(result.current.current).toBeNull();
});

it('has no history before a project exists and rejects writes for another project', () => {
  const { result } = renderHook(() => useActionHistory());
  expect(result.current.current).toBeNull();
  act(() => result.current.remember(action('foreign', 'late')));
  expect(result.current.current).toBeNull();
});

it('restores rapid layout and folder moves in order, preserving persisted analysis metadata', async () => {
  const project = await createProject('History');
  await addImages(project.id, [{ path: 'a.png', file: new File(['image'], 'a.png', { type: 'image/png' }) }]);
  const initial = await listImages(project.id);
  const { result } = renderHook(() => {
    const [images, setImages] = React.useState(initial), [saving, setSaving] = React.useState(0);
    const history = useActionHistory(project.id);
    const actions = useBoardActions({ projectId: project.id, images, setImages, onSaving: setSaving,
      onRefresh: async () => setImages(await listImages(project.id)), onMessage: () => {}, onError: cause => { throw new Error(cause); }, remember: history.remember, invalidateFrom: history.invalidateFrom });
    return { images, saving, history, actions, async undo() { const entry = history.current!; await entry.restore(); setImages(await listImages(project.id)); history.pop(entry.id); } };
  });
  act(() => { result.current.actions.place([{ id: initial[0].id, x: 100, y: 200, boardScope: null }]); result.current.actions.place([{ id: initial[0].id, x: 400, y: 500, boardScope: null }]); });
  await waitFor(() => expect(result.current.saving).toBe(0));
  expect((await listImages(project.id))[0].boardX).toBe(400);
  const visual = { version: 1, width: 320, height: 160, hash: '0123456789abcdef' };
  await saveImageMetadata(project.id, [{ id: initial[0].id, visual }]);
  await act(async () => { await result.current.undo(); });
  expect(result.current.images[0]).toMatchObject({ boardX: 100, boardY: 200, visual });
  const folder = await createCategory(project.id, 'Destination');
  act(() => result.current.actions.place([{ id: initial[0].id, x: 32, y: 120, boardScope: folder.id }]));
  await waitFor(() => expect(result.current.saving).toBe(0));
  expect(result.current.images[0].categoryId).toBe(folder.id);
  expect((await listImages(project.id))[0].categoryId).toBe(folder.id);
  await act(async () => { await result.current.undo(); });
  expect(result.current.images[0]).toMatchObject({ placement: 'board', boardX: 100, boardY: 200, visual });
  await act(async () => { await result.current.undo(); });
  expect(result.current.images[0].placement).toBe(initial[0].placement);
  expect(result.current.history.current).toBeNull();
});

it('fits distant images and stashes without mutating their coordinates', () => {
  const items = [{ x: 100, y: 200, width: 172, height: 172 }, { x: 3500, y: 1800, width: 236, height: 248 }];
  const copy = structuredClone(items), view = fitBoardView(items, 900, 700);
  expect(view.zoom).toBeLessThan(.45);
  for (const item of items) {
    expect((item.x - view.x) * view.zoom + 450).toBeGreaterThanOrEqual(31);
    expect((item.x + item.width - view.x) * view.zoom + 450).toBeLessThanOrEqual(869);
  }
  expect(items).toEqual(copy);
});
