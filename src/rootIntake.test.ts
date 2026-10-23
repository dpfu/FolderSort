import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { addImages, createProject, listImages, prepareStashBoard, placeImagesOnBoard, restoreImageStates, createStashWithImages, undoStashCreation, exportProjectDirectory, importProjectFiles, getImageBlob } from './libraryStore';
import { imageOnScopeBoard } from './stashBoard';
import { randomBatch, clampBatch } from './useRootIntake';
import { similarityCandidates, similarityReferences } from './similarityScope';

it('stages imported Root images, persists batches and restores a queued image on Undo', async () => {
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

it('backs up and restores both queued and placed Root originals without hiding legacy records', async () => {
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

it('Root matching uses placed references and only queued candidates while batches remain', () => {
  const images = [true, true, false, false].map((rootOnBoard, i) => ({ id: String(i), categoryId: null, rootOnBoard } as Awaited<ReturnType<typeof listImages>>[number]));
  expect(similarityReferences(images, null).map(image => image.id)).toEqual(['0', '1']);
  expect(similarityCandidates(images, null, new Set(['0'])).map(image => image.id)).toEqual(['2', '3']);
});
