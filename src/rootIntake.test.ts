import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { addImages, createProject, listImages, prepareStashBoard, placeImagesOnBoard, removeImagesFromBoard, removeImagesFromStaging, restoreImageStates, createStashWithImages, undoStashCreation, exportProjectDirectory, importProjectFiles, getImageBlob, saveImageMetadata, listCategories } from './libraryStore';
import { vi } from 'vitest';
import { imageOnScopeBoard } from './stashBoard';
import { randomBatch, clampBatch } from './useRootIntake';
import { similarityCandidates, similarityReferences } from './similarityScope';

it('stages imported Staging images, persists batches and restores a queued image on Undo', async () => {
  const project = await createProject('Start');
  await addImages(project.id, ['a','b','c','d'].map(path => ({ path: `${path}.png`, file: new File([path], `${path}.png`, { type: 'image/png' }) })));
  const images = await listImages(project.id);
  expect(images.every(image => !imageOnScopeBoard(image, null))).toBe(true);
  expect(await prepareStashBoard(project.id, null, 900)).toBe(false);
  await placeImagesOnBoard(project.id, [{ id: images[0].id, x: 20, y: 30, boardScope: null }]);
  expect((await listImages(project.id)).filter(image => imageOnScopeBoard(image, null))).toHaveLength(1);
  await restoreImageStates(project.id, [{ id: images[0].id, categoryId: null, board: { rootOnBoard: false, placement: 'board', boardScope: null } }]);
  expect((await listImages(project.id)).every(image => !imageOnScopeBoard(image, null))).toBe(true);
  expect(await (await getImageBlob(images[0].id))!.text()).toBe('a');
});

it('stash creation consumes queued images and Undo restores their browser-only state', async () => {
  const project = await createProject('Group');
  await addImages(project.id, [{ path: 'a.png', file: new File(['a'], 'a.png', { type: 'image/png' }) }]);
  const [image] = await listImages(project.id), { category, states } = await createStashWithImages(project.id, [image.id], null);
  expect(imageOnScopeBoard((await listImages(project.id))[0], category.id)).toBe(true);
  await undoStashCreation(project.id, category.id, states);
  expect((await listImages(project.id))[0].rootOnBoard).toBe(false);
});

it('backs up and restores both queued and placed Staging originals without hiding legacy records', async () => {
  const project = await createProject('Backup');
  await addImages(project.id, ['a','b'].map(path => ({ path: `${path}.png`, file: new File([path], `${path}.png`, { type: 'image/png' }) })));
  const [first] = await listImages(project.id); await placeImagesOnBoard(project.id, [{ id: first.id, x: 20, y: 30 }]);
  const files = new Map<string, Blob>();
  const directory = (prefix = ''): FileSystemDirectoryHandle => ({ getDirectoryHandle: async (name: string) => directory(`${prefix}${name}/`),
    getFileHandle: async (name: string) => ({ createWritable: async () => ({ write: async (blob: Blob) => { files.set(prefix + name, blob); }, close: async () => {} }) }) }) as unknown as FileSystemDirectoryHandle;
  await exportProjectDirectory(project.id, directory());
  const restored = await importProjectFiles(() => files.get('project.json')!.text(), async path => files.get(path));
  const images = await listImages(restored.id);
  expect(images.map(image => image.rootOnBoard)).toEqual([true, false]);
  expect(imageOnScopeBoard({ ...images[1], rootOnBoard: undefined }, null)).toBe(true);
});

it('random batches are bounded, distinct and do not mutate their source', () => {
  const ids = Array.from({ length: 30 }, (_, i) => String(i)), copy = [...ids];
  for (const size of [1, 3, 24, 50]) { const result = randomBatch(ids, size); expect(result).toHaveLength(Math.min(24, size)); expect(new Set(result).size).toBe(result.length); }
  expect(randomBatch([], 3)).toEqual([]); expect(clampBatch(3, 2)).toBe(2); expect(clampBatch(NaN, 30)).toBe(3); expect(ids).toEqual(copy);
});

it('Staging matching uses placed references and only queued candidates while batches remain', () => {
  const images = [true, true, false, false].map((rootOnBoard, i) => ({ id: String(i), categoryId: null, rootOnBoard } as Awaited<ReturnType<typeof listImages>>[number]));
  expect(similarityReferences(images, null).map(image => image.id)).toEqual(['0', '1']);
  expect(similarityCandidates(images, null, new Set(['0'])).map(image => image.id)).toEqual(['2', '3']);
});

