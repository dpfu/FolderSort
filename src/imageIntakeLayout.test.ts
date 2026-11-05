import { expect, it } from 'vitest';
import { placeInPlaceBatch } from './imageIntakeLayout';

it('keeps a small group beside its reference with integer positions ready to save', () => {
  const reference = { x: 100, y: 100 };
  expect(placeInPlaceBatch(['a', 'b', 'c'], { x: 0, y: 0, width: 1000, height: 800 }, reference)).toEqual([
    { id: 'a', x: 292, y: 100 }, { id: 'b', x: 484, y: 100 }, { id: 'c', x: 676, y: 100 },
  ]);
  expect(reference).toEqual({ x: 100, y: 100 });
});

it('keeps large batches in a narrow visible area by allowing overlaps instead of extending the board', () => {
  const view = { x: 520, y: 310, width: 360, height: 300 };
  const ids = Array.from({ length: 24 }, (_, i) => String(i));
  const moves = placeInPlaceBatch(ids, view, { x: 800, y: 550 });
  expect(moves).toHaveLength(24);
  for (const move of moves) {
    expect(Number.isInteger(move.x) && Number.isInteger(move.y)).toBe(true);
    expect(move.x).toBeGreaterThanOrEqual(520); expect(move.x + 172).toBeLessThanOrEqual(880);
    expect(move.y).toBeGreaterThanOrEqual(310); expect(move.y + 172).toBeLessThanOrEqual(610);
  }
  expect(placeInPlaceBatch([], view)).toEqual([]);
});


it('leaves the centres of a small first batch exposed when full-width cards just miss a row', () => {
  const moves = placeInPlaceBatch(['a', 'b'], { x: 0, y: 42, width: 315, height: 247 });
  expect(moves[0].y).toBe(moves[1].y);
  expect(moves[1].x).toBeGreaterThan(moves[0].x + 86);
  expect(moves[1].x + 172).toBeLessThanOrEqual(315);
});
