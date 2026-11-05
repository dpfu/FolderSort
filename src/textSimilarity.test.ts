import { expect, it } from 'vitest';
import { labelMatches, normalizeVector, textMatches } from './contentSimilarity';
const vector = (x: number, y = 0) => { const value = new Float32Array(512); value[0] = x; value[1] = y; return normalizeVector(value); };
it('ranks image matches against text with cosine similarity and preserves tie order', () => {
  const images = [{ id: 'hands', vector: vector(1) }, { id: 'tree', vector: vector(0, 1) }, { id: 'greeting', vector: vector(1) }];
  expect(textMatches(images, vector(1), 2).map(match => match.id)).toEqual(['hands', 'greeting']);
  expect(textMatches(images, vector(1), 0)).toEqual([]);
});
it('ranks names using every image rather than the single best matching image', () => {
  const images = [{ id: 'one', vector: vector(1) }, { id: 'two', vector: vector(0, 1) }];
  const labels = [{ label: 'Shared', vector: vector(1, 1) }, { label: 'Only first', vector: vector(1) }];
  expect(labelMatches(images, labels, 3).map(match => match.label)).toEqual(['Shared', 'Only first']);
  expect(labelMatches([], labels, 3)).toEqual([]);
});
