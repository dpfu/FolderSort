import { openDB, type DBSchema } from 'idb';
import JSZip from 'jszip';
import { nanoid } from 'nanoid';
import { isVisualAnalysis, type ImageMetadata } from './imageAnalysis';
import { isContentAnalysis } from './contentSimilarity';

export type LibraryProject = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type LibraryImage = ImageMetadata & {
  id: string;
  projectId: string;
  path: string;
  mime: string;
  size: number;
  addedAt: number;
  categoryId: string | null;
  // Missing means board for projects created before the three-area workspace.
  placement?: 'board' | 'tray';
  boardX?: number;
  boardY?: number;
};

export function imageIsOnBoard(image: LibraryImage): boolean {
  return image.placement !== 'tray';
}

export type LibraryCategory = {
  id: string;
  projectId: string;
  name: string;
  createdAt: number;
};

export type IncomingImage = { file: File; path: string };

type BackupV2 = {
  format: 'folder-sort-project';
  version: 2;
  name: string;
  categories: Array<Omit<LibraryCategory, 'projectId'>>;
  images: Array<Omit<LibraryImage, 'projectId'> & { file: string }>;
};

type ParsedBackup = Pick<BackupV2, 'name' | 'categories' | 'images'>;

interface LibraryDB extends DBSchema {
  projects: { key: string; value: LibraryProject };
  images: { key: string; value: LibraryImage; indexes: { byProject: string } };
  categories: { key: string; value: LibraryCategory; indexes: { byProject: string } };
  assets: { key: string; value: Blob };
  meta: { key: string; value: string };
}

const database = openDB<LibraryDB>('sortboard-image-library-minimal', 2, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects');
    if (!db.objectStoreNames.contains('images')) db.createObjectStore('images').createIndex('byProject', 'projectId');
    if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets');
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories').createIndex('byProject', 'projectId');
  },
});

export function cleanRelativePath(value: string): string {
  const parts = value.replaceAll('\\', '/').split('/').filter((part) => part && part !== '.');
  if (!parts.length || parts.some((part) => part === '..' || part.includes('\0'))) {
    throw new Error('Invalid file path');
  }
  return parts.join('/');
}

function imageMime(file: File): string | null {
  if (file.type.startsWith('image/')) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml' } as Record<string, string>)[extension || ''] || null;
}

export function isImageFile(file: File): boolean {
  return Boolean(imageMime(file));
}

export async function listProjects(): Promise<LibraryProject[]> {
  return (await (await database).getAll('projects')).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getActiveProjectId(): Promise<string | undefined> {
  return (await (await database).get('meta', 'activeProjectId')) || undefined;
}

export async function setActiveProjectId(id: string): Promise<void> {
  await (await database).put('meta', id, 'activeProjectId');
}

export async function createProject(name: string): Promise<LibraryProject> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a project name');
  const now = Date.now();
  const project = { id: nanoid(), name: trimmed, createdAt: now, updatedAt: now };
  const tx = (await database).transaction(['projects', 'meta'], 'readwrite');
  await tx.objectStore('projects').put(project, project.id);
  await tx.objectStore('meta').put(project.id, 'activeProjectId');
  await tx.done;
  return project;
}

export async function renameProject(id: string, name: string): Promise<LibraryProject> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a project name');
  const db = await database;
  const project = await db.get('projects', id);
  if (!project) throw new Error('Project not found');
  const updated = { ...project, name: trimmed, updatedAt: Date.now() };
  await db.put('projects', updated, id);
  return updated;
}

