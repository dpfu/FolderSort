import { describe, expect, it } from 'vitest';
import { arrangeBoardBatch, arrangeVisibleBatch, visibleStripIndices, pileGeometry, visiblePileRange, type BoardBounds } from './pileLayout';

describe('large pile layout', () => {
  it('covers the viewport with bounded overscan at the start, middle and end', () => {
    const geometry = pileGeometry(1280, 160, 'mess', 3000);
    for (const top of [0, geometry.height / 2, geometry.height - 600]) {
      const range = visiblePileRange(3000, geometry, top, 600);
      expect(range.end - range.first).toBeLessThan(100);
      expect(range.first).toBeGreaterThanOrEqual(0);
      expect(range.end).toBeLessThanOrEqual(3000);
      expect(geometry.padding + Math.floor(range.first / geometry.columns) * geometry.rowHeight).toBeLessThanOrEqual(top + geometry.padding);
    }
    expect(visiblePileRange(0, geometry, 500, 600)).toEqual({ first: 0, end: 0 });
  });

  it('places a large batch without overlapping existing images or each other', () => {
    const existing = [{ x: 35, y: 43 }, { x: 204, y: 223 }, { x: 217, y: 15 }];
    const moves = arrangeBoardBatch(Array.from({ length: 3000 }, (_, i) => String(i)), existing, { x: 16, y: 16 }, 8);
    expect(moves).toHaveLength(3000);
    expect(new Set(moves.map(move => `${move.x},${move.y}`)).size).toBe(3000);
    for (const move of moves) {
      expect(existing.every(point => Math.abs(move.x - point.x) >= 182 || Math.abs(move.y - point.y) >= 182)).toBe(true);
      expect(move.x).toBeGreaterThanOrEqual(0); expect(move.y).toBeLessThan(100_000);
    }
    // Neighbours in a batch are spaced exactly enough to preserve image edges.
    const cells = new Set(moves.map(move => `${Math.round((move.x - 16) / 192)},${Math.round((move.y - 16) / 192)}`));
    expect(cells.size).toBe(3000);
  });
});

describe('visible intake batches', () => {
  const overlaps = (a: BoardBounds, b: BoardBounds) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  it('avoids images and stash stacks, including after panning far from the origin', () => {
    const view = { x: 3200, y: 2400, width: 1100, height: 650 };
    const occupied = [{ x: 3500, y: 2570, width: 236, height: 248 }, { x: 3900, y: 2480, width: 172, height: 172 }];
    const result = arrangeVisibleBatch(['a','b','c','d','e'], occupied, view);
    result.forEach((move, index) => {
      const rect = { ...move, width: 172, height: 172 };
      expect(move.x).toBeGreaterThanOrEqual(view.x); expect(move.y).toBeGreaterThanOrEqual(view.y);
      expect(move.x + 172).toBeLessThanOrEqual(view.x + view.width); expect(move.y + 172).toBeLessThanOrEqual(view.y + view.height);
      expect(occupied.some(other => overlaps(rect, other))).toBe(false);
      expect(result.slice(0, index).some(other => overlaps(rect, { ...other, width: 172, height: 172 }))).toBe(false);
    });
  });
  it('keeps every image visible on a narrow or completely full board', () => {
    for (const view of [{ x: 0, y: 0, width: 300, height: 280 }, { x: 16, y: 40, width: 500, height: 400 }]) {
      const result = arrangeVisibleBatch(['a','b','c','d','e'], [view], view);
      expect(result).toHaveLength(5);
      result.forEach(move => {
        expect(move.x).toBeGreaterThanOrEqual(view.x); expect(move.y).toBeGreaterThanOrEqual(view.y);
        expect(move.x + 172).toBeLessThanOrEqual(view.x + view.width); expect(move.y + 172).toBeLessThanOrEqual(view.y + view.height);
      });
    }
  });
  it('keeps stash targets clear when a crowded board requires images to overlap', () => {
    const view = { x: 24, y: 140, width: 1232, height: 283 };
    const stash = { x: 522, y: 117, width: 236, height: 248, protected: true };
    const result = arrangeVisibleBatch(['a','b','c','d','e'], [stash], view);
    expect(result.some(move => overlaps({ ...move, width: 172, height: 172 }, stash))).toBe(false);
  });
});


it('strip virtualization matches a full scan with moved, offscreen and pinned images', () => {
  const count = 3000, ids = new Map(Array.from({ length: count }, (_, index) => [`photo-${index}`, index]));
  const moved = new Map([['photo-4', { x: 3500 }], ['photo-2500', { x: 120 }], ['photo-2900', { x: 3400 }]]);
  for (const step of [44, 68, 146]) for (const left of [-280, 0, 350, 3400, 100000, 500000]) {
    const right = left + 1440, pinned = ['photo-2999', 'photo-4'];
    const expected = [...ids].filter(([id, index]) => {
      const x = moved.get(id)?.x ?? 26 + index * step;
      return x + 112 >= left && x <= right || pinned.includes(id);
    }).map(([, index]) => index);
    expect(visibleStripIndices(count, step, 112, left, right, moved, ids, pinned)).toEqual(expected);
  }
  expect(visibleStripIndices(3, 68, 112, 1000, 2000, moved, ids, [])).toEqual([0, 1, 2]);
});
