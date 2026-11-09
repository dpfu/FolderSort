import { database, commitTransaction } from './libraryDatabase';
import type { LibraryCategory } from './imageStore';
import { parentPath } from './stashGeometry';
import { folderMoveProblem, folderParentId, inFolderSubtree } from './folderNesting';

export type FolderMoveSnapshot = {
  projectId: string;
  folders: { id: string; before: string; after: string }[];
};

/** Rename a whole subtree atomically. IDs, memberships and every layout stay intact. */
export async function moveFolder(projectId: string, id: string, parentId: string | null): Promise<FolderMoveSnapshot | undefined> {
  const tx = (await database).transaction(['projects', 'categories'], 'readwrite');
  return commitTransaction(tx, async () => {
    const project = await tx.objectStore('projects').get(projectId);
    const categories = await tx.objectStore('categories').index('byProject').getAll(projectId);
    const folder = categories.find(item => item.id === id);
    const parent = parentId === null ? null : categories.find(item => item.id === parentId);
    if (!project || !folder || parent === undefined) throw new Error('Folder not found in this project.');
    const problem = folderMoveProblem(folder, parent);
    if (problem) throw new Error(problem);
    if (folderParentId(folder, categories) === parentId) return;
    const prefix = (parent ? `${parent.name}/` : '') + folder.name.split('/').at(-1)!;
    const moving = categories.filter(item => inFolderSubtree(item, folder));
    const ids = new Set(moving.map(item => item.id));
    const names = new Set(categories.filter(item => !ids.has(item.id)).map(item => item.name.toLocaleLowerCase()));
    const folders = moving.map(item => ({ id: item.id, before: item.name, after: prefix + item.name.slice(folder.name.length) }));
    for (const item of folders) {
      const key = item.after.toLocaleLowerCase();
      if (names.has(key)) throw new Error('A folder with this name already exists in the destination.');
      names.add(key);
    }
    for (const [index, item] of moving.entries()) await tx.objectStore('categories').put({ ...item, name: folders[index].after }, item.id);
    await tx.objectStore('projects').put({ ...project, updatedAt: Date.now() }, projectId);
    return { projectId, folders };
  });
}

/** Undo changes names only, keeping newer folder metadata and image analysis. */
export async function restoreFolderMove(snapshot: FolderMoveSnapshot): Promise<void> {
  const tx = (await database).transaction(['projects', 'categories'], 'readwrite');
  await commitTransaction(tx, async () => {
    const project = await tx.objectStore('projects').get(snapshot.projectId);
    const categories = await tx.objectStore('categories').index('byProject').getAll(snapshot.projectId);
    if (!project) throw new Error('Project not found.');
    const changes = new Map(snapshot.folders.map(item => [item.id, item]));
    const byId = new Map(categories.map(item => [item.id, item]));
    const root = [...snapshot.folders].sort((a, b) => a.after.length - b.after.length)[0];
    const currentRoot = byId.get(root?.id);
    if (!currentRoot || categories.filter(item => inFolderSubtree(item, currentRoot)).some(item => !changes.has(item.id)) ||
      snapshot.folders.some(item => byId.get(item.id)?.name !== item.after))
      throw new Error('The folder changed since this move. Undo newer changes first.');
    const restored = categories.map(item => ({ ...item, name: changes.get(item.id)?.before || item.name }));
    const names = new Set<string>();
    for (const item of restored) {
      const key = item.name.toLocaleLowerCase();
      if (names.has(key)) throw new Error('A folder with this name already exists.');
      names.add(key);
    }
    for (const item of snapshot.folders) {
      const parent = parentPath(item.before).toLocaleLowerCase();
      if (parent && !names.has(parent)) throw new Error('Restore the parent folder first.');
    }
    for (const item of restored.filter(item => changes.has(item.id))) await tx.objectStore('categories').put(item, item.id);
    await tx.objectStore('projects').put({ ...project, updatedAt: Date.now() }, project.id);
  });
}

export type EmptyStashSnapshot = { category: LibraryCategory };

/** Mark only presentation state, merging the latest name instead of overwriting it. */
export async function markFolderNamingPrompted(id: string): Promise<void> {
  const tx = (await database).transaction('categories', 'readwrite');
  await commitTransaction(tx, async () => {
    const folder = await tx.store.get(id);
    if (folder?.unnamed && !folder.namingPrompted) await tx.store.put({ ...folder, namingPrompted: true }, id);
  });
}

/** Check emptiness in the same transaction as deletion; never remove originals. */
export async function removeEmptyStash(projectId: string, id: string): Promise<EmptyStashSnapshot> {
  const tx = (await database).transaction(['projects', 'categories', 'images'], 'readwrite');
  return commitTransaction(tx, async () => {
    const [project, category, categories, images] = await Promise.all([
      tx.objectStore('projects').get(projectId), tx.objectStore('categories').get(id),
      tx.objectStore('categories').index('byProject').getAll(projectId), tx.objectStore('images').index('byProject').getAll(projectId),
    ]);
    if (!project || !category || category.projectId !== projectId) throw new Error('Folder not found in this project.');
    if (images.some(image => image.categoryId === id) || categories.some(child => child.name.toLocaleLowerCase().startsWith(`${category.name.toLocaleLowerCase()}/`))) {
      throw new Error('Move all images and subfolders out before deleting this folder.');
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
    if (await tx.objectStore('categories').get(category.id) || categories.some(stash => stash.name.toLocaleLowerCase() === category.name.toLocaleLowerCase())) throw new Error('A folder with this name already exists.');
    const parent = parentPath(category.name).toLocaleLowerCase();
    if (parent && !categories.some(stash => stash.name.toLocaleLowerCase() === parent)) throw new Error('Restore the parent folder first.');
    await tx.objectStore('categories').put(category, category.id);
    await tx.objectStore('projects').put({ ...project, updatedAt: Date.now() }, project.id);
  });
}
