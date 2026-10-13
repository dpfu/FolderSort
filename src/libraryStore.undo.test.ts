import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { addImages, assignImageCategories, createCategory, createProject, getImageBlob, getImageThumbnail, listImages, placeImagesOnBoard, removeImageWithUndo, restoreImageStates, restoreRemovedImage, returnImagesToTray, saveImageMetadata, saveImageThumbnail } from './libraryStore';

async function fixture() {
  const project = await createProject('Undo study');
  const category = await createCategory(project.id, 'Nature/People');
  await addImages(project.id, ['a', 'b'].map(name => ({ file: new File([`original ${name}`], `${name}.png`, { type: 'image/png', lastModified: 1234 }), path: `${name}.png` })));
  const images = await listImages(project.id);
  await assignImageCategories(project.id, [{ id: images[0].id, categoryId: category.id }]);
  await placeImagesOnBoard(project.id, images.map((image, index) => ({ id: image.id, x: 120 + index * 200, y: 260 })));
  return { project, category, images: await listImages(project.id) };
}

describe('recovering clear, category removal and deletion', () => {
  it('restores exact board positions and keeps categories and newer metadata', async () => {
    const { project, images } = await fixture();
    const states = images.map(image => ({ id: image.id, board: { placement: image.placement, boardX: image.boardX, boardY: image.boardY } }));
    await returnImagesToTray(project.id, images.map(image => image.id));
    expect((await listImages(project.id)).every(image => image.placement === 'tray' && image.boardX === undefined)).toBe(true);
    const visual = { version: 1, width: 320, height: 160, hash: '0123456789abcdef' };
    await saveImageMetadata(project.id, [{ id: images[0].id, visual }]);
    await restoreImageStates(project.id, states);
    const saved = await listImages(project.id);
    expect(saved.map(image => [image.id, image.categoryId, image.placement, image.boardX, image.boardY])).toEqual(images.map(image => [image.id, image.categoryId, image.placement, image.boardX, image.boardY]));
    expect(saved[0].visual).toEqual(visual);
    expect(await (await getImageBlob(images[0].id))!.text()).toBe('original a');
  });
  it('undoes category removal without changing a later board position', async () => {
    const { project, images, category } = await fixture();
    await assignImageCategories(project.id, [{ id: images[0].id, categoryId: null }]);
    await placeImagesOnBoard(project.id, [{ id: images[0].id, x: 400, y: 300 }]);
    await restoreImageStates(project.id, [{ id: images[0].id, categoryId: category.id }]);
    expect((await listImages(project.id))[0]).toMatchObject({ categoryId: category.id, placement: 'board', boardX: 400, boardY: 300 });
  });
  it('aborts a clear or restore if any image belongs to another project or is missing', async () => {
    const { project, images } = await fixture();
    const foreign = await fixture();
    await expect(returnImagesToTray(project.id, [images[0].id, foreign.images[0].id])).rejects.toThrow('Image not found');
    await expect(restoreImageStates(project.id, [{ id: images[0].id, categoryId: null }, { id: 'missing', categoryId: null }])).rejects.toThrow('Image not found');
    await expect(restoreImageStates(project.id, [{ id: images[0].id, categoryId: foreign.category.id }])).rejects.toThrow('Category not found');
    expect(await listImages(project.id)).toEqual(images);
  });
  it('restores the deleted original, thumbnail, membership and layout without duplication', async () => {
    const { project, images } = await fixture();
    await saveImageThumbnail(images[0].id, new Blob(['thumbnail bytes'], { type: 'image/webp' }));
    const removed = await removeImageWithUndo(images[0].id);
    expect(await getImageBlob(images[0].id)).toBeUndefined();
    expect(await getImageThumbnail(images[0].id)).toBeUndefined();
    expect(await listImages(project.id)).toHaveLength(1);
    await restoreRemovedImage(removed!);
    expect(await listImages(project.id)).toEqual(images);
    expect(await (await getImageBlob(images[0].id))!.text()).toBe('original a');
    expect(await (await getImageThumbnail(images[0].id))!.text()).toBe('thumbnail bytes');
    await expect(restoreRemovedImage(removed!)).rejects.toThrow('already in the project');
    expect(await listImages(project.id)).toHaveLength(2);
  });
});
