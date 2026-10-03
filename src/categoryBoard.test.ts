import { describe, expect, it } from 'vitest';
import { categoryBoardLayout, translateCategory } from './categoryBoard';
import type { LibraryImage } from './libraryStore';

const categories = [{ id: 'a', name: 'Nature', projectId: 'p', createdAt: 1 }, { id: 'b', name: 'Nature/Trees', projectId: 'p', createdAt: 2 }, { id: 'c', name: 'People', projectId: 'p', createdAt: 3 }];
const image = (id: string, categoryId: string | null, boardX = 200, boardY = 200): LibraryImage => ({ id, categoryId, boardX, boardY, projectId: 'p', path: `${id}.png`, placement: 'board', mime: 'image/png', size: 1, addedAt: 1 });

describe('category board views', () => {
  it('collapses thousands of images to three previews, keeps nested categories distinct, and preserves source positions', () => {
    const images = Array.from({ length: 3000 }, (_, i) => image(String(i), 'b', i * 8, i * 10));
    images.push(image('pending', null));
    const before = JSON.stringify(images);
    const layout = categoryBoardLayout(images, categories, 'stacks', 1126, {}, new Set(), '25');
    expect(layout.groups.map(group => group.ids.length)).toEqual([0, 3000, 0]);
    expect(layout.visibleIds.size).toBe(4);
    expect(layout.visibleIds.has('25')).toBe(true);
    expect(layout.height).toBeLessThan(1500);
    expect(JSON.stringify(images)).toBe(before);
    const expanded = categoryBoardLayout(images, categories, 'stacks', 390, {}, new Set(['b']));
    expect(expanded.visibleIds.size).toBe(3001);
    expect([...expanded.positions.values()].every(point => point.x >= 0 && point.y >= 0 && point.x < 100000 && point.y < 100000)).toBe(true);
  });
  it('moves a category rigidly at board bounds and leaves other categories alone', () => {
    const images = [image('1', 'a', 40, 60), image('2', 'a', 260, 180), image('3', 'b', 400, 320)];
    const moved = translateCategory(images, ['1', '2'], { x: -100, y: -200 });
    expect(moved).toEqual([{ id: '1', x: 0, y: 0 }, { id: '2', x: 220, y: 120 }]);
    expect(translateCategory(images, ['1', '2'], { x: 100001, y: 0 }).at(-1)?.x).toBe(100000);
    expect(translateCategory(images, [], { x: 10, y: 10 })).toEqual([]);
  });
});
