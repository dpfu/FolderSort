import { cleanRelativePath, isImageFile, type IncomingImage } from './libraryStore';

/** The first path segment is the selected or dropped root folder. */
export function sourceCategoryForPath(path: string): string | null {
  const parts = cleanRelativePath(path).split('/');
  return parts.length > 2 ? parts.slice(1, -1).join('/') : null;
}

export function proposedSourceCategories(images: IncomingImage[]): string[] {
  return [...new Set(images.filter((image) => isImageFile(image.file)).map((image) => sourceCategoryForPath(image.path)).filter((name): name is string => Boolean(name)))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
