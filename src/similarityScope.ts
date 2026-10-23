import type { LibraryImage } from './libraryStore';

/** Leave a candidate on Root, where references and matches share the same folder. */
export function similarityReferences(images: LibraryImage[], scope: string | null, referenceId?: string) {
  const members = images.filter(image => image.categoryId === scope && (scope !== null || image.rootOnBoard !== false) && (!referenceId || image.id === referenceId));
  const queued = images.some(image => image.categoryId === null && image.rootOnBoard === false);
  return scope === null && !referenceId ? members.slice(0, Math.min(5, Math.max(0, members.length - Number(!queued)))) : members;
}

/** Root searches its own images. Stashes move unsorted matches unless explicitly expanded. */
export function similarityCandidates(images: LibraryImage[], scope: string | null, referenceIds: ReadonlySet<string>, includeStashes = false) {
  const queued = scope === null && images.some(image => image.categoryId === null && image.rootOnBoard === false);
  return images.filter(image => !referenceIds.has(image.id) && (scope === null
    ? image.categoryId === null && (!queued || image.rootOnBoard === false)
    : image.categoryId !== scope && (image.categoryId === null || includeStashes)));
}
