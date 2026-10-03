import type { LibraryCategory, LibraryImage } from './libraryStore';

/** Stable across reloads and project backups, with readable labels alongside color. */
export function categoryColor(name: string): string {
  let hash = 0;
  for (const character of name.toLocaleLowerCase()) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  // Use the whole color wheel: a small fixed palette frequently gave nearby
  // categories identical colors. Pastel lightness keeps dark labels readable.
  return `hsl(${(((hash >>> 0) * 137.508) % 360).toFixed(1)} 58% 76%)`;
}

/** Count the hierarchy in one pass instead of scanning every image for every row. */
export function categoryCounts(images: LibraryImage[], categories: LibraryCategory[]): Map<string, number> {
  const ids = new Map(categories.map(category => [category.name.toLocaleLowerCase(), category.id]));
  const names = new Map(categories.map(category => [category.id, category.name]));
  const counts = new Map<string, number>();
  for (const image of images) {
    if (!image.categoryId) { counts.set('unassigned', (counts.get('unassigned') || 0) + 1); continue; }
    const name = names.get(image.categoryId);
    if (!name) continue;
    const parts = name.toLocaleLowerCase().split('/');
    let path = '';
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      const id = ids.get(path);
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  return counts;
}

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
