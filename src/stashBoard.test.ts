import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { addImages, assignImageCategories, createCategory, createProject, createStashWithImages, importProjectFiles, listCategories, listImages, placeImagesOnBoard, saveImageMetadata, undoStashCreation } from './libraryStore';
import { boardScope, imageOnScopeBoard, inGroupingTarget, stashBoardLayout } from './stashBoard';

async function fixture() {
  const project = await createProject('Stash study');
  await addImages(project.id, ['a','b','c'].map(name => ({ file: new File([name], `${name}.png`, { type: 'image/png' }), path: `${name}.png` })));
  await placeImagesOnBoard(project.id, (await listImages(project.id)).map((image, index) => ({ id: image.id, x: 130 + index * 220, y: 200, boardScope: null })));
  return { project, images: await listImages(project.id) };
}

describe('stash grouping and compatibility', () => {
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
