import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { getImageBlob, addImages, assignImageCategories, createCategory, createProject, exportSortedDirectory, importProjectFiles, listImages, listProjects, placeImagesOnBoard } from './libraryStore';
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
it('reserves the root CSV filename when naming stash folders', async () => {
  const project = await createProject('CSV collision');
  await createCategory(project.id, 'assignments.csv/Child');
  const files = new Map<string, Blob>(), folders = new Set<string>();
  const directory = (prefix = ''): FileSystemDirectoryHandle => ({
    getDirectoryHandle: async (name: string) => { const key = prefix + name; if (files.has(key)) throw new Error('File/folder collision'); folders.add(key); return directory(key + '/'); },
    getFileHandle: async (name: string) => { const key = prefix + name; if (folders.has(key)) throw new Error('File/folder collision'); return { createWritable: async () => ({ write: async (blob: Blob) => { files.set(key, blob); }, close: async () => {} }) }; },
  }) as unknown as FileSystemDirectoryHandle;
  await exportSortedDirectory(project.id, directory());
  expect(files.has('assignments.csv')).toBe(true);
  expect(folders.has('assignments.csv (2)/Child')).toBe(true);
});

it('exports waiting, staged and assigned originals exactly once, reserving special directory names', async () => {
  const project = await createProject('Staging export');
  const collision = await createCategory(project.id, '_Staging/Child');
  await createCategory(project.id, '_Unsorted');
  await addImages(project.id, ['waiting','staged','assigned'].map(name => ({ path: `${name}.png`, file: new File([name], `${name}.png`, { type: 'image/png' }) })));
  const images = await listImages(project.id);
  await placeImagesOnBoard(project.id, [{ id: images.find(image => image.path === 'staged.png')!.id, x: 10, y: 20 }]);
  await assignImageCategories(project.id, [{ id: images.find(image => image.path === 'assigned.png')!.id, categoryId: collision.id }]);
  const files = new Map<string, Blob>(), folders = new Set<string>();
  const directory = (prefix = ''): FileSystemDirectoryHandle => ({
    getDirectoryHandle: async (name: string) => { folders.add(prefix + name); return directory(prefix + name + '/'); },
    getFileHandle: async (name: string) => ({ createWritable: async () => ({ write: async (blob: Blob) => { files.set(prefix + name, blob); }, close: async () => {} }) }),
  }) as unknown as FileSystemDirectoryHandle;
  await exportSortedDirectory(project.id, directory());
  expect([...files.keys()].sort()).toEqual(['_Staging (2)/Child/assigned.png', '_Staging/staged.png', '_Unsorted/waiting.png', 'assignments.csv']);
  expect(folders.has('_Unsorted (2)')).toBe(true);
  expect(await files.get('_Unsorted/waiting.png')!.text()).toBe('waiting');
  expect(await files.get('_Staging/staged.png')!.text()).toBe('staged');
  expect(await files.get('assignments.csv')!.text()).toContain('"assigned.png","_Staging/Child","_Staging (2)/Child/assigned.png"');
});
it.each(['images', 'meta'])('rolls back a synchronous %s write failure during backup restore', async storeName => {
  const before = await listProjects(), db = await (await import('./libraryDatabase')).database;
  const assets = await db.getAllKeys('assets'), images = await db.getAllKeys('images'), categories = await db.getAllKeys('categories');
  const active = await db.get('meta', 'activeProjectId');
  const backup = { ...manifest, categories: [{ id: 'stash', name: 'Restore', createdAt: 1 }], images: [{ ...image, categoryId: 'stash' }] };
  const put = IDBObjectStore.prototype.put;
  let failed = false;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value, key) {
    if (!failed && this.name === storeName) { failed = true; throw new DOMException('Test write failure', 'QuotaExceededError'); }
    return key === undefined ? put.call(this, value) : put.call(this, value, key);
  });
  try {
    await expect(importProjectFiles(async () => JSON.stringify(backup), async () => new Blob(['a']))).rejects.toThrow('Test write failure');
  } finally { spy.mockRestore(); }
  expect(failed).toBe(true);
  expect(await listProjects()).toEqual(before);
  expect(await db.getAllKeys('assets')).toEqual(assets);
  expect(await db.getAllKeys('images')).toEqual(images);
  expect(await db.getAllKeys('categories')).toEqual(categories);
  expect(await db.get('meta', 'activeProjectId')).toBe(active);
});


it('restores SVG MIME types from the manifest and decodes older untyped restores without changing original bytes', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="green"/></svg>';
  const backup = { ...manifest, images: [{ ...image, path: 'drawing.svg', file: 'images/one/drawing.svg', mime: 'image/svg+xml', size: new Blob([svg]).size }] };
  const project = await importProjectFiles(async () => JSON.stringify(backup), async () => new Blob([svg]));
  const [record] = await listImages(project.id), db = await (await import('./libraryDatabase')).database;
  expect((await db.get('assets', record.id))!.type).toBe('image/svg+xml');
  expect(await (await getImageBlob(record.id))!.text()).toBe(svg);
  await db.put('assets', new Blob([svg], { type: 'application/octet-stream' }), record.id);
  expect((await getImageBlob(record.id))!.type).toBe('image/svg+xml');
  expect(await (await getImageBlob(record.id))!.text()).toBe(svg);
  expect((await db.get('assets', record.id))!.type).toBe('application/octet-stream');
});
