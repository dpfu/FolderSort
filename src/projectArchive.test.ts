import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { addImages, assignImageCategories, createCategory, createProject, exportSortedDirectory, importProjectFiles, listImages, listProjects } from './libraryStore';
import { parseBackup } from './projectManifest';

const image = { id: 'one', path: 'one.png', file: 'images/one/one.png', mime: 'image/png', size: 1, addedAt: 1, categoryId: null };
const manifest = { format: 'folder-sort-project', version: 2, name: 'Backup', categories: [], images: [image] };
it('rejects non-finite, fractional and duplicate backup records before reading assets or writing a project', async () => {
  const before = await listProjects(), read = vi.fn(async () => new Blob(['a']));
  const invalid = [
    JSON.stringify(manifest).replace('"size":1', '"size":1e400'),
    JSON.stringify({ ...manifest, images: [{ ...image, size: 1.5 }] }),
    JSON.stringify(manifest).replace('"addedAt":1', '"addedAt":1e400'),
    JSON.stringify({ ...manifest, images: [image, { ...image, id: 'two', file: 'images/two/one.png' }] }),
    JSON.stringify({ ...manifest, images: [{ ...image, path: '../one.png' }] }),
    JSON.stringify({ ...manifest, categories: [{ id: 'stash', name: 'Stash', createdAt: -1 }] }),
  ];
  for (const raw of invalid) await expect(importProjectFiles(async () => raw, read)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled(); expect(await listProjects()).toEqual(before);
});
it('whitelists stash fields while keeping old manifests compatible', () => {
  const parsed = parseBackup(JSON.stringify({ ...manifest, categories: [{ id: 's', name: 'Stash', createdAt: 1, unknown: 'discard', layoutInitialized: false }] }));
  expect(parsed.categories).toEqual([{ id: 's', name: 'Stash', createdAt: 1, layoutInitialized: false }]);
  expect(parsed.settings.clipEnabled).toBe(true);
  expect(parseBackup(JSON.stringify({ ...manifest, format: 'sortboard-image-library', version: 1 })).images[0].categoryId).toBeNull();
});
it('rolls back imported images and stashes when a later asset is missing', async () => {
  const before = await listProjects();
  const raw = JSON.stringify({ ...manifest, categories: [{ id: 'stash', name: 'Stash', createdAt: 1 }], images: [image, { ...image, id: 'two', path: 'two.png', file: 'images/two/two.png' }] });
  await expect(importProjectFiles(async () => raw, async path => path.includes('/one/') ? new Blob(['a']) : undefined)).rejects.toThrow('Missing or changed original');
  expect(await listProjects()).toEqual(before);
  const db = await (await import('./libraryDatabase')).database;
  const images = await db.getAll('images'), categories = await db.getAll('categories');
  const ids = new Set(before.map(project => project.id));
  expect(images.every(record => ids.has(record.projectId))).toBe(true);
  expect(categories.every(record => ids.has(record.projectId))).toBe(true);
});
it('exports a filename matching a child folder to a distinct path', async () => {
  const project = await createProject('Collision'), parent = await createCategory(project.id, 'Parent');
  await createCategory(project.id, 'Parent/nested.png');
  await addImages(project.id, [{ file: new File(['original'], 'nested.png', { type: 'image/png' }), path: 'nested.png' }]);
  const [record] = await listImages(project.id); await assignImageCategories(project.id, [{ id: record.id, categoryId: parent.id }]);
  const files = new Map<string, Blob>(), folders = new Set<string>();
  const directory = (prefix = ''): FileSystemDirectoryHandle => ({
    getDirectoryHandle: async (name: string) => { const key = prefix + name; if (files.has(key)) throw new Error('File/folder collision'); folders.add(key); return directory(key + '/'); },
    getFileHandle: async (name: string) => { const key = prefix + name; if (folders.has(key)) throw new Error('File/folder collision'); return { createWritable: async () => ({ write: async (blob: Blob) => { files.set(key, blob); }, close: async () => {} }) }; },
  }) as unknown as FileSystemDirectoryHandle;
  await exportSortedDirectory(project.id, directory());
  expect(folders.has('Parent/nested.png')).toBe(true);
  expect(await files.get('Parent/nested (2).png')!.text()).toBe('original');
  expect(await files.get('assignments.csv')!.text()).toContain('Parent/nested (2).png');
});
