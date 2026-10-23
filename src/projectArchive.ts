import { compareNames } from './sortNames';
import JSZip from 'jszip';
import { nanoid } from 'nanoid';
import { database, commitTransaction } from './libraryDatabase';
import { parseBackup, type BackupV2 } from './projectManifest';
import { listImages, listCategories, getImageBlob, cleanRelativePath, projectClipEnabled, normalizeFolderImage, type LibraryProject, type LibraryImage, type LibraryCategory } from './imageStore';

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
    settings: { clipEnabled: projectClipEnabled(project) },
    categories: categories.map(({ projectId: _projectId, ...category }) => category),
    images: images.map(({ projectId: _projectId, ...image }) => ({ ...image, file: backupPath(image) })),
  };
  return { backup, images };
}

// Raster formats with their own compression do not benefit from another pass.
// Keep SVG and other uncompressed formats compact in both kinds of ZIP export.
const compressedImageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/heic', 'image/heif']);
const imageCompression = (image: LibraryImage) => compressedImageTypes.has(image.mime.toLowerCase().split(';')[0]) ? 'STORE' as const : 'DEFLATE' as const;

export async function exportProjectZip(projectId: string): Promise<Blob> {
  const { backup, images } = await backupSnapshot(projectId);
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify(backup, null, 2));
  for (const image of images) {
    const blob = await getImageBlob(image.id);
    if (!blob) throw new Error(`Missing original: ${image.path}`);
    zip.file(backupPath(image), blob, { compression: imageCompression(image) });
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
  const usedFolders = new Set<string>(['_unassigned', 'assignments.csv']);
  const outputFolder = new Map<string, string>();
  const folderByCategoryName = new Map<string, string>();
  for (const category of [...categories].sort((a, b) =>
    a.name.split('/').length - b.name.split('/').length || compareNames(a.name, b.name))) {
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
    while (usedFiles.has(`${folder}/${filename}`.toLocaleLowerCase()) || usedFolders.has(`${folder}/${filename}`.toLocaleLowerCase())) filename = `${stem} (${suffix++})${extension}`;
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
    zip.file(exportedPath, blob, { compression: imageCompression(image) });
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

export async function importProjectFiles(
  readText: () => Promise<string>,
  readAsset: (path: string) => Promise<Blob | undefined>,
): Promise<LibraryProject> {
  const backup = parseBackup(await readText());
  const db = await database;
  const now = Date.now();
  const project: LibraryProject = { id: nanoid(), name: backup.name, createdAt: now, updatedAt: now, settings: backup.settings, stashSequence: backup.images.reduce((max, image) => Math.max(max, image.stashOrder || 0), 0) };
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
      await commitTransaction(tx, async () => {
        await tx.objectStore('assets').put(blob, id);
        await tx.objectStore('images').put(normalizeFolderImage({ id, projectId: project.id, path: image.path, mime: image.mime, size: image.size, addedAt: image.addedAt,
          categoryId: image.categoryId ? categoryIds.get(image.categoryId)! : null,
          placement: image.placement, boardX: image.boardX, boardY: image.boardY, ...(image.stashOrder !== undefined ? { stashOrder: image.stashOrder } : {}),
          ...(image.boardScope !== undefined ? { boardScope: image.boardScope ? categoryIds.get(image.boardScope)! : null } : {}),
          visual: image.visual, clip: image.clip, clipSkipped: image.clipSkipped, fileModifiedAt: image.fileModifiedAt }), id);
      });
      written.push(id);
    }
    const tx = db.transaction(['projects', 'meta'], 'readwrite');
    await commitTransaction(tx, async () => {
      await tx.objectStore('projects').put(project, project.id);
      await tx.objectStore('meta').put(project.id, 'activeProjectId');
    });
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
