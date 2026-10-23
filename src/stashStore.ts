import { database, commitTransaction } from './libraryDatabase';
import type { LibraryCategory } from './imageStore';
import { parentPath } from './stashGeometry';

export type EmptyStashSnapshot = { category: LibraryCategory };

/** Check emptiness in the same transaction as deletion; never remove originals. */
export async function removeEmptyStash(projectId: string, id: string): Promise<EmptyStashSnapshot> {
  const tx = (await database).transaction(['projects', 'categories', 'images'], 'readwrite');
  return commitTransaction(tx, async () => {
    const [project, category, categories, images] = await Promise.all([
      tx.objectStore('projects').get(projectId), tx.objectStore('categories').get(id),
      tx.objectStore('categories').index('byProject').getAll(projectId), tx.objectStore('images').index('byProject').getAll(projectId),
    ]);
    if (!project || !category || category.projectId !== projectId) throw new Error('Stash not found in this project.');
    if (images.some(image => image.categoryId === id) || categories.some(child => child.name.toLocaleLowerCase().startsWith(`${category.name.toLocaleLowerCase()}/`))) {
      throw new Error('Move all images and sub-stashes out before deleting this stash.');
    }
    await tx.objectStore('categories').delete(id);
    await tx.objectStore('projects').put({ ...project, updatedAt: Date.now() }, projectId);
    return { category };
  });
}

/** Restore only this empty container, retaining newer analysis. */
export async function restoreEmptyStash({ category }: EmptyStashSnapshot): Promise<void> {
  const tx = (await database).transaction(['projects', 'categories'], 'readwrite');
  await commitTransaction(tx, async () => {
    const [project, categories] = await Promise.all([
      tx.objectStore('projects').get(category.projectId), tx.objectStore('categories').index('byProject').getAll(category.projectId),
    ]);
    if (!project) throw new Error('Project not found.');
    if (await tx.objectStore('categories').get(category.id) || categories.some(stash => stash.name.toLocaleLowerCase() === category.name.toLocaleLowerCase())) throw new Error('A stash with this name already exists.');
    const parent = parentPath(category.name).toLocaleLowerCase();
    if (parent && !categories.some(stash => stash.name.toLocaleLowerCase() === parent)) throw new Error('Restore the parent stash first.');
    await tx.objectStore('categories').put(category, category.id);
    await tx.objectStore('projects').put({ ...project, updatedAt: Date.now() }, project.id);
  });
}
