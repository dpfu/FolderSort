import type { LibraryCategory } from './imageStore';
import { parentPath } from './stashGeometry';

export const inFolderSubtree = (folder: LibraryCategory, ancestor: LibraryCategory) =>
  folder.id === ancestor.id || folder.name.toLocaleLowerCase().startsWith(`${ancestor.name.toLocaleLowerCase()}/`);

export function folderParentId(folder: LibraryCategory, categories: LibraryCategory[]): string | null {
  const parent = parentPath(folder.name).toLocaleLowerCase();
  return categories.find(item => item.name.toLocaleLowerCase() === parent)?.id || null;
}

export function folderMoveProblem(folder: LibraryCategory, destination: LibraryCategory | null): string | undefined {
  if (!destination) return;
  if (destination.projectId !== folder.projectId) return 'Choose a folder in this project.';
  if (inFolderSubtree(destination, folder)) return 'A folder cannot move into itself or its subfolders.';
}
