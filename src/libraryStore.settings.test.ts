import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { addImages, clearContentAnalysis, createStashWithImages, createProject, exportProjectDirectory, exportProjectZip, getImageBlob, importProjectFiles, listImages, listProjects, placeImagesOnBoard, projectClipEnabled, renameProject, saveImageMetadata, setProjectClipEnabled } from './libraryStore';
import { normalizeVector, packVector } from './contentSimilarity';

// Blob conversion is independent of jsdom's incomplete FileReader implementation.
async function manifest(id: string) {
  const zip = await JSZip.loadAsync(await (await exportProjectZip(id)).arrayBuffer());
  return JSON.parse(await zip.file('project.json')!.async('string'));
}

describe('project content-matching settings', () => {
  it('clears only project content features when rebuilding, preserving originals and layout', async () => {
    const first = await createProject('Rebuild'), other = await createProject('Keep');
    for (const project of [first, other]) await addImages(project.id, [{ file: new File(['original'], 'image.png', { type: 'image/png' }), path: 'image.png' }]);
    const [image] = await listImages(first.id), [outside] = await listImages(other.id);
    await createStashWithImages(first.id, [image.id], null, 'Preserve stash', true);
    const clip = packVector(normalizeVector(Float32Array.from({ length: 512 }, (_, index) => Number(index === 0))));
    await saveImageMetadata(first.id, [{ id: image.id, clip, clipSkipped: 'previous', fileModifiedAt: 123, visual: { version: 1, width: 30, height: 20, hash: '0000000000000000' } }]);
    await saveImageMetadata(other.id, [{ id: outside.id, clip }]);
    await placeImagesOnBoard(first.id, [{ id: image.id, x: 456, y: 789 }]);
    const [before] = await listImages(first.id);
    await clearContentAnalysis(first.id);
    const [after] = await listImages(first.id);
    const { clip: _clip, clipSkipped: _skipped, ...kept } = before;
    expect(after).toEqual(kept);
    expect((await listImages(other.id))[0].clip).toEqual(clip);
    expect(await (await getImageBlob(image.id))!.text()).toBe('original');
  });

  it('recovers an interrupted setting write without changing other project data', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      get length() { return values.size; }, key: (index: number) => [...values.keys()][index] || null,
      getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key),
    });
    try {
      const first = await createProject('Interrupted'), second = await createProject('Other');
      values.set('folder-sort:pending-clip:' + first.id, 'false');
      values.set('folder-sort:pending-clip:missing', 'true');
      values.set('unrelated-preference', 'kept');
      const found = await listProjects();
      expect(found.find(project => project.id === first.id)).toMatchObject({ name: 'Interrupted', createdAt: first.createdAt, settings: { clipEnabled: false } });
      expect(projectClipEnabled(found.find(project => project.id === second.id))).toBe(true);
      expect([...values]).toEqual([['unrelated-preference', 'kept']]);
      const saving = setProjectClipEnabled(first.id, true);
      expect(values.get('folder-sort:pending-clip:' + first.id)).toBe('true');
      await saving; expect(values.has('folder-sort:pending-clip:' + first.id)).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });

  it('enables CLIP for new and legacy projects and saves overrides independently', async () => {
    expect(projectClipEnabled(undefined)).toBe(true);
    expect(projectClipEnabled({})).toBe(true);
    const first = await createProject('First'), second = await createProject('Second');
    expect(first.settings).toEqual({ clipEnabled: true });
    await setProjectClipEnabled(first.id, false); await renameProject(first.id, 'Renamed');
    const found = await listProjects();
    expect(projectClipEnabled(found.find(project => project.id === first.id))).toBe(false);
    expect(projectClipEnabled(found.find(project => project.id === second.id))).toBe(true);
    expect((await setProjectClipEnabled(first.id, true)).settings?.clipEnabled).toBe(true);
    await expect(setProjectClipEnabled('missing', false)).rejects.toThrow('Project not found');
  });

  it('keeps settings in ZIP and directory backups, preserves originals and restores old backups as enabled', async () => {
    const project = await createProject('Settings backup');
    await setProjectClipEnabled(project.id, false);
    let backup = await manifest(project.id);
    expect(backup.settings).toEqual({ clipEnabled: false });
    await addImages(project.id, [{ file: new File(['original'], 'image.png', { type: 'image/png' }), path: 'image.png' }]);
    const written = new Map<string, Blob>();
    const folder = (prefix = ''): FileSystemDirectoryHandle => ({
      getDirectoryHandle: async (name: string) => folder(prefix + name + '/'),
      getFileHandle: async (name: string) => ({ createWritable: async () => ({ write: async (blob: Blob) => { written.set(prefix + name, blob); }, close: async () => {} }) }),
    }) as unknown as FileSystemDirectoryHandle;
    await exportProjectDirectory(project.id, folder());
    backup = JSON.parse(await written.get('project.json')!.text());
    expect(backup.settings).toEqual({ clipEnabled: false });
    const restored = await importProjectFiles(() => Promise.resolve(JSON.stringify(backup)), path => Promise.resolve(written.get(path)));
    expect(projectClipEnabled(restored)).toBe(false);
    const [image] = await listImages(restored.id); expect(await (await getImageBlob(image.id))!.text()).toBe('original');
    delete backup.settings;
    const legacy = await importProjectFiles(() => Promise.resolve(JSON.stringify(backup)), path => Promise.resolve(written.get(path)));
    expect(projectClipEnabled(legacy)).toBe(true);
  });

  it('rejects malformed settings before creating a project', async () => {
    const before = (await listProjects()).length;
    for (const settings of [null, [], false, { clipEnabled: 'false' }]) {
      const backup = { format: 'folder-sort-project', version: 2, name: 'Invalid', settings, categories: [], images: [] };
      await expect(importProjectFiles(() => Promise.resolve(JSON.stringify(backup)), async () => undefined)).rejects.toThrow('Invalid project settings');
    }
    expect((await listProjects()).length).toBe(before);
  });
});

it('keeps a concurrent settings change when the project is renamed', async () => {
  const project = await createProject('Concurrent');
  await Promise.all([renameProject(project.id, 'New name'), setProjectClipEnabled(project.id, false)]);
  expect((await listProjects()).find(item => item.id === project.id)).toMatchObject({ name: 'New name', settings: { clipEnabled: false } });
});
