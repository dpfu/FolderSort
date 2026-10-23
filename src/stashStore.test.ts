import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { addImages, assignImageCategories, createCategory, createProject, getImageBlob, listCategories, listImages, placeImagesOnBoard, removeEmptyStash, restoreEmptyStash } from './libraryStore';

describe('empty stash deletion', () => {
  it('restores the exact container and keeps originals, membership and image positions', async () => {
    const project = await createProject('Empty deletion'), stash = await createCategory(project.id, 'Empty');
    await addImages(project.id, [{ path: 'a.png', file: new File(['original'], 'a.png', { type: 'image/png' }) }]);
    const before = await listImages(project.id);
    const snapshot = await removeEmptyStash(project.id, stash.id);
    expect(await listCategories(project.id)).toEqual([]);
    expect(await listImages(project.id)).toEqual(before);
    expect(await (await getImageBlob(before[0].id))!.text()).toBe('original');
    await restoreEmptyStash(snapshot);
    expect(await listCategories(project.id)).toEqual([stash]);
    expect(await listImages(project.id)).toEqual(before);
    await expect(restoreEmptyStash(snapshot)).rejects.toThrow('already exists');
  });
  it('rejects non-empty and parent stashes, including empty children and stale UI state', async () => {
    const project = await createProject('Protected stash'), stash = await createCategory(project.id, 'Parent');
    const child = await createCategory(project.id, 'Parent/Child');
    await expect(removeEmptyStash(project.id, stash.id)).rejects.toThrow('sub-stashes');
    await addImages(project.id, [{ path: 'a.png', file: new File(['a'], 'a.png', { type: 'image/png' }) }]);
    const [image] = await listImages(project.id);
    await assignImageCategories(project.id, [{ id: image.id, categoryId: child.id }]);
    await expect(removeEmptyStash(project.id, child.id)).rejects.toThrow('images');
    expect(await listCategories(project.id)).toHaveLength(2);
    expect((await listImages(project.id))[0].categoryId).toBe(child.id);
  });
  it('protects a stash after an image is added through its board', async () => {
    const project = await createProject('Folder'), stash = await createCategory(project.id, 'Destination');
    await addImages(project.id, [{ path: 'a.png', file: new File(['a'], 'a.png', { type: 'image/png' }) }]);
    const [image] = await listImages(project.id);
    await placeImagesOnBoard(project.id, [{ id: image.id, x: 432, y: 321, boardScope: stash.id }]);
    await expect(removeEmptyStash(project.id, stash.id)).rejects.toThrow('images');
    expect((await listImages(project.id))[0]).toMatchObject({ categoryId: stash.id, boardScope: stash.id });
  });
  it('rejects another project, a reused name and a missing parent without overwriting data', async () => {
    const project = await createProject('Original'), other = await createProject('Other'), parent = await createCategory(project.id, 'Parent'), child = await createCategory(project.id, 'Parent/Child');
    await expect(removeEmptyStash(other.id, child.id)).rejects.toThrow('this project');
    const snapshot = await removeEmptyStash(project.id, child.id);
    const replacement = await createCategory(project.id, 'Parent/Child');
    await expect(restoreEmptyStash(snapshot)).rejects.toThrow('already exists');
    await removeEmptyStash(project.id, replacement.id); await removeEmptyStash(project.id, parent.id);
    await expect(restoreEmptyStash(snapshot)).rejects.toThrow('parent');
    expect(await listCategories(project.id)).toEqual([]);
  });
});
