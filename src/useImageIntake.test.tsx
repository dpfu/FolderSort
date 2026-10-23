/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useImageIntake, type BoardMove } from './useImageIntake';
import type { CategoryBoardGroup } from './categoryBoard';
import type { LibraryImage } from './libraryStore';

afterEach(cleanup);

it('frames an unobstructed first batch beside a fitted stash and delegates a move into the destination folder', () => {
  const pane = document.createElement('div'), board = document.createElement('div'), canvas = document.createElement('div');
  canvas.dataset.testid = 'board-canvas'; board.append(canvas);
  pane.getBoundingClientRect = () => new DOMRect(0, 0, 500, 350);
  canvas.getBoundingClientRect = () => new DOMRect(200, 100, 10000, 10000);
  const groups: CategoryBoardGroup[] = [{ id: 'stash', name: 'Study', x: 32, y: 48, width: 200, height: 196, ids: [], expanded: false }];
  const original = structuredClone(groups);
  const images: LibraryImage[] = ['a', 'b', 'c'].map(id => ({ id, projectId: 'p', path: `${id}.jpg`, mime: 'image/jpeg', size: 1, addedAt: 1, categoryId: 'source', placement: 'board' }));
  const onPlace = vi.fn<(moves: BoardMove[]) => void>(), onFrame = vi.fn();
  const { result } = renderHook(() => useImageIntake({ images, scopeId: null, zoom: 1, pane: { current: pane }, board: { current: board }, cards: [], groups, onPlace, onFrame }));
  act(() => { expect(result.current.add(['a', 'b', 'c'])).toBe(3); });
  const moves = onPlace.mock.calls[0][0], camera = onFrame.mock.calls[0][0];
  const rectangles = [...groups, ...moves.map(move => ({ ...move, width: 172, height: 172 }))];
  for (const [index, rect] of rectangles.entries()) {
    expect(rectangles.slice(0, index).some(other => rect.x < other.x + other.width && rect.x + rect.width > other.x && rect.y < other.y + other.height && rect.y + rect.height > other.y)).toBe(false);
    expect((rect.x - camera.x) * camera.zoom + 250).toBeGreaterThanOrEqual(31);
    expect((rect.x + rect.width - camera.x) * camera.zoom + 250).toBeLessThanOrEqual(469);
    expect((rect.y - camera.y) * camera.zoom + 175).toBeGreaterThanOrEqual(31);
    expect((rect.y + rect.height - camera.y) * camera.zoom + 175).toBeLessThanOrEqual(319);
  }
  expect(groups).toEqual(original);
  expect(images.every(image => image.categoryId === 'source' && image.placement === 'board')).toBe(true);
});
