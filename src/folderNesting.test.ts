import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { addImages, createCategory, createProject, listCategories, listImages, moveFolder, placeImagesOnBoard, restoreFolderMove } from './libraryStore';
import { database } from './libraryDatabase';

async function tree() {
  const project = await createProject('Folder nesting');
  const parent = await createCategory(project.id, 'Research');
  const child = await createCategory(project.id, 'Research/Hands');
  const grandchild = await createCategory(project.id, 'Research/Hands/Details');
  const destination = await createCategory(project.id, 'Archive');
  return { project, parent, child, grandchild, destination };
}

it('moves and restores the complete subtree, retaining IDs, memberships, image positions and folder metadata', async () => {
  const { project, parent, child, grandchild, destination } = await tree();
  await addImages(project.id, [0, 1, 2].map(i => ({ path: `${i}.png`, file: new File(['original'], `${i}.png`, { type: 'image/png' }) })));
  const images = await listImages(project.id);
  await placeImagesOnBoard(project.id, images.map((image, i) => ({ id: image.id, x: 111 + i * 73, y: 210 + i * 21, boardScope: [parent, child, grandchild][i].id })));
  const beforeImages = await listImages(project.id), beforeFolders = await listCategories(project.id);
  const move = (await moveFolder(project.id, parent.id, destination.id))!;
  expect((await listCategories(project.id)).map(item => [item.id, item.name])).toEqual(expect.arrayContaining([
    [parent.id, 'Archive/Research'], [child.id, 'Archive/Research/Hands'], [grandchild.id, 'Archive/Research/Hands/Details'],
  ]));
  expect(await listImages(project.id)).toEqual(beforeImages);
  // A later presentation update must not be clobbered by restoring names.
  const db = await database, latest = (await db.get('categories', child.id))!;
  await db.put('categories', { ...latest, namingPrompted: true }, child.id);
  await restoreFolderMove(move);
  expect(await listCategories(project.id)).toEqual(beforeFolders.map(item => item.id === child.id ? { ...item, namingPrompted: true } : item));
  expect(await listImages(project.id)).toEqual(beforeImages);
});

it('moves a nested folder out to Staging with descendants and supports Undo; the current parent is a no-op', async () => {
  const { project, parent, child, grandchild } = await tree();
  expect(await moveFolder(project.id, child.id, parent.id)).toBeUndefined();
  const before = await listCategories(project.id), move = (await moveFolder(project.id, child.id, null))!;
  expect((await listCategories(project.id)).find(item => item.id === child.id)?.name).toBe('Hands');
  expect((await listCategories(project.id)).find(item => item.id === grandchild.id)?.name).toBe('Hands/Details');
  await restoreFolderMove(move);
  expect(await listCategories(project.id)).toEqual(before);
});

it('rejects self, descendant, foreign and missing destinations without partial writes', async () => {
  const { project, parent, child, grandchild } = await tree();
  const other = await createProject('Other'), foreign = await createCategory(other.id, 'Elsewhere');
  const before = await listCategories(project.id);
  for (const id of [parent.id, child.id, grandchild.id]) await expect(moveFolder(project.id, parent.id, id)).rejects.toThrow('itself or its subfolders');
  for (const id of [foreign.id, 'missing']) await expect(moveFolder(project.id, parent.id, id)).rejects.toThrow('this project');
  await expect(moveFolder(other.id, parent.id, foreign.id)).rejects.toThrow('this project');
  expect(await listCategories(project.id)).toEqual(before);
});

it('rejects case-insensitive name collisions and stale Undo without overwriting another subtree', async () => {
  const { project, parent, destination } = await tree();
  await createCategory(project.id, 'Archive/research');
  const before = await listCategories(project.id);
  await expect(moveFolder(project.id, parent.id, destination.id)).rejects.toThrow('already exists');
  expect(await listCategories(project.id)).toEqual(before);
  const movable = await createCategory(project.id, 'Archive/Keep');
  const move = (await moveFolder(project.id, movable.id, null))!;
  // A new child needs its own Undo before this earlier move can be undone.
  await createCategory(project.id, 'Keep/New child');
  const changed = await listCategories(project.id);
  await expect(restoreFolderMove(move)).rejects.toThrow('newer changes');
  expect(await listCategories(project.id)).toEqual(changed);
});

it('serializes opposite moves so two simultaneous requests cannot create a cycle', async () => {
  const project = await createProject('Concurrent moves');
  const a = await createCategory(project.id, 'A'), b = await createCategory(project.id, 'B');
  const result = await Promise.allSettled([moveFolder(project.id, a.id, b.id), moveFolder(project.id, b.id, a.id)]);
  expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  expect(result.filter(item => item.status === 'rejected')).toHaveLength(1);
  const names = (await listCategories(project.id)).map(item => item.name);
  expect(names).toEqual(expect.arrayContaining(names.includes('B') ? ['B', 'B/A'] : ['A', 'A/B']));
});
