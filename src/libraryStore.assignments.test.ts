import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { addImages, assignImageCategories, createCategory, createProject, listImages, placeImagesOnBoard, saveImageMetadata } from './libraryStore';

async function fixture() {
  const project = await createProject('Category selection');
  const category = await createCategory(project.id, 'Theme/Detail');
  await addImages(project.id, ['one', 'two', 'three'].map(name => ({ file: new File([name], `${name}.png`, { type: 'image/png' }), path: `${name}.png` })));
  return { project, category, images: await listImages(project.id) };
}

describe('batch category assignment', () => {
  it('moves a group atomically and preserves its assignments and relative geometry', async () => {
    const { project, category, images } = await fixture();
    await assignImageCategories(project.id, images.slice(0, 2).map(image => ({ id: image.id, categoryId: category.id })));
    await placeImagesOnBoard(project.id, [{ id: images[0].id, x: 20, y: 80 }, { id: images[1].id, x: 220, y: 80 }]);
    await expect(placeImagesOnBoard(project.id, [{ id: images[0].id, x: 600, y: 500 }, { id: 'missing', x: 800, y: 500 }])).rejects.toThrow('Image not found');
    const saved = await listImages(project.id);
    expect(saved[0]).toMatchObject({ categoryId: category.id, boardX: 20, boardY: 80 });
    expect(saved[1]).toMatchObject({ categoryId: category.id, boardX: 220, boardY: 80 });
  });
  it('saves one selection, preserves existing positions and analysis, and reverses assignments', async () => {
    const { project, category, images } = await fixture();
    await placeImagesOnBoard(project.id, [{ id: images[0].id, x: 250, y: 400 }]);
    const visual = { version: 1, width: 320, height: 160, hash: '0123456789abcdef' };
    await saveImageMetadata(project.id, [{ id: images[0].id, visual }]);
    await assignImageCategories(project.id, [
      { id: images[0].id, categoryId: category.id },
      { id: images[1].id, categoryId: category.id, boardPosition: { x: 450, y: 400 } },
    ]);
    let saved = await listImages(project.id);
    expect(saved[0]).toMatchObject({ categoryId: category.id, placement: 'board', boardX: 250, boardY: 400, visual });
    expect(saved[1]).toMatchObject({ categoryId: category.id, placement: 'board', boardX: 450, boardY: 400 });
    expect(saved[2]).toMatchObject({ categoryId: null, placement: 'tray' });
    await assignImageCategories(project.id, images.slice(0, 2).map(image => ({ id: image.id, categoryId: image.categoryId })));
    saved = await listImages(project.id);
    expect(saved[0]).toMatchObject({ categoryId: null, boardX: 250, boardY: 400, visual });
    expect(saved[1]).toMatchObject({ categoryId: null, boardX: 450, boardY: 400 });
  });

  it('rejects an invalid member or foreign category without partially assigning the selection', async () => {
    const { project, category, images } = await fixture();
    await expect(assignImageCategories(project.id, [{ id: images[0].id, categoryId: category.id }, { id: 'missing', categoryId: category.id }])).rejects.toThrow('Image not found');
    expect((await listImages(project.id)).every(image => image.categoryId === null)).toBe(true);
    const foreign = await createProject('Other project');
    const foreignCategory = await createCategory(foreign.id, 'Other');
    await expect(assignImageCategories(project.id, [{ id: images[0].id, categoryId: category.id }, { id: images[1].id, categoryId: foreignCategory.id }])).rejects.toThrow('Category not found');
    expect((await listImages(project.id)).every(image => image.categoryId === null)).toBe(true);
    await expect(assignImageCategories(project.id, [{ id: images[0].id, categoryId: category.id, boardPosition: { x: NaN, y: 0 } }])).rejects.toThrow('Invalid board position');
  });
});
