import type { LibraryImage } from './libraryStore';

export function categoryDepth(name: string): number {
  return name.split('/').length - 1;
}

/** A parent view includes its child folders, while each image keeps one direct assignment. */
export function imageInCategoryBranch(image: LibraryImage, branchId: string, categoryById: Map<string, string>): boolean {
  const branch = categoryById.get(branchId);
  const assigned = image.categoryId ? categoryById.get(image.categoryId) : undefined;
  return Boolean(branch && assigned && (
    assigned.toLocaleLowerCase() === branch.toLocaleLowerCase() ||
    assigned.toLocaleLowerCase().startsWith(`${branch.toLocaleLowerCase()}/`)
  ));
}
