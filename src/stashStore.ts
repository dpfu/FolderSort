import { database, commitTransaction } from './libraryDatabase';
import type { ImageRestoreState, LibraryCategory } from './imageStore';
import { parentPath } from './stashGeometry';

export type EmptyStashSnapshot = { category: LibraryCategory; states: ImageRestoreState[] };

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
    // Comparison images can be on this board without belonging to the stash.
    // Keep their membership and originals; park their working layout in the browser.
    const borrowed = images.filter(image => image.boardScope === id);
    const states = borrowed.map(image => ({ id: image.id, board: { placement: image.placement, boardScope: image.boardScope, boardX: image.boardX, boardY: image.boardY } }));
    await Promise.all(borrowed.map(image => {
      const next = { ...image, placement: 'tray' as const, boardScope: image.categoryId };
      delete next.boardX; delete next.boardY;
      return tx.objectStore('images').put(next, image.id);
    }));
    await tx.objectStore('categories').delete(id);
    await tx.objectStore('projects').put({ ...project, updatedAt: Date.now() }, projectId);
    return { category, states };
  });
}

/** Restore only this container and its comparison layout, retaining newer analysis. */
export async function restoreEmptyStash({ category, states }: EmptyStashSnapshot): Promise<void> {
  const tx = (await database).transaction(['projects', 'categories', 'images'], 'readwrite');
  await commitTransaction(tx, async () => {
    const [project, categories, images] = await Promise.all([
      tx.objectStore('projects').get(category.projectId), tx.objectStore('categories').index('byProject').getAll(category.projectId),
      Promise.all(states.map(state => tx.objectStore('images').get(state.id))),
    ]);
    if (!project) throw new Error('Project not found.');
    if (await tx.objectStore('categories').get(category.id) || categories.some(stash => stash.name.toLocaleLowerCase() === category.name.toLocaleLowerCase())) throw new Error('A stash with this name already exists.');
    const parent = parentPath(category.name).toLocaleLowerCase();
    if (parent && !categories.some(stash => stash.name.toLocaleLowerCase() === parent)) throw new Error('Restore the parent stash first.');
    if (images.some(image => !image || image.projectId !== category.projectId)) throw new Error('Could not restore the stash view: an image is missing.');
    await tx.objectStore('categories').put(category, category.id);
    await Promise.all(images.map((image, index) => {
      const next = { ...image! };
      delete next.placement; delete next.boardScope; delete next.boardX; delete next.boardY;
      return tx.objectStore('images').put({ ...next, ...states[index].board }, next.id);
    }));
    await tx.objectStore('projects').put({ ...project, updatedAt: Date.now() }, project.id);
  });
}
