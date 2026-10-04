import { expect, it } from 'vitest';
import { categoryMarkdown, categorySystem } from './categoryExport';
import type { LibraryCategory, LibraryImage } from './libraryStore';

it('exports an ordered nested tree with distinct direct and branch counts, including empty categories', () => {
  const categories = [{ id: 'child', name: 'Scenes/Detail' }, { id: 'other', name: 'Scenes 2' },
    { id: 'root', name: 'Scenes' }, { id: 'empty', name: 'Scenes/Unused' }] as LibraryCategory[];
  const images = [{ categoryId: 'child' }, { categoryId: 'child' }, { categoryId: 'root' },
    { categoryId: 'other' }, { categoryId: null }, { categoryId: 'deleted' }] as LibraryImage[];
  const system = categorySystem('Study', categories, images);
  expect(system).toMatchObject({ format: 'folder-sort-categories', version: 1, project: 'Study', imageCount: 6, unassignedImageCount: 2 });
  expect(system.categories).toEqual([
    { name: 'Scenes', path: 'Scenes', imageCount: 1, totalImageCount: 3, children: [
      { name: 'Detail', path: 'Scenes/Detail', imageCount: 2, totalImageCount: 2, children: [] },
      { name: 'Unused', path: 'Scenes/Unused', imageCount: 0, totalImageCount: 0, children: [] },
    ] },
    { name: 'Scenes 2', path: 'Scenes 2', imageCount: 1, totalImageCount: 1, children: [] },
  ]);
  expect(categoryMarkdown(system)).toContain('- Scenes — 1 image\n  - Detail — 2 images\n  - Unused — 0 images\n- Scenes 2 — 1 image');
  expect(categories[0].id).toBe('child');
});

it('keeps literal Markdown names and synthesizes missing ancestors without losing nested assignments', () => {
  const system = categorySystem('Study [draft]\n# heading', [{ id: 'a', name: 'One/**bold**/<img>' }] as LibraryCategory[], [{ categoryId: 'a' }] as LibraryImage[]);
  expect(system.categories[0].totalImageCount).toBe(1);
  expect(system.categories[0].children[0].children[0].imageCount).toBe(1);
  const markdown = categoryMarkdown(system);
  expect(markdown).toContain('# Study \\[draft\\] \\# heading — categories');
  expect(markdown).toContain('  - \\*\\*bold\\*\\* — 0 images\n    - \\<img\\> — 1 image');
  expect(categoryMarkdown(categorySystem('Empty', [], []))).toContain('No categories yet.');
});
