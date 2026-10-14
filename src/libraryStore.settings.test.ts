import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { addImages, createProject, exportProjectDirectory, exportProjectZip, getImageBlob, importProjectFiles, listImages, listProjects, projectClipEnabled, renameProject, setProjectClipEnabled } from './libraryStore';

// Blob conversion is independent of jsdom's incomplete FileReader implementation.
async function manifest(id: string) {
  const zip = await JSZip.loadAsync(await (await exportProjectZip(id)).arrayBuffer());
  return JSON.parse(await zip.file('project.json')!.async('string'));
}

describe('project content-matching settings', () => {
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