export async function listImages(projectId: string): Promise<LibraryImage[]> {
  return (await (await database).getAllFromIndex('images', 'byProject', projectId))
    .map((image) => ({ ...image, categoryId: image.categoryId || null }))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

export async function listCategories(projectId: string): Promise<LibraryCategory[]> {
  const db = await database;
  const tx = db.transaction('categories', 'readwrite');
  const categories = await tx.store.index('byProject').getAll(projectId);
  const known = new Set(categories.map((category) => category.name.toLocaleLowerCase()));
  // Projects created before Folder Sort may have a nested leaf without its parent records.
  for (const category of [...categories]) {
    const parts = category.name.split('/');
    for (let length = 1; length < parts.length; length++) {
      const name = parts.slice(0, length).join('/');
      if (known.has(name.toLocaleLowerCase())) continue;
      const parent = { id: nanoid(), projectId, name, createdAt: category.createdAt };
      await tx.store.put(parent, parent.id);
      categories.push(parent);
      known.add(name.toLocaleLowerCase());
    }
  }
  await tx.done;
  return categories.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function cleanCategoryName(value: string): string {
  const name = cleanRelativePath(value.trim());
  if (name.split('/')[0].toLocaleLowerCase() === '_unassigned') throw new Error('This category name is reserved');
  return name;
}

export async function createCategory(projectId: string, name: string): Promise<LibraryCategory> {
  const cleanName = cleanCategoryName(name);
  const db = await database;
  if (!(await db.get('projects', projectId))) throw new Error('Project not found');
  const existing = await listCategories(projectId);
  if (existing.some((category) => category.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) {
    throw new Error('Category already exists');
  }
  const additions: LibraryCategory[] = [];
  let path = '';
  for (const part of cleanName.split('/')) {
    const candidate = path ? `${path}/${part}` : part;
    const present = existing.find((category) => category.name.toLocaleLowerCase() === candidate.toLocaleLowerCase());
    if (present) {
      path = present.name;
    } else {
      const category = { id: nanoid(), projectId, name: candidate, createdAt: Date.now() };
      additions.push(category);
      existing.push(category);
      path = candidate;
    }
  }
  const tx = db.transaction('categories', 'readwrite');
  for (const category of additions) await tx.store.put(category, category.id);
  await tx.done;
  return additions.at(-1)!;
}

export async function renameCategory(id: string, name: string): Promise<LibraryCategory> {
  const cleanName = cleanCategoryName(name);
  const db = await database;
  const category = await db.get('categories', id);
  if (!category) throw new Error('Category not found');
  const existing = await listCategories(category.projectId);
  const oldPrefix = `${category.name}/`;
  if (cleanName.toLocaleLowerCase().startsWith(oldPrefix.toLocaleLowerCase())) {
    throw new Error('A category cannot move inside itself');
  }
  const moving = existing.filter((item) => item.id === id || item.name.toLocaleLowerCase().startsWith(oldPrefix.toLocaleLowerCase()));
  const other = existing.filter((item) => !moving.some((move) => move.id === item.id));
  const additions: LibraryCategory[] = [];
  let parent = '';
  const parts = cleanName.split('/');
  for (const part of parts.slice(0, -1)) {
    const candidate = parent ? `${parent}/${part}` : part;
    const present = other.find((item) => item.name.toLocaleLowerCase() === candidate.toLocaleLowerCase());
    if (present) parent = present.name;
    else {
      const created = { id: nanoid(), projectId: category.projectId, name: candidate, createdAt: Date.now() };
      additions.push(created);
      other.push(created);
      parent = candidate;
    }
  }
  const newName = parent ? `${parent}/${parts.at(-1)}` : parts[0];
  const renamed = moving.map((item) => ({ ...item, name: item.id === id ? newName : `${newName}${item.name.slice(category.name.length)}` }));
  const names = new Set(other.map((item) => item.name.toLocaleLowerCase()));
  for (const item of renamed) {
    const key = item.name.toLocaleLowerCase();
    if (names.has(key)) throw new Error('Category already exists');
    names.add(key);
  }
  const tx = db.transaction('categories', 'readwrite');
  for (const item of additions) await tx.store.put(item, item.id);
  for (const item of renamed) await tx.store.put(item, item.id);
  await tx.done;
  return renamed.find((item) => item.id === id)!;
}

export async function assignImageCategory(imageId: string, categoryId: string | null, boardPosition?: { x: number; y: number }): Promise<void> {
  if (boardPosition && ![boardPosition.x, boardPosition.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 100_000)) {
    throw new Error('Invalid board position');
  }
  const db = await database;
  const category = categoryId ? await db.get('categories', categoryId) : undefined;
  if (categoryId && !category) throw new Error('Category not found in this project');
  const tx = db.transaction(['images', 'projects'], 'readwrite');
  const image = await tx.objectStore('images').get(imageId);
  if (!image) throw new Error('Image not found');
  if (category && category.projectId !== image.projectId) throw new Error('Category not found in this project');
  await tx.objectStore('images').put({ ...image, categoryId, ...(boardPosition ? {
    placement: 'board' as const, boardX: Math.round(boardPosition.x), boardY: Math.round(boardPosition.y),
  } : {}) }, image.id);
  const project = await tx.objectStore('projects').get(image.projectId);
  if (project) await tx.objectStore('projects').put({ ...project, updatedAt: Date.now() }, project.id);
  await tx.done;
}

export type CategoryAssignment = { id: string; categoryId: string | null; boardPosition?: { x: number; y: number } };

/** Assign a selection in one transaction, merging the latest records (including analysis). */
export async function assignImageCategories(projectId: string, assignments: CategoryAssignment[]): Promise<void> {
  if (!assignments.length) return;
  if (assignments.some(({ boardPosition }) => boardPosition && ![boardPosition.x, boardPosition.y].every(value => Number.isFinite(value) && value >= 0 && value <= 100_000))) {
    throw new Error('Invalid board position');
  }
  const db = await database;
  const tx = db.transaction(['images', 'projects', 'categories'], 'readwrite');
  try {
    const project = await tx.objectStore('projects').get(projectId);
    if (!project) throw new Error('Project not found');
    const categoryIds = new Set(assignments.flatMap(item => item.categoryId ? [item.categoryId] : []));
    // Safari pays a substantial cost per database request. For large selections,
    // read the project's records once; keep small, frequent assignments targeted.
    const recordRequest = assignments.length > 64
      ? tx.objectStore('images').index('byProject').getAll(projectId).then(images => {
        const byId = new Map(images.map(image => [image.id, image]));
        return assignments.map(assignment => byId.get(assignment.id));
      })
      : Promise.all(assignments.map(assignment => tx.objectStore('images').get(assignment.id)));
    const [categories, records] = await Promise.all([
      Promise.all([...categoryIds].map(id => tx.objectStore('categories').get(id))),
      recordRequest,
    ]);
    for (const category of categories) {
      if (!category || category.projectId !== projectId) throw new Error('Category not found in this project');
    }
    const updates: LibraryImage[] = [];
    for (const [index, assignment] of assignments.entries()) {
      const image = records[index];
      if (!image || image.projectId !== projectId) throw new Error('Image not found in this project');
      updates.push({ ...image, categoryId: assignment.categoryId, ...(assignment.boardPosition ? {
        placement: 'board', boardX: Math.round(assignment.boardPosition.x), boardY: Math.round(assignment.boardPosition.y),
      } : {}) });
    }
    await Promise.all(updates.map(image => tx.objectStore('images').put(image, image.id)));
    await tx.objectStore('projects').put({ ...project, updatedAt: Date.now() }, projectId);
    await tx.done;
  } catch (cause) {
    try { tx.abort(); } catch { /* The transaction may already be aborted. */ }
    await tx.done.catch(() => {});
    throw cause;
  }
}

export async function setImageBoardPosition(imageId: string, x: number, y: number): Promise<void> {
  if (![x, y].every((value) => Number.isFinite(value) && value >= 0 && value <= 100_000)) {
    throw new Error('Invalid board position');
  }
  const db = await database;
  const tx = db.transaction(['images', 'projects'], 'readwrite');
  const image = await tx.objectStore('images').get(imageId);
  if (!image) throw new Error('Image not found');
  await tx.objectStore('images').put({ ...image, placement: 'board', boardX: Math.round(x), boardY: Math.round(y) }, imageId);
  const project = await tx.objectStore('projects').get(image.projectId);
  if (project) await tx.objectStore('projects').put({ ...project, updatedAt: Date.now() }, project.id);
  await tx.done;
}

export async function placeImagesOnBoard(projectId: string, moves: Array<{ id: string; x: number; y: number }>): Promise<void> {
  if (!moves.length) return;
  if (moves.some(({ x, y }) => ![x, y].every((value) => Number.isFinite(value) && value >= 0 && value <= 100_000))) {
    throw new Error('Invalid board position');
  }
  const db = await database;
  const tx = db.transaction(['images', 'projects'], 'readwrite');
  for (const move of moves) {
    const image = await tx.objectStore('images').get(move.id);
    if (!image || image.projectId !== projectId) throw new Error('Image not found in this project');
    await tx.objectStore('images').put({ ...image, placement: 'board', boardX: Math.round(move.x), boardY: Math.round(move.y) }, move.id);
  }
  const project = await tx.objectStore('projects').get(projectId);
  if (project) await tx.objectStore('projects').put({ ...project, updatedAt: Date.now() }, projectId);
  await tx.done;
}

export async function returnImagesToTray(projectId: string, imageIds: string[]): Promise<void> {
  if (!imageIds.length) return;
  const db = await database;
  const tx = db.transaction(['images', 'projects'], 'readwrite');
  for (const id of imageIds) {
    const image = await tx.objectStore('images').get(id);
    if (!image || image.projectId !== projectId) throw new Error('Image not found in this project');
    const { boardX: _x, boardY: _y, ...rest } = image;
    await tx.objectStore('images').put({ ...rest, placement: 'tray' }, id);
  }
  const project = await tx.objectStore('projects').get(projectId);
  if (project) await tx.objectStore('projects').put({ ...project, updatedAt: Date.now() }, projectId);
  await tx.done;
}

export async function getImageBlob(id: string): Promise<Blob | undefined> {
  return (await database).get('assets', id);
}

// Derived previews share the asset store but never replace originals or enter
// exports. A versioned key allows changing their resolution/encoding later.
const thumbnailKey = (id: string) => `thumbnail:v1:${id}`;

export async function getImageThumbnail(id: string): Promise<Blob | undefined> {
  return (await database).get('assets', thumbnailKey(id));
}

export async function saveImageThumbnail(id: string, blob: Blob): Promise<void> {
  const tx = (await database).transaction(['images', 'assets'], 'readwrite');
  // A decode finishing after removal must not recreate an orphaned asset.
  if (await tx.objectStore('images').get(id)) await tx.objectStore('assets').put(blob, thumbnailKey(id));
  await tx.done;
}

/** Merge analysis into the latest record so a background job cannot undo a drag
 * or category assignment made while the original was being decoded. */
export async function saveImageMetadata(projectId: string, patches: Array<ImageMetadata & { id: string }>): Promise<void> {
  const tx = (await database).transaction('images', 'readwrite');
  for (const patch of patches) {
    const image = await tx.store.get(patch.id);
    if (!image || image.projectId !== projectId) continue;
    await tx.store.put({ ...image,
      ...(patch.visual ? { visual: patch.visual } : {}),
      ...(patch.clip ? { clip: patch.clip, clipSkipped: undefined } : {}),
      ...(patch.clipSkipped ? { clipSkipped: patch.clipSkipped } : {}),
      ...(patch.fileModifiedAt !== undefined ? { fileModifiedAt: patch.fileModifiedAt } : {}),
    }, image.id);
  }
  await tx.done;
}

/** Each image is committed atomically. The UI displays it only after tx.done. */
export async function addImages(
  projectId: string,
  incoming: IncomingImage[],
  onProgress?: (done: number, total: number) => void,
  initialCategoryByPath?: Map<string, string>,
): Promise<{ added: number; skipped: number }> {
  const db = await database;
  const project = await db.get('projects', projectId);
  if (!project) throw new Error('Project not found');
  const known = new Set((await listImages(projectId)).map((image) => image.path));
  let added = 0;
  let skipped = 0;
  for (const item of incoming) {
    const mime = imageMime(item.file);
    const path = cleanRelativePath(item.path);
    if (!mime || known.has(path)) {
      skipped++;
      onProgress?.(added + skipped, incoming.length);
      continue;
    }
    const id = nanoid();
    const now = Date.now();
    const image: LibraryImage = { id, projectId, path, mime, size: item.file.size, addedAt: now,
      fileModifiedAt: Number.isFinite(item.file.lastModified) ? item.file.lastModified : null,
      categoryId: initialCategoryByPath?.get(path) || null, placement: 'tray' };
    const tx = db.transaction(['assets', 'images', 'projects'], 'readwrite');
    await tx.objectStore('assets').put(item.file, id);
    await tx.objectStore('images').put(image, id);
    await tx.objectStore('projects').put({ ...project, updatedAt: now }, projectId);
    await tx.done;
    known.add(path);
    added++;
    onProgress?.(added + skipped, incoming.length);
  }
  return { added, skipped };
}

export async function removeImage(id: string): Promise<void> {
  const db = await database;
  const image = await db.get('images', id);
  if (!image) return;
  const tx = db.transaction(['images', 'assets', 'projects'], 'readwrite');
  await tx.objectStore('images').delete(id);
  await tx.objectStore('assets').delete(id);
  await tx.objectStore('assets').delete(thumbnailKey(id));
  const project = await tx.objectStore('projects').get(image.projectId);
  if (project) await tx.objectStore('projects').put({ ...project, updatedAt: Date.now() }, project.id);
  await tx.done;
}

function backupPath(image: Pick<LibraryImage, 'id' | 'path'>): string {
  return `images/${image.id}/${image.path.split('/').at(-1)}`;
}

async function backupSnapshot(projectId: string): Promise<{ backup: BackupV2; images: LibraryImage[] }> {
  const db = await database;
  const project = await db.get('projects', projectId);
  if (!project) throw new Error('Project not found');
  const images = await listImages(projectId);
  const categories = await listCategories(projectId);
  const backup: BackupV2 = {
    format: 'folder-sort-project',
    version: 2,
    name: project.name,
    categories: categories.map(({ projectId: _projectId, ...category }) => category),
    images: images.map(({ projectId: _projectId, ...image }) => ({ ...image, file: backupPath(image) })),
  };
  return { backup, images };
}

export async function exportProjectZip(projectId: string): Promise<Blob> {
  const { backup, images } = await backupSnapshot(projectId);
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify(backup, null, 2));
  for (const image of images) {
    const blob = await getImageBlob(image.id);
    if (!blob) throw new Error(`Missing original: ${image.path}`);
    zip.file(backupPath(image), blob);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

async function writeToDirectory(folder: FileSystemDirectoryHandle, path: string, blob: Blob): Promise<void> {
  const parts = cleanRelativePath(path).split('/');
  let target = folder;
  for (const part of parts.slice(0, -1)) target = await target.getDirectoryHandle(part, { create: true });
  const file = await target.getFileHandle(parts.at(-1)!, { create: true });
  const stream = await file.createWritable();
  await stream.write(blob);
  await stream.close();
}

export async function exportProjectDirectory(projectId: string, folder: FileSystemDirectoryHandle): Promise<void> {
  const { backup, images } = await backupSnapshot(projectId);
  // Write originals first, then the manifest. An incomplete export has no valid manifest.
  for (const image of images) {
    const blob = await getImageBlob(image.id);
    if (!blob) throw new Error(`Missing original: ${image.path}`);
    await writeToDirectory(folder, backupPath(image), blob);
  }
  await writeToDirectory(folder, 'project.json', new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
}

type SortedFile = { image: LibraryImage; category: string; exportedPath: string };
type SortedSnapshot = { files: SortedFile[]; folders: string[] };

function safeSegment(segment: string): string {
  return segment.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim() || 'Untitled';
}

function sortedFiles(images: LibraryImage[], categories: LibraryCategory[]): SortedSnapshot {
  const categoryById = new Map(categories.map((category) => [category.id, category.name]));
  const usedFolders = new Set<string>(['_unassigned']);
  const outputFolder = new Map<string, string>();
  const folderByCategoryName = new Map<string, string>();
  for (const category of [...categories].sort((a, b) =>
    a.name.split('/').length - b.name.split('/').length || a.name.localeCompare(b.name, undefined, { numeric: true }))) {
    const parts = category.name.split('/');
    const parentName = parts.slice(0, -1).join('/').toLocaleLowerCase();
    const parentFolder = folderByCategoryName.get(parentName);
    const base = safeSegment(parts.at(-1)!);
    let candidate = parentFolder ? `${parentFolder}/${base}` : base;
    let suffix = 2;
    while (usedFolders.has(candidate.toLocaleLowerCase())) {
      const last = `${base} (${suffix++})`;
      candidate = parentFolder ? `${parentFolder}/${last}` : last;
    }
    usedFolders.add(candidate.toLocaleLowerCase());
    outputFolder.set(category.id, candidate);
    folderByCategoryName.set(category.name.toLocaleLowerCase(), candidate);
  }
  const usedFiles = new Set<string>();
  const files = images.map((image) => {
    const category = image.categoryId ? categoryById.get(image.categoryId) || '' : '';
    const folder = image.categoryId ? outputFolder.get(image.categoryId) || '_Unassigned' : '_Unassigned';
    const originalName = safeSegment(image.path.split('/').at(-1) || 'image');
    const dot = originalName.lastIndexOf('.');
    const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
    const extension = dot > 0 ? originalName.slice(dot) : '';
    let filename = originalName;
    let suffix = 2;
    while (usedFiles.has(`${folder}/${filename}`.toLocaleLowerCase())) filename = `${stem} (${suffix++})${extension}`;
    const exportedPath = `${folder}/${filename}`;
    usedFiles.add(exportedPath.toLocaleLowerCase());
    return { image, category, exportedPath };
  });
  return { files, folders: ['_Unassigned', ...outputFolder.values()] };
}

function assignmentsCsv(files: SortedFile[]): string {
  const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return ['original_path,category,exported_path', ...files.map(({ image, category, exportedPath }) =>
    [image.path, category, exportedPath].map(cell).join(','))].join('\r\n') + '\r\n';
}

async function sortedSnapshot(projectId: string): Promise<SortedSnapshot> {
  const db = await database;
  if (!(await db.get('projects', projectId))) throw new Error('Project not found');
  return sortedFiles(await listImages(projectId), await listCategories(projectId));
}

export async function exportSortedZip(projectId: string): Promise<Blob> {
  const { files, folders } = await sortedSnapshot(projectId);
  const zip = new JSZip();
  for (const folder of folders) zip.folder(folder);
  for (const { image, exportedPath } of files) {
    const blob = await getImageBlob(image.id);
    if (!blob) throw new Error(`Missing original: ${image.path}`);
    zip.file(exportedPath, blob);
  }
  zip.file('assignments.csv', assignmentsCsv(files));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function exportSortedDirectory(projectId: string, folder: FileSystemDirectoryHandle): Promise<void> {
  const { files, folders } = await sortedSnapshot(projectId);
  for (const path of folders) {
    let target = folder;
    for (const part of path.split('/')) target = await target.getDirectoryHandle(part, { create: true });
  }
  for (const { image, exportedPath } of files) {
    const blob = await getImageBlob(image.id);
    if (!blob) throw new Error(`Missing original: ${image.path}`);
    await writeToDirectory(folder, exportedPath, blob);
  }
  await writeToDirectory(folder, 'assignments.csv', new Blob([assignmentsCsv(files)], { type: 'text/csv;charset=utf-8' }));
}

function parseBackup(raw: string): ParsedBackup {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid project manifest');
  const backup = value as { format?: unknown; version?: unknown; name?: unknown; images?: unknown; categories?: unknown };
  if ((backup.format !== 'folder-sort-project' && backup.format !== 'sortboard-image-library') ||
      (backup.version !== 1 && backup.version !== 2) ||
      typeof backup.name !== 'string' || !Array.isArray(backup.images)) {
    throw new Error('Unsupported project export');
  }
  const categories = backup.version === 2 ? backup.categories : [];
  if (!Array.isArray(categories)) throw new Error('Invalid category list');
  const images = backup.images as BackupV2['images'];
  const categoryIds = new Set<string>();
  const categoryNames = new Set<string>();
  for (const category of categories) {
    if (!category || typeof category.id !== 'string' || !/^[\w-]+$/.test(category.id) ||
        categoryIds.has(category.id) || typeof category.name !== 'string' ||
        typeof category.createdAt !== 'number') throw new Error('Invalid category record');
    const cleanName = cleanCategoryName(category.name);
    if (cleanName !== category.name || categoryNames.has(cleanName.toLocaleLowerCase())) throw new Error('Invalid category name');
    categoryIds.add(category.id);
    categoryNames.add(cleanName.toLocaleLowerCase());
  }
  const ids = new Set<string>();
  for (const image of images) {
    if (!image || typeof image.id !== 'string' || !/^[\w-]+$/.test(image.id) || ids.has(image.id) ||
        typeof image.path !== 'string' || typeof image.file !== 'string' ||
        typeof image.mime !== 'string' || !image.mime.startsWith('image/') ||
        typeof image.size !== 'number' || image.size < 0 ||
        typeof image.addedAt !== 'number') throw new Error('Invalid image record');
    if (backup.version === 2 && image.categoryId != null &&
        (typeof image.categoryId !== 'string' || !categoryIds.has(image.categoryId))) {
      throw new Error('Invalid image category');
    }
    if ((image.boardX != null || image.boardY != null) &&
        (typeof image.boardX !== 'number' || typeof image.boardY !== 'number' ||
         ![image.boardX, image.boardY].every((value) => Number.isFinite(value) && value >= 0 && value <= 100_000))) {
      throw new Error('Invalid image board position');
    }
    if (image.placement != null && image.placement !== 'board' && image.placement !== 'tray') {
      throw new Error('Invalid image placement');
    }
    if (image.visual !== undefined && !isVisualAnalysis(image.visual)) throw new Error('Invalid image analysis');
    if (image.clip !== undefined && !isContentAnalysis(image.clip)) throw new Error('Invalid content analysis');
    if (image.clipSkipped !== undefined && (typeof image.clipSkipped !== 'string' || image.clipSkipped.length > 200 || !/^[\w/@:.-]+$/.test(image.clipSkipped))) throw new Error('Invalid content analysis');
    if (image.fileModifiedAt != null &&
        (typeof image.fileModifiedAt !== 'number' || !Number.isFinite(image.fileModifiedAt) || Math.abs(image.fileModifiedAt) > 8.64e15)) {
      throw new Error('Invalid image file date');
    }
    cleanRelativePath(image.path);
    if (cleanRelativePath(image.file) !== `images/${image.id}/${image.path.split('/').at(-1)}`) {
      throw new Error('Invalid image asset path');
    }
    ids.add(image.id);
  }
  return {
    name: backup.name,
    categories: categories as BackupV2['categories'],
    images: images.map((image) => ({ ...image, categoryId: backup.version === 2 ? image.categoryId || null : null })),
  };
}

export async function importProjectFiles(
  readText: () => Promise<string>,
  readAsset: (path: string) => Promise<Blob | undefined>,
): Promise<LibraryProject> {
  const backup = parseBackup(await readText());
  const db = await database;
  const now = Date.now();
  const project: LibraryProject = { id: nanoid(), name: backup.name, createdAt: now, updatedAt: now };
  const written: string[] = [];
  const writtenCategories: string[] = [];
  try {
    const categoryIds = new Map<string, string>();
    for (const category of backup.categories) {
      const id = nanoid();
      await db.put('categories', { ...category, id, projectId: project.id }, id);
      categoryIds.set(category.id, id);
      writtenCategories.push(id);
    }
    // Validate all referenced assets before exposing the new project in the list.
    for (const image of backup.images) {
      const blob = await readAsset(image.file);
      if (!blob || blob.size !== image.size) throw new Error(`Missing or changed original: ${image.path}`);
      const id = nanoid();
      const tx = db.transaction(['assets', 'images'], 'readwrite');
      await tx.objectStore('assets').put(blob, id);
      await tx.objectStore('images').put({ id, projectId: project.id, path: image.path, mime: image.mime, size: image.size, addedAt: image.addedAt,
        categoryId: image.categoryId ? categoryIds.get(image.categoryId)! : null,
        placement: image.placement, boardX: image.boardX, boardY: image.boardY,
        visual: image.visual, clip: image.clip, clipSkipped: image.clipSkipped, fileModifiedAt: image.fileModifiedAt }, id);
      await tx.done;
      written.push(id);
    }
    const tx = db.transaction(['projects', 'meta'], 'readwrite');
    await tx.objectStore('projects').put(project, project.id);
    await tx.objectStore('meta').put(project.id, 'activeProjectId');
    await tx.done;
    return project;
  } catch (error) {
    const tx = db.transaction(['assets', 'images', 'categories'], 'readwrite');
    for (const id of written) {
      await tx.objectStore('assets').delete(id);
      await tx.objectStore('images').delete(id);
    }
    for (const id of writtenCategories) await tx.objectStore('categories').delete(id);
    await tx.done;
    throw error;
  }
}

export async function importProjectZip(file: File): Promise<LibraryProject> {
  const zip = await JSZip.loadAsync(file);
  const manifest = zip.file('project.json');
  if (!manifest) throw new Error('Missing project.json');
  return importProjectFiles(
    () => manifest.async('string'),
    async (path) => {
      const item = zip.file(path);
      return item ? item.async('blob') : undefined;
    },
  );
}

export async function importProjectDirectory(entries: File[]): Promise<LibraryProject> {
  const manifest = entries.find((file) => file.webkitRelativePath.endsWith('/project.json'));
  if (!manifest) throw new Error('Choose a folder containing project.json');
  const root = manifest.webkitRelativePath.slice(0, -'project.json'.length);
  const byPath = new Map(entries.map((file) => [file.webkitRelativePath.slice(root.length), file]));
  return importProjectFiles(() => manifest.text(), async (path) => byPath.get(path));
}
