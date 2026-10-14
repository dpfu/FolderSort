import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { addImages, assignImageCategories, createCategory, createProject, createStashWithImages, importProjectFiles, listCategories, listImages, placeImagesOnBoard, prepareStashBoard, restoreImageStates, returnImagesToTray, saveImageMetadata, undoStashCreation } from './libraryStore';
import { stashGrid } from './stashLayout';
import { boardScope, imageOnScopeBoard, inGroupingTarget, stashBoardLayout } from './stashBoard';

async function fixture() {
  const project = await createProject('Stash study');
  await addImages(project.id, ['a','b','c'].map(name => ({ file: new File([name], `${name}.png`, { type: 'image/png' }), path: `${name}.png` })));
  await placeImagesOnBoard(project.id, (await listImages(project.id)).map((image, index) => ({ id: image.id, x: 130 + index * 220, y: 200, boardScope: null })));
  return { project, images: await listImages(project.id) };
}

describe('stash grouping and compatibility', () => {
  it('puts additions on top, promotes re-additions and restores the former top with undo', async () => {
    const { project, images } = await fixture();
    const stash = await createStashWithImages(project.id, images.slice(0, 2).map(image => image.id), null, 'Stack');
    const layout = () => Promise.all([listImages(project.id), listCategories(project.id)]).then(([images, categories]) => stashBoardLayout(images, categories, null, 1000, {}));
    expect((await layout())[0].topImageId).toBe(images[1].id);
    await assignImageCategories(project.id, [{ id: images[2].id, categoryId: stash.category.id }]);
    expect((await layout())[0].previewIds[0]).toBe(images[2].id);
    const prior = (await listImages(project.id)).find(image => image.id === images[0].id)!;
    await assignImageCategories(project.id, [{ id: prior.id, categoryId: stash.category.id }]);
    expect((await layout())[0].topImageId).toBe(prior.id);
    await restoreImageStates(project.id, [{ id: prior.id, stashOrder: prior.stashOrder }]);
    expect((await layout())[0].topImageId).toBe(images[2].id);
  });
  it('prepares all direct contents once and preserves later manual changes and clear', async () => {
    const { project, images } = await fixture();
    const stash = await createStashWithImages(project.id, images.map(image => image.id), null, 'Grid');
    expect(await prepareStashBoard(project.id, stash.category.id, 390)).toBe(true);
    const prepared = await listImages(project.id);
    expect(prepared.every(image => imageOnScopeBoard(image, stash.category.id))).toBe(true);
    expect(new Set(prepared.map(image => `${image.boardX}:${image.boardY}`)).size).toBe(3);
    expect(prepared.every(image => image.boardX === 32)).toBe(true);
    await placeImagesOnBoard(project.id, [{ id: images[0].id, x: 765, y: 432, boardScope: stash.category.id }]);
    await returnImagesToTray(project.id, [images[1].id]);
    const before = await listImages(project.id);
    expect(await prepareStashBoard(project.id, stash.category.id, 1400)).toBe(false);
    expect(await listImages(project.id)).toEqual(before);
  });
  it('keeps legacy manual placement while laying out previously hidden stash contents', async () => {
    const { images } = await fixture();
    const stash = { id: 'legacy', name: 'Legacy', createdAt: 1 };
    const imported = await importProjectFiles(async () => JSON.stringify({ format: 'folder-sort-project', version: 2, name: 'Old', categories: [stash], images: images.map((image, index) => ({ ...image, categoryId: stash.id, boardScope: stash.id, placement: index ? 'tray' : 'board', boardX: 300, boardY: 250, file: `images/${image.id}/${image.path}` })) }), async () => new Blob(['a']));
    const category = (await listCategories(imported.id))[0];
    await prepareStashBoard(imported.id, category.id, 900);
    expect((await listImages(imported.id))[0]).toMatchObject({ boardX: 300, boardY: 250 });
    expect((await listImages(imported.id)).every(image => imageOnScopeBoard(image, category.id))).toBe(true);
  });
  it('keeps ordering and initialized layout in a backup and adds above restored contents', async () => {
    const { project, images } = await fixture(); const stash = await createStashWithImages(project.id, images.slice(0, 2).map(image => image.id), null, 'Backup');
    await prepareStashBoard(project.id, stash.category.id, 1000);
    const records = await listImages(project.id), categories = await listCategories(project.id);
    const imported = await importProjectFiles(async () => JSON.stringify({ format: 'folder-sort-project', version: 2, name: 'Restored', categories, images: records.map(image => ({ ...image, file: `images/${image.id}/${image.path}` })) }), async () => new Blob(['a']));
    const restored = await listImages(imported.id), category = (await listCategories(imported.id))[0];
    expect(category.layoutInitialized).toBe(true);
    expect(restored.map(image => image.stashOrder)).toEqual(records.map(image => image.stashOrder));
    const added = restored.find(image => image.categoryId === null)!;
    await assignImageCategories(imported.id, [{ id: added.id, categoryId: category.id }]);
    expect(stashBoardLayout(await listImages(imported.id), [category], null, 1000, {})[0].topImageId).toBe(added.id);
  });
  it('lays out large sets with bounded coordinates and avoids images and stash tiles', () => {
    const occupied = [{ x: 32, y: 120, width: 236, height: 248 }, { x: 600, y: 200 }];
    const moves = stashGrid(Array.from({ length: 3000 }, (_, index) => String(index)), 390, occupied);
    expect(new Set(moves.map(move => `${move.x}:${move.y}`)).size).toBe(3000);
    expect(moves.every(move => move.x >= 0 && move.y >= 0 && move.y < 100000)).toBe(true);
    expect(moves.every(move => !(move.x < 268 && move.x + 172 > 32 && move.y < 368 && move.y + 172 > 120))).toBe(true);
  });
  it('creates and undoes a stash atomically, restoring exact positions while retaining newer metadata', async () => {
    const { project, images } = await fixture();
    const { category, states } = await createStashWithImages(project.id, images.slice(0,2).map(image => image.id), null);
    expect((await listImages(project.id)).slice(0,2).every(image => image.categoryId === category.id && image.boardScope === category.id)).toBe(true);
    const visual = { version: 1, width: 320, height: 160, hash: '0000000000000000' };
    await saveImageMetadata(project.id, [{ id: images[0].id, visual }]);
    await undoStashCreation(project.id, category.id, states);
    expect(await listCategories(project.id)).toHaveLength(0);
    expect((await listImages(project.id)).map(image => [image.categoryId,image.placement,image.boardX,image.boardY,image.boardScope])).toEqual(images.map(image => [image.categoryId,image.placement,image.boardX,image.boardY,image.boardScope]));
    expect((await listImages(project.id))[0].visual).toEqual(visual);
  });
  it('creates a stash from pile images on its board and undoes membership and placement together', async () => {
    const { project, images } = await fixture();
    await returnImagesToTray(project.id, [images[0].id]);
    const before = await listImages(project.id);
    const result = await createStashWithImages(project.id, [images[0].id], null, 'From pile', true);
    expect((await listImages(project.id))[0]).toMatchObject({ placement: 'board', categoryId: result.category.id, boardScope: result.category.id });
    await undoStashCreation(project.id, result.category.id, result.states);
    expect(await listImages(project.id)).toEqual(before);
  });
  it('rejects invalid or foreign images without creating a stash or moving other images', async () => {
    const { project, images } = await fixture(); const foreign = await fixture();
    await expect(createStashWithImages(project.id, [images[0].id, foreign.images[0].id], null)).rejects.toThrow('Image not found');
    await expect(createStashWithImages(project.id, [images[0].id], 'missing')).rejects.toThrow('Stash not found');
    expect(await listCategories(project.id)).toHaveLength(0); expect(await listImages(project.id)).toEqual(images);
  });
  it('creates nested stashes with unique names and preserves direct parent membership', async () => {
    const { project, images } = await fixture();
    const parent = await createStashWithImages(project.id, images.map(image => image.id), null, 'Nature');
    const child = await createStashWithImages(project.id, [images[0].id], parent.category.id);
    const second = await createStashWithImages(project.id, [], parent.category.id);
    expect(child.category.name).toBe('Nature/New stash'); expect(second.category.name).toBe('Nature/New stash 2');
    const layout = stashBoardLayout(await listImages(project.id), await listCategories(project.id), null, 1200, {});
    expect(layout).toHaveLength(1); expect(layout[0]).toMatchObject({ directCount:2,totalCount:3,childCount:2 });
    expect(layout[0].previewIds).toHaveLength(3);
    await undoStashCreation(project.id, child.category.id, child.states);
    expect((await listImages(project.id)).every(image => image.categoryId === parent.category.id)).toBe(true);
  });
  it('protects later contents from an outdated creation undo', async () => {
    const { project, images } = await fixture();
    const stash = await createStashWithImages(project.id, [images[0].id], null);
    await assignImageCategories(project.id, [{ id: images[1].id, categoryId: stash.category.id }]);
    await expect(undoStashCreation(project.id, stash.category.id, stash.states)).rejects.toThrow('new contents');
    expect(await listCategories(project.id)).toHaveLength(1);
  });
  it('keeps comparison intake independent of assignment and remaps its scope in backup manifests', async () => {
    const { project, images } = await fixture(); const stash = await createCategory(project.id,'References');
    await placeImagesOnBoard(project.id,[{ id:images[0].id,x:350,y:230,boardScope:stash.id }]);
    const saved = (await listImages(project.id))[0]; expect(saved.categoryId).toBeNull(); expect(imageOnScopeBoard(saved,stash.id)).toBe(true);
    const savedImages = await listImages(project.id);
    const imported = await importProjectFiles(async () => JSON.stringify({ format: 'folder-sort-project', version: 2, name: 'Backup', categories: [stash], images: savedImages.map(image => ({ ...image, file: `images/${image.id}/${image.path}` })) }), async path => new Blob([path.endsWith('a.png') ? 'a' : path.endsWith('b.png') ? 'b' : 'c'], { type: 'image/png' }));
    const newStash = (await listCategories(imported.id))[0]; const restored = (await listImages(imported.id))[0];
    expect(restored.categoryId).toBeNull(); expect(restored.boardScope).toBe(newStash.id); expect(restored.boardX).toBe(350);
  });
  it('interprets legacy board placement by membership and targets the centre of fitted images', async () => {
    const { images } = await fixture();
    expect(boardScope({ ...images[0], boardScope:undefined,categoryId:'legacy' })).toBe('legacy');
    expect(inGroupingTarget({x:110,y:45},{left:10,top:20,width:200,height:50})).toBe(true);
    expect(inGroupingTarget({x:20,y:45},{left:10,top:20,width:200,height:50})).toBe(false);
  });
});
