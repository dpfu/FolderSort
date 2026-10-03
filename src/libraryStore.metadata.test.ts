import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { addImages, assignImageCategory, createCategory, createProject, importProjectFiles, listImages, placeImagesOnBoard, removeImage, saveImageMetadata } from './libraryStore';
import { ANALYSIS_VERSION } from './imageAnalysis';
import { CLIP_CACHE_KEY, normalizeVector, packVector } from './contentSimilarity';

const visual = { version: ANALYSIS_VERSION, width: 640, height: 480, hash: '0123456789abcdef' };
const clip = packVector(normalizeVector(Float32Array.from({ length: 512 }, (_, index) => index === 0 ? 1 : 0)));

describe('image analysis metadata persistence', () => {
  it('merges cached analysis without undoing sorting performed during analysis', async () => {
    const project = await createProject('Metadata concurrency');
    const original = new File(['original'], 'test.png', { type: 'image/png', lastModified: 1234 });
    await addImages(project.id, [{ file: original, path: original.name }]);
    const [image] = await listImages(project.id);
    expect(image.fileModifiedAt).toBe(1234);
    const category = await createCategory(project.id, 'Sorted');
    await assignImageCategory(image.id, category.id);
    await placeImagesOnBoard(project.id, [{ id: image.id, x: 432, y: 321 }]);
    await saveImageMetadata(project.id, [{ id: image.id, visual }]);
    await saveImageMetadata(project.id, [{ id: image.id, clipSkipped: CLIP_CACHE_KEY }]);
    expect((await listImages(project.id))[0].clipSkipped).toBe(CLIP_CACHE_KEY);
    await saveImageMetadata(project.id, [{ id: image.id, clip }]);
    expect((await listImages(project.id))[0].clipSkipped).toBeUndefined();
    expect((await listImages(project.id))[0]).toMatchObject({ categoryId: category.id, placement: 'board', boardX: 432, boardY: 321, visual, clip, fileModifiedAt: 1234 });
    await removeImage(image.id);
    await saveImageMetadata(project.id, [{ id: image.id, visual }]);
    expect(await listImages(project.id)).toEqual([]);
  });

  it('restores optional cached metadata and still accepts backups without it', async () => {
    const original = new Blob(['original'], { type: 'image/png' });
    const record = { id: 'image', path: 'test.png', file: 'images/image/test.png', mime: 'image/png', size: original.size, addedAt: 5678, categoryId: null, placement: 'tray' };
    const manifest = (image: object) => JSON.stringify({ format: 'folder-sort-project', version: 2, name: 'Metadata backup', categories: [], images: [image] });
    const cachedProject = await importProjectFiles(() => Promise.resolve(manifest({ ...record, visual, clip, fileModifiedAt: 1234 })), () => Promise.resolve(original));
    expect((await listImages(cachedProject.id))[0]).toMatchObject({ visual, clip, fileModifiedAt: 1234 });
    const legacyProject = await importProjectFiles(() => Promise.resolve(manifest(record)), () => Promise.resolve(original));
    expect((await listImages(legacyProject.id))[0].visual).toBeUndefined();
    expect((await listImages(legacyProject.id))[0].clip).toBeUndefined();
    expect((await listImages(legacyProject.id))[0].fileModifiedAt).toBeUndefined();
    const skippedProject = await importProjectFiles(() => Promise.resolve(manifest({ ...record, clipSkipped: CLIP_CACHE_KEY })), () => Promise.resolve(original));
    expect((await listImages(skippedProject.id))[0].clipSkipped).toBe(CLIP_CACHE_KEY);
    await expect(importProjectFiles(() => Promise.resolve(manifest({ ...record, visual: { ...visual, hash: 'invalid' } })), () => Promise.resolve(original))).rejects.toThrow('Invalid image analysis');
    await expect(importProjectFiles(() => Promise.resolve(manifest({ ...record, clip: { ...clip, vector: 'invalid' } })), () => Promise.resolve(original))).rejects.toThrow('Invalid content analysis');
    await expect(importProjectFiles(() => Promise.resolve(manifest({ ...record, clipSkipped: true })), () => Promise.resolve(original))).rejects.toThrow('Invalid content analysis');
  });
});
