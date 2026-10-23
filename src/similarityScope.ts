import type { LibraryImage } from './libraryStore';

/** Root searches its own images. Stashes move unsorted matches unless explicitly expanded. */
export function similarityCandidates(images: LibraryImage[], scope: string | null, referenceIds: ReadonlySet<string>, includeStashes = false) {
  return images.filter(image => !referenceIds.has(image.id) && (scope === null
    ? image.categoryId === null
    : image.categoryId !== scope && (image.categoryId === null || includeStashes)));
}
