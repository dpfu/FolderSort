import { expect, it } from 'vitest';
import { categoryCounts, emptyStashIds, imageInCategoryBranch } from './categoryTree';
import type { LibraryCategory, LibraryImage } from './libraryStore';

it('counts nested assignments once per ancestor and keeps similarly named branches distinct', () => {
  const categories = [
    { id: 'a', name: 'Theme' }, { id: 'b', name: 'Theme/Detail' },
    { id: 'c', name: 'Theme/Detail/Close' }, { id: 'd', name: 'Themes' },
  ] as LibraryCategory[];
  const images = [
    { categoryId: 'a' }, { categoryId: 'c' }, { categoryId: 'c' }, { categoryId: 'd' }, { categoryId: null },
  ] as LibraryImage[];
  const counts = categoryCounts(images, categories);
  expect([...counts]).toEqual([['a', 3], ['b', 2], ['c', 2], ['d', 1], ['unassigned', 1]]);
  const names = new Map(categories.map(category => [category.id, category.name]));
  expect(imageInCategoryBranch(images[3], 'a', names)).toBe(false);
});

it('offers deletion only for empty leaves, including when a parent contains an empty sub-stash', () => {
  const categories = [{ id: 'a', name: 'Parent' }, { id: 'b', name: 'Parent/Empty' },
    { id: 'c', name: 'Full' }, { id: 'd', name: 'Unused' }] as LibraryCategory[];
  expect([...emptyStashIds([{ categoryId: 'c' }, { categoryId: null }] as LibraryImage[], categories)]).toEqual(['b', 'd']);
});
