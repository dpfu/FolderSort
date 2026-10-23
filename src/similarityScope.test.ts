import { expect, it } from 'vitest';
import { similarityCandidates, similarityReferences } from './similarityScope';
import type { LibraryImage } from './libraryStore';

const images = [null, null, 'Plants', 'Travel', 'Plants/Details'].map((categoryId, i) => ({ id: String(i), categoryId } as LibraryImage));
it('Root board-wide searches leave candidates even in small collections', () => {
  for (const size of [0, 1, 2, 3, 5, 6, 12]) {
    const root = Array.from({ length: size }, (_, i) => ({ id: String(i), categoryId: null } as LibraryImage));
    const references = similarityReferences(root, null);
    expect(references).toHaveLength(Math.min(5, Math.max(0, size - 1)));
    if (size > 1) expect(similarityCandidates(root, null, new Set(references.map(image => image.id))).length).toBeGreaterThan(0);
  }
  expect(similarityReferences(images, null, '0').map(image => image.id)).toEqual(['0']);
  expect(similarityReferences(images, 'Plants').map(image => image.id)).toEqual(['2']);
});
it('Root finds existing unsorted images without taking images out of stashes', () => {
  expect(similarityCandidates(images, null, new Set(['0']), true).map(image => image.id)).toEqual(['1']);
});
it('stash matching excludes its own members and other stashes until explicitly included', () => {
  expect(similarityCandidates(images, 'Plants', new Set(['2'])).map(image => image.id)).toEqual(['0', '1']);
  expect(similarityCandidates(images, 'Plants', new Set(['2']), true).map(image => image.id)).toEqual(['0', '1', '3', '4']);
});
