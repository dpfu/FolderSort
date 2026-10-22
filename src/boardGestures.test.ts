import { expect, it } from 'vitest';
import { anchorBoardGesture, moveBoardGesture } from './boardGestures';

it('keeps an off-center world point under a moving pinch midpoint at every zoom limit', () => {
  const view = { scale: .8, centerX: 3400, centerY: 2500, viewportW: 390, viewportH: 335 };
  const anchor = anchorBoardGesture(view, { x: 115, y: 90 });
  for (const factor of [.001, .5, 1.7, 1000]) {
    const point = { x: 140, y: 120 }, moved = moveBoardGesture(anchor, point, factor);
    expect(moved.scale).toBeGreaterThanOrEqual(.05); expect(moved.scale).toBeLessThanOrEqual(2);
    expect((anchor.world.x - moved.centerX) * moved.scale + view.viewportW / 2).toBeCloseTo(point.x);
    expect((anchor.world.y - moved.centerY) * moved.scale + view.viewportH / 2).toBeCloseTo(point.y);
  }
  expect(view.centerX).toBe(3400);
});

it('pans without changing scale and recovers invalid gesture scale values', () => {
  const view = { scale: 1.25, centerX: -200, centerY: 120, viewportW: 900, viewportH: 600 };
  const anchor = anchorBoardGesture(view, { x: 300, y: 200 });
  for (const factor of [undefined, NaN, Infinity, -1, 0]) {
    expect(moveBoardGesture(anchor, { x: 350, y: 175 }, factor)).toEqual({ scale: 1.25, centerX: -240, centerY: 140 });
  }
});
