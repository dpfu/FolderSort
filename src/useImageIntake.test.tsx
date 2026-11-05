/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useImageIntake, type BoardMove } from './useImageIntake';
import type { CategoryBoardGroup } from './categoryBoard';
import type { LibraryImage } from './libraryStore';

afterEach(cleanup);

it('adds in the current view on a crowded board without changing existing images or folder anchors', () => {
  const pane = document.createElement('div'), board = document.createElement('div'), canvas = document.createElement('div');
  canvas.dataset.testid = 'board-canvas'; board.append(canvas);
  pane.getBoundingClientRect = () => new DOMRect(0, 0, 500, 350);
  canvas.getBoundingClientRect = () => new DOMRect(-300, -200, 10000, 10000);
  const cards = [{ id: 'existing', x: 400, y: 300 }];
  const groups: CategoryBoardGroup[] = [{ id: 'folder', name: 'Study', x: 320, y: 220, width: 450, height: 300, ids: [], expanded: false }];
  const images: LibraryImage[] = ['existing', 'a', 'b', 'c'].map(id => ({ id, projectId: 'p', path: id + '.jpg', mime: 'image/jpeg', size: 1, addedAt: 1, categoryId: null, rootOnBoard: id === 'existing', placement: 'board' }));
  const before = structuredClone({ cards, groups, images }), onPlace = vi.fn<(moves: BoardMove[]) => void>();
  const { result } = renderHook(() => useImageIntake({ images, scopeId: null, zoom: 1, bottomInset: 64, pane: { current: pane }, board: { current: board }, cards, groups, onPlace }));
  act(() => { expect(result.current.add(['existing', 'a', 'a', 'b', 'c'])).toBe(3); });
  const moves = onPlace.mock.calls[0][0];
  expect(moves.map(move => move.id)).toEqual(['a', 'b', 'c']);
  for (const move of moves) {
    expect(move.x - 300).toBeGreaterThanOrEqual(20);
    expect(move.x + 172 - 300).toBeLessThanOrEqual(480);
    expect(move.y - 200).toBeGreaterThanOrEqual(20);
    expect(move.y + 172 - 200).toBeLessThanOrEqual(266);
    expect(result.current.dealOrigins.get(move.id)).toMatchObject({ x: move.x, y: move.y, inPlace: true });
  }
  expect({ cards, groups, images }).toEqual(before);
});
