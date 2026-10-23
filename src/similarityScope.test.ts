import { expect, it } from 'vitest';
import { similarityCandidates } from './similarityScope';
import type { LibraryImage } from './libraryStore';

const images = [null, null, 'Plants', 'Travel', 'Plants/Details'].map((categoryId, i) => ({ id: String(i), categoryId } as LibraryImage));
it('Root finds existing unsorted images without taking images out of stashes', () => {
  expect(similarityCandidates(images, null, new Set(['0']), true).map(image => image.id)).toEqual(['1']);
});
it('stash matching excludes its own members and other stashes until explicitly included', () => {
  expect(similarityCandidates(images, 'Plants', new Set(['2'])).map(image => image.id)).toEqual(['0', '1']);
  expect(similarityCandidates(images, 'Plants', new Set(['2']), true).map(image => image.id)).toEqual(['0', '1', '3', '4']);
});
