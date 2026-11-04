import { expect, it } from 'vitest';
import { placeSimilarImages, placeSuggestionGroup } from './similarityLayout';

const overlap = (a: { x: number; y: number; width?: number; height?: number }, b: { x: number; y: number; width?: number; height?: number }) =>
  a.x < b.x + (b.width || 172) && a.x + (a.width || 172) > b.x && a.y < b.y + (b.height || 172) && a.y + (a.height || 172) > b.y;

it('places a match beside its reference without moving existing images', () => {
  const positions = new Map([['reference', { x: 100, y: 100 }]]);
  expect(placeSimilarImages([{ id: 'match', referenceId: 'reference' }], positions, [], { left: 0, right: 900, top: 0, bottom: 600 })).toEqual([{ id: 'match', x: 292, y: 100 }]);
  expect(positions.get('reference')).toEqual({ x: 100, y: 100 });
});

it('extends a crowded view without covering existing images, other matches or a subfolder', () => {
  const positions = new Map([['reference', { x: 20, y: 20 }], ['other', { x: 212, y: 20 }]]);
  const folder = { x: 20, y: 212, width: 390, height: 244 };
  const matches = Array.from({ length: 6 }, (_, index) => ({ id: `match-${index}`, referenceId: 'reference' }));
  const moves = placeSimilarImages(matches, positions, [folder], { left: 0, right: 410, top: 0, bottom: 410 });
  const obstacles = [...positions.values(), folder];
  for (const [index, move] of moves.entries()) {
    expect([...obstacles, ...moves.slice(0, index)].some(other => overlap(move, other))).toBe(false);
    expect(move.x).toBeGreaterThanOrEqual(0); expect(move.y).toBeGreaterThanOrEqual(0);
  }
  expect(moves.some(move => move.y + 172 > 410)).toBe(true);
});

it('previews a row beside its reference and wraps a narrow group without changing image positions', () => {
  const positions = new Map([['reference', { x: 100, y: 100 }]]);
  expect(placeSuggestionGroup(['a', 'b', 'c'], 'reference', positions, [], 4)).toEqual([
    { id: 'a', x: 292, y: 100 }, { id: 'b', x: 484, y: 100 }, { id: 'c', x: 676, y: 100 },
  ]);
  expect(placeSuggestionGroup(['a', 'b', 'c'], 'reference', positions, [], 2)).toEqual([
    { id: 'a', x: 292, y: 100 }, { id: 'b', x: 100, y: 292 }, { id: 'c', x: 292, y: 292 },
  ]);
  expect(positions.get('reference')).toEqual({ x: 100, y: 100 });
});

it('keeps a suggestion group clear of images and whole nested folder tiles', () => {
  const positions = new Map([['reference', { x: 20, y: 20 }], ['neighbor', { x: 212, y: 20 }]]);
  const folder = { x: 20, y: 212, width: 600, height: 300 };
  const original = structuredClone([...positions]);
  const moves = placeSuggestionGroup(['a', 'b', 'c'], 'reference', positions, [folder], 4);
  for (const [index, move] of moves.entries()) {
    expect([...positions.values(), folder, ...moves.slice(0, index)].some(other => overlap(move, other))).toBe(false);
    expect(move.x).toBeGreaterThanOrEqual(0); expect(move.y).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(move.x) && Number.isInteger(move.y)).toBe(true);
  }
  expect([...positions]).toEqual(original);
});
