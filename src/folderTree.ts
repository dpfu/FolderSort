import type { LibraryCategory } from './libraryStore';
import { parentPath } from './stashGeometry';
import { compareNames } from './sortNames';

export type FolderTreeNode = { folder: LibraryCategory; children: FolderTreeNode[] };
export type FolderTreeRow = { node: FolderTreeNode; depth: number };

/** The existing saved paths own the hierarchy; the sidebar stores no membership. */
export function folderTree(categories: LibraryCategory[]): FolderTreeNode[] {
  const nodes = new Map(categories.map(folder => [folder.name.toLocaleLowerCase(), { folder, children: [] } as FolderTreeNode]));
  const roots: FolderTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(parentPath(node.folder.name).toLocaleLowerCase());
    (parent?.children || roots).push(node);
  }
  const sort = (siblings: FolderTreeNode[]) => {
    siblings.sort((a, b) => compareNames(a.folder.name, b.folder.name));
    siblings.forEach(node => sort(node.children));
  };
  sort(roots);
  return roots;
}

export function visibleFolders(roots: FolderTreeNode[], expanded: ReadonlySet<string>, depth = 0): FolderTreeRow[] {
  return roots.flatMap(node => [{ node, depth }, ...(expanded.has(node.folder.id) ? visibleFolders(node.children, expanded, depth + 1) : [])]);
}

export function folderAncestors(categories: LibraryCategory[], id: string | null): string[] {
  const current = categories.find(folder => folder.id === id)?.name.toLocaleLowerCase();
  return current ? categories.filter(folder => current === folder.name.toLocaleLowerCase() || current.startsWith(folder.name.toLocaleLowerCase() + '/')).map(folder => folder.id) : [];
}
