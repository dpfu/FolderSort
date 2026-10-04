import { expect, it } from 'vitest';
import { boardExportGeometry, fittedBoardImage, type BoardSnapshot } from './boardExport';
import type { CardData } from './types';
import type { CategoryBoardGroup } from './categoryBoard';

const snapshot: BoardSnapshot = { mode: 'free', cards: [], groups: [], scope: 'view', view: { centerX: 1200.25, centerY: 600.5, scale: .7, viewportW: 1000, viewportH: 500 } };

it('captures the exact visible camera at fractional zoom and pan, at double screen resolution', () => {
  const result = boardExportGeometry(snapshot);
  expect(result.width).toBe(2000); expect(result.height).toBe(1000);
  expect(result.bounds.x).toBeCloseTo(1200.25 - 1000 / .7 / 2);
  expect(result.bounds.y).toBeCloseTo(600.5 - 500 / .7 / 2);
  expect(result.reduced).toBe(false);
});

it('includes distant layout cards and group headers without exporting an enormous unused world', () => {
  const cards = [{ x: 100, y: 180 }, { x: 2400, y: 600 }] as CardData[];
  const groups = [{ x: 375, y: 124, width: 236, height: 280 }] as CategoryBoardGroup[];
  const result = boardExportGeometry({ ...snapshot, cards, groups, scope: 'all' });
  expect(result.bounds).toEqual({ x: 68, y: 92, width: 2536, height: 712 });
  expect(result.width).toBe(5072); expect(result.height).toBe(1424);
});

it('caps both canvas area and the longest edge for thousands of spread-out images', () => {
  for (const [x, y] of [[90000, 90000], [100, 90000], [90000, 100]]) {
    const result = boardExportGeometry({ ...snapshot, scope: 'all', cards: [{ x: 0, y: 0 }, { x, y }] as CardData[] });
    expect(result.width * result.height).toBeLessThanOrEqual(12_000_000);
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(8192);
    expect(result.reduced).toBe(true);
  }
  expect(boardExportGeometry({ ...snapshot, scope: 'all' }).width).toBeGreaterThan(0);
});

it('fits landscape and portrait photos without a square card border', () => {
  expect(fittedBoardImage({ x: 100, y: 200 }, 1024, 768)).toEqual({ x: 100, y: 221.5, width: 172, height: 129 });
  expect(fittedBoardImage({ x: 100, y: 200 }, 768, 1024)).toEqual({ x: 121.5, y: 200, width: 129, height: 172 });
});
