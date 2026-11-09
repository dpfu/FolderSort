// @vitest-environment jsdom
import { expect, it, beforeEach } from 'vitest';
import { folderTree, visibleFolders, folderAncestors } from './folderTree';
import { readFolderSidebar } from './useFolderSidebar';
import type { LibraryCategory } from './libraryStore';

const folder = (id: string, name: string): LibraryCategory => ({ id, name, projectId: 'project', createdAt: 1 });
const categories = [folder('root', 'Research'), folder('other', 'Research notes'), folder('leaf', 'Research/Hands/Details'), folder('child', 'research/Hands'), folder('empty', 'Research/Empty')];

it('builds the saved hierarchy case-insensitively, including empty folders, without mixing similarly named roots', () => {
  const tree = folderTree(categories);
  expect(tree.map(node => node.folder.id)).toEqual(['root', 'other']);
  expect(tree[0].children.map(node => node.folder.id)).toEqual(['empty', 'child']);
  expect(tree[0].children[1].children[0].folder.id).toBe('leaf');
  expect(categories[2].name).toBe('Research/Hands/Details');
});
it('expansion affects only visible rows; the active path includes the complete ancestry', () => {
  const tree = folderTree(categories);
  expect(visibleFolders(tree, new Set()).map(row => row.node.folder.id)).toEqual(['root', 'other']);
  expect(visibleFolders(tree, new Set(['root', 'child'])).map(row => [row.node.folder.id, row.depth])).toEqual([
    ['root', 0], ['empty', 1], ['child', 1], ['leaf', 2], ['other', 0],
  ]);
  expect(folderAncestors(categories, 'leaf')).toEqual(['root', 'leaf', 'child']);
  expect(folderAncestors(categories, null)).toEqual([]);
});
it('keeps an imported folder visible if an older project is missing its parent record', () => {
  expect(visibleFolders(folderTree([folder('orphan', 'Missing/Child')]), new Set()).map(row => row.node.folder.id)).toEqual(['orphan']);
});
beforeEach(() => localStorage.clear());
it('starts collapsed, isolates project preferences, and tolerates malformed presentation state', () => {
  expect(readFolderSidebar('new')).toEqual({ open: false, width: 260, expanded: [] });
  localStorage.setItem('folder-sort-folder-sidebar:new', JSON.stringify({ open: true, width: 900, expanded: ['root', 'root', 42] }));
  expect(readFolderSidebar('new')).toEqual({ open: true, width: 340, expanded: ['root'] });
  expect(readFolderSidebar('different').open).toBe(false);
  localStorage.setItem('folder-sort-folder-sidebar:new', '{');
  expect(readFolderSidebar('new')).toEqual({ open: false, width: 260, expanded: [] });
});
