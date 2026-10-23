import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { database } from './libraryDatabase';
import { addImages, assignImageCategories, createCategory, createProject, exportSortedDirectory, getImageBlob, importProjectFiles, listImages, placeImagesOnBoard, prepareStashBoard, restoreImageStates, saveImageMetadata } from './libraryStore';
import { imageOnScopeBoard } from './stashBoard';

async function fixture() {
  const project = await createProject('Folders');
  const source = await createCategory(project.id, 'Source'), destination = await createCategory(project.id, 'Destination');
  await addImages(project.id, ['a', 'b'].map(name => ({ path: `${name}.png`, file: new File([name], `${name}.png`, { type: 'image/png' }) })));
  return { project, source, destination, images: await listImages(project.id) };
}

it('moves into a board, leaves the old folder, goes to the top, exports there, and returns to root', async () => {
  const { project, source, destination, images } = await fixture();
  await assignImageCategories(project.id, [{ id: images[0].id, categoryId: source.id }, { id: images[1].id, categoryId: destination.id }]);
  const before = (await listImages(project.id))[0];
  await placeImagesOnBoard(project.id, [{ id: before.id, x: 300, y: 400, boardScope: destination.id }]);
  let saved = (await listImages(project.id))[0];
  expect(saved).toMatchObject({ categoryId: destination.id, boardScope: destination.id, boardX: 300, boardY: 400 });
  expect(imageOnScopeBoard(saved, source.id)).toBe(false);
  expect(saved.stashOrder!).toBeGreaterThan((await listImages(project.id))[1].stashOrder!);
  const files = new Map<string, Blob>();
  const directory = (prefix = ''): FileSystemDirectoryHandle => ({
    getDirectoryHandle: async (name: string) => directory(`${prefix}${name}/`),
    getFileHandle: async (name: string) => ({ createWritable: async () => ({ write: async (blob: Blob) => { files.set(prefix + name, blob); }, close: async () => {} }) }),
  }) as unknown as FileSystemDirectoryHandle;
  await exportSortedDirectory(project.id, directory());
  expect(files.has('Destination/a.png')).toBe(true); expect(files.has('Source/a.png')).toBe(false);
  const visual = { version: 1, width: 320, height: 160, hash: '0123456789abcdef' };
  await saveImageMetadata(project.id, [{ id: saved.id, visual }]);
  await restoreImageStates(project.id, [{ id: before.id, categoryId: before.categoryId, stashOrder: before.stashOrder,
    board: { placement: before.placement, boardScope: before.boardScope, boardX: before.boardX, boardY: before.boardY } }]);
  expect((await listImages(project.id))[0]).toMatchObject({ categoryId: source.id, boardScope: source.id, visual });
  await placeImagesOnBoard(project.id, [{ id: before.id, x: 10, y: 20, boardScope: null }]);
  saved = (await listImages(project.id))[0];
  expect(saved).toMatchObject({ categoryId: null, boardScope: null, placement: 'board' });
  expect(imageOnScopeBoard(saved, null)).toBe(true);
});

it('repairs old hidden and borrowed views once, preserving assignments, originals, analysis and valid layouts', async () => {
  const { project, source, destination, images } = await fixture(), db = await database;
  const visual = { version: 1, width: 320, height: 160, hash: '0123456789abcdef' };
  await db.put('images', { ...images[0], categoryId: source.id, boardScope: destination.id, placement: 'board', boardX: 500, boardY: 600, visual }, images[0].id);
  await db.put('images', { ...images[1], categoryId: destination.id, boardScope: destination.id, placement: 'tray' }, images[1].id);
  await db.delete('meta', `folder-boards:v1:${project.id}`);
  const repaired = await listImages(project.id);
  expect(repaired[0]).toMatchObject({ categoryId: source.id, boardScope: source.id, placement: 'board', visual });
  expect(repaired[0].boardX).toBeUndefined();
  expect(repaired[1]).toMatchObject({ categoryId: destination.id, boardScope: destination.id, placement: 'board' });
  expect(repaired.every(image => imageOnScopeBoard(image, image.categoryId))).toBe(true);
  expect(await (await getImageBlob(images[0].id))!.text()).toBe('a');
  await prepareStashBoard(project.id, source.id, 900);
  await placeImagesOnBoard(project.id, [{ id: images[0].id, x: 432, y: 321 }]);
  expect(await prepareStashBoard(project.id, source.id, 390)).toBe(false);
  expect((await listImages(project.id))[0]).toMatchObject({ boardX: 432, boardY: 321 });
});

it('repairs initialized legacy backups and lays out root and stash contents without hiding members', async () => {
  const stash = { id: 'old-stash', name: 'Saved', createdAt: 1, layoutInitialized: true };
  const imported = await importProjectFiles(async () => JSON.stringify({ format: 'folder-sort-project', version: 2, name: 'Old backup', categories: [stash], images: [
    { id: 'a', path: 'a.png', file: 'images/a/a.png', mime: 'image/png', size: 1, addedAt: 1, categoryId: stash.id, boardScope: null, placement: 'board', boardX: 200, boardY: 300 },
    { id: 'b', path: 'b.png', file: 'images/b/b.png', mime: 'image/png', size: 1, addedAt: 1, categoryId: null, placement: 'tray' },
  ] }), async () => new Blob(['a']));
  let images = await listImages(imported.id); const categoryId = images[0].categoryId!;
  expect(imageOnScopeBoard(images[0], categoryId)).toBe(true); expect(imageOnScopeBoard(images[1], null)).toBe(true);
  expect(images[0].boardX).toBeUndefined();
  await prepareStashBoard(imported.id, categoryId, 900); await prepareStashBoard(imported.id, null, 900);
  images = await listImages(imported.id);
  expect(images.every(image => image.boardX !== undefined && image.boardY !== undefined)).toBe(true);
});

it('rejects foreign destinations atomically and keeps every affected image in its original folder', async () => {
  const { project, images, source } = await fixture(), other = await fixture();
  await expect(placeImagesOnBoard(project.id, [{ id: images[0].id, x: 20, y: 30, boardScope: source.id }, { id: images[1].id, x: 40, y: 50, boardScope: other.source.id }])).rejects.toThrow('Stash not found');
  expect(await listImages(project.id)).toEqual(images);
});
