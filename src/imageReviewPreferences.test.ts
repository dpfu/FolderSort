// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { readImageReviewPreferences, reviewDestinationKey, reviewKey, updateImageReviewPreferences } from './imageReviewPreferences';
beforeEach(() => localStorage.clear());
it('keeps printable letters, digits and symbols while reserving navigation and composing keys', () => {
  for (const value of ['ArrowLeft', 'Enter', 'Escape', ' ', '\t', 'Dead', 'Process', '\u0000']) expect(reviewKey(value)).toBeUndefined();
  expect(reviewKey('H')).toBe('h'); expect(reviewKey('+')).toBe('+'); expect(reviewKey('0')).toBe('0'); expect(reviewKey('e\u0301')).toBe('é');
  expect(reviewDestinationKey('staging')).not.toBe(reviewDestinationKey(null));
});
it('opens the reviewer tree by default and validates independent per-project bindings', () => {
  expect(readImageReviewPreferences('new')).toEqual({ open: true, nextAfterMove: false, expanded: [], shortcuts: {} });
  localStorage.setItem('folder-sort-image-review:study', JSON.stringify({ nextAfterMove: true, expanded: ['a', 'a', 2], shortcuts: { 'folder:a': 'H', 'folder:b': 'h', staging: '+', ignored: 'q', 'folder:c': 'Enter' } }));
  expect(readImageReviewPreferences('study')).toEqual({ open: true, nextAfterMove: true, expanded: ['a'], shortcuts: { 'folder:a': 'h', staging: '+' } });
  expect(readImageReviewPreferences('other').shortcuts).toEqual({});
  localStorage.setItem('folder-sort-image-review:broken', '{'); expect(readImageReviewPreferences('broken').open).toBe(true);
});
it('saves presentation preferences without refilling cleared shortcuts or changing project data', () => {
  updateImageReviewPreferences('clear-test', state => ({ ...state, shortcuts: { 'folder:id': 'h' } }));
  updateImageReviewPreferences('clear-test', state => ({ ...state, shortcuts: {} }));
  expect(readImageReviewPreferences('clear-test').shortcuts).toEqual({});
  expect(Object.keys(localStorage)).toEqual(['folder-sort-image-review:clear-test']);
});
