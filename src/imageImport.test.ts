import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { importImages } from './imageImport';
import { assignImageCategories, createCategory, createProject, getImageBlob, listCategories, listImages, type IncomingImage } from './libraryStore';

const image = (path: string): IncomingImage => ({ path, file: new File([`original ${path}`], path.split('/').at(-1)!, { type: 'image/png' }) });

it('leaves stashes, assignments and originals unchanged when every source image is already imported', async () => {
  const project = await createProject('Duplicate import');
  const incoming = [image('Collection/Old/a.png'), image('Collection/Unused/b.png')];
  await importImages(project.id, incoming, false);
  const initial = await listImages(project.id);
  const renamed = await createCategory(project.id, 'Manual sorting');
  await assignImageCategories(project.id, [{ id: initial[0].id, categoryId: renamed.id }]);
  const before = await listImages(project.id);
  const result = await importImages(project.id, incoming, true);
  expect(result).toEqual({ added: 0, ids: [], duplicates: 2, unsupported: 0 });
  expect((await listCategories(project.id)).map(stash => stash.name)).toEqual(['Manual sorting']);
  const after = await listImages(project.id);
  expect(after).toEqual(before);
  for (const record of after) expect(await (await getImageBlob(record.id))!.text()).toBe(`original ${record.path}`);
});

it('creates source stashes only for novel supported paths and reports distinct skip reasons', async () => {
  const project = await createProject('Mixed repeat import');
  const existing = image('Collection/Old/a.png');
  await importImages(project.id, [existing], false);
  const progress: number[][] = [];
  const result = await importImages(project.id, [existing, image('Collection/New/b.png'), image('Collection\\New\\b.png'),
    { path: 'Collection/Unused/readme.txt', file: new File(['not an image'], 'readme.txt', { type: 'text/plain' }) }], true,
  (done, total) => progress.push([done, total]));
  expect(result).toMatchObject({ added: 1, duplicates: 2, unsupported: 1 });
  expect(result.ids).toHaveLength(1);
  const stashes = await listCategories(project.id);
  expect(stashes.map(stash => stash.name)).toEqual(['New']);
  const after = await listImages(project.id);
  expect(after.find(record => record.path.endsWith('a.png'))?.categoryId).toBeNull();
  expect(after.find(record => record.id === result.ids[0])).toMatchObject({ path: 'Collection/New/b.png', categoryId: stashes[0].id });
  expect(progress.at(-1)).toEqual([4, 4]);
});
