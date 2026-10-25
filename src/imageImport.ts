import { addImages, cleanRelativePath, createCategory, isImageFile, listCategories, listImages, type IncomingImage } from './imageStore';
import { proposedSourceCategories, sourceCategoryForPath } from './folderCategories';

/** Only new, supported originals may introduce source-folder stashes. */
export async function importImages(projectId: string, incoming: IncomingImage[], keepFolders: boolean,
  onProgress?: (done: number, total: number) => void) {
  const known = new Set((await listImages(projectId)).map(image => image.path));
  const images: IncomingImage[] = [];
  let duplicates = 0, unsupported = 0;
  for (const item of incoming) {
    if (!isImageFile(item.file)) { unsupported++; continue; }
    const path = cleanRelativePath(item.path);
    if (known.has(path)) { duplicates++; continue; }
    known.add(path); images.push({ ...item, path });
  }
  const assignments = new Map<string, string>();
  if (keepFolders && images.length) {
    const categories = await listCategories(projectId);
    for (const name of proposedSourceCategories(images)) {
      if (!categories.some(category => category.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        categories.push(await createCategory(projectId, name));
      }
    }
    for (const image of images) {
      const name = sourceCategoryForPath(image.path)?.toLocaleLowerCase();
      const category = categories.find(category => category.name.toLocaleLowerCase() === name);
      if (category) assignments.set(image.path, category.id);
    }
  }
  const skipped = duplicates + unsupported;
  onProgress?.(skipped, incoming.length);
  const result = await addImages(projectId, images, done => onProgress?.(skipped + done, incoming.length), assignments);
  return { added: result.added, ids: result.ids, duplicates: duplicates + result.skipped, unsupported };
}
