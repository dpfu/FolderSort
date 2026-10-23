import type { LibraryImage } from './libraryStore';

/** Leave a candidate on Root, where references and matches share the same folder. */
export function similarityReferences(images: LibraryImage[], scope: string | null, referenceId?: string) {
  const members = images.filter(image => image.categoryId === scope && (!referenceId || image.id === referenceId));
  return scope === null && !referenceId ? members.slice(0, Math.min(5, Math.max(0, members.length - 1))) : members;
}

/** Root searches its own images. Stashes move unsorted matches unless explicitly expanded. */
export function similarityCandidates(images: LibraryImage[], scope: string | null, referenceIds: ReadonlySet<string>, includeStashes = false) {
  return images.filter(image => !referenceIds.has(image.id) && (scope === null
    ? image.categoryId === null
    : image.categoryId !== scope && (image.categoryId === null || includeStashes)));
}