it('returns a staged batch to the queue, preserving originals, analysis and positions for Undo', async () => {
  const project = await createProject('Staging removal');
  await addImages(project.id, ['a','b','c'].map(path => ({ path: `${path}.png`, file: new File([path], `${path}.png`, { type: 'image/png' }) })));
  const initial = await listImages(project.id);
  await placeImagesOnBoard(project.id, initial.slice(0, 2).map((image, index) => ({ id: image.id, x: 50 + index * 200, y: 120 })));
  const before = await listImages(project.id);
  const removed = await removeImagesFromStaging(project.id, [before[0].id, before[1].id, before[1].id]);
  expect(removed).toHaveLength(2);
  expect((await listImages(project.id)).every(image => !imageOnScopeBoard(image, null))).toBe(true);
  expect(removed[0]).toMatchObject({ boardX: 50, boardY: 120, categoryId: null, rootOnBoard: false });
  expect(await prepareStashBoard(project.id, null, 900)).toBe(false);
  const visual = { version: 1, width: 320, height: 160, hash: '0123456789abcdef' };
  await saveImageMetadata(project.id, [{ id: before[0].id, visual }]);
  await restoreImageStates(project.id, before.slice(0, 2).map(image => ({ id: image.id, categoryId: image.categoryId,
    board: { placement: image.placement, boardScope: image.boardScope, boardX: image.boardX, boardY: image.boardY, rootOnBoard: image.rootOnBoard } })));
  expect((await listImages(project.id))[0]).toMatchObject({ rootOnBoard: true, boardX: 50, boardY: 120, visual });
  expect(await (await getImageBlob(before[0].id))!.text()).toBe('a');
});

it('rejects folder members and foreign images before removing any staged image', async () => {
  const project = await createProject('Protected folders'), other = await createProject('Other');
  await addImages(project.id, ['a','b'].map(path => ({ path: `${path}.png`, file: new File([path], `${path}.png`, { type: 'image/png' }) })));
  await addImages(other.id, [{ path: 'foreign.png', file: new File(['x'], 'foreign.png', { type: 'image/png' }) }]);
  const images = await listImages(project.id);
  await createStashWithImages(project.id, [images[1].id], null, 'Keep');
  await placeImagesOnBoard(project.id, [{ id: images[0].id, x: 20, y: 40 }]);
  const before = await listImages(project.id);
  await expect(removeImagesFromStaging(project.id, images.map(image => image.id))).rejects.toThrow('Only staged images');
  await expect(removeImagesFromStaging(project.id, [images[0].id, (await listImages(other.id))[0].id])).rejects.toThrow('Image not found');
  expect(await listImages(project.id)).toEqual(before);
});

it('rolls back a failed batch removal', async () => {
  const project = await createProject('Removal rollback');
  await addImages(project.id, ['a','b'].map(path => ({ path: `${path}.png`, file: new File([path], `${path}.png`, { type: 'image/png' }) })));
  const initial = await listImages(project.id);
  await placeImagesOnBoard(project.id, initial.map((image, index) => ({ id: image.id, x: 10 + index * 200, y: 20 })));
  const before = await listImages(project.id), put = IDBObjectStore.prototype.put;
  let written = 0;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value, key) {
    if (this.name === 'images' && ++written === 2) throw new DOMException('Test storage failure', 'QuotaExceededError');
    return key === undefined ? put.call(this, value) : put.call(this, value, key);
  });
  try { await expect(removeImagesFromStaging(project.id, initial.map(image => image.id))).rejects.toThrow('Test storage failure'); }
  finally { spy.mockRestore(); }
  expect(await listImages(project.id)).toEqual(before);
});

it('removes only direct folder members into waiting, and restores membership, stack order and layout', async () => {
  const project = await createProject('Folder removal');
  await addImages(project.id, ['a','b','c','d'].map(path => ({ path: `${path}.png`, file: new File([path], `${path}.png`, { type: 'image/png' }) })));
  const images = await listImages(project.id);
  const parent = await createStashWithImages(project.id, images.slice(0, 2).map(image => image.id), null, 'Parent');
  await createStashWithImages(project.id, [images[2].id], parent.category.id, 'Child');
  const before = await listImages(project.id), folders = await listCategories(project.id);
  await expect(removeImagesFromBoard(project.id, [images[0].id, images[2].id], parent.category.id)).rejects.toThrow('Only images in this folder');
  expect(await listImages(project.id)).toEqual(before);
  const removed = await removeImagesFromBoard(project.id, images.slice(0, 2).map(image => image.id), parent.category.id);
  expect(removed).toHaveLength(2);
  expect(removed.every(image => image.categoryId === null && image.rootOnBoard === false && image.stashOrder === undefined)).toBe(true);
  expect((await listImages(project.id)).slice(2)).toEqual(before.slice(2));
  expect(await listCategories(project.id)).toEqual(folders);
  await restoreImageStates(project.id, before.slice(0, 2).map(image => ({ id: image.id, categoryId: image.categoryId, stashOrder: image.stashOrder,
    board: { placement: image.placement, boardScope: image.boardScope, boardX: image.boardX, boardY: image.boardY, rootOnBoard: image.rootOnBoard } })));
  expect(await listImages(project.id)).toEqual(before);
  expect(await (await getImageBlob(images[0].id))!.text()).toBe('a');
});
