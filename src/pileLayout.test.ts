import { describe, expect, it } from 'vitest';
import { arrangeBoardBatch, pileGeometry, visiblePileRange } from './pileLayout';

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
