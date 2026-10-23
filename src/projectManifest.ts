import type { LibraryCategory, LibraryImage, ProjectSettingsData } from './imageStore';
import { cleanRelativePath, cleanCategoryName } from './imageStore';
import { isVisualAnalysis } from './imageAnalysis';
import { isContentAnalysis } from './contentSimilarity';

export type BackupV2 = {
  format: 'folder-sort-project';
  version: 2;
  name: string;
  settings: ProjectSettingsData;
  categories: Array<Omit<LibraryCategory, 'projectId'>>;
  images: Array<Omit<LibraryImage, 'projectId'> & { file: string }>;
};

type ParsedBackup = Pick<BackupV2, 'name' | 'settings' | 'categories' | 'images'>;

export function parseBackup(raw: string): ParsedBackup {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid project manifest');
  const backup = value as { format?: unknown; version?: unknown; name?: unknown; images?: unknown; categories?: unknown; settings?: unknown };
  if ((backup.format !== 'folder-sort-project' && backup.format !== 'sortboard-image-library') ||
      (backup.version !== 1 && backup.version !== 2) ||
      typeof backup.name !== 'string' || !backup.name.trim() || !Array.isArray(backup.images)) {
    throw new Error('Unsupported project export');
  }
  const settings = backup.settings;
  if (settings !== undefined && (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
      'clipEnabled' in settings && typeof settings.clipEnabled !== 'boolean')) throw new Error('Invalid project settings');
  const clipEnabled = settings === undefined || !('clipEnabled' in settings) || settings.clipEnabled !== false;
  const categories = backup.version === 2 ? backup.categories : [];
  if (!Array.isArray(categories)) throw new Error('Invalid category list');
  const images = backup.images as BackupV2['images'];
  const categoryIds = new Set<string>();
  const categoryNames = new Set<string>();
  for (const category of categories) {
    if (!category || typeof category.id !== 'string' || !/^[\w-]+$/.test(category.id) ||
        categoryIds.has(category.id) || typeof category.name !== 'string' ||
        typeof category.createdAt !== 'number' || !Number.isFinite(category.createdAt) || category.createdAt < 0) throw new Error('Invalid category record');
    const cleanName = cleanCategoryName(category.name);
    if (category.layoutInitialized !== undefined && typeof category.layoutInitialized !== 'boolean') throw new Error('Invalid stash layout');
    if (cleanName !== category.name || categoryNames.has(cleanName.toLocaleLowerCase())) throw new Error('Invalid category name');
    categoryIds.add(category.id);
    categoryNames.add(cleanName.toLocaleLowerCase());
  }
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const image of images) {
    if (!image || typeof image.id !== 'string' || !/^[\w-]+$/.test(image.id) || ids.has(image.id) ||
        typeof image.path !== 'string' || typeof image.file !== 'string' ||
        typeof image.mime !== 'string' || !image.mime.startsWith('image/') ||
        !Number.isSafeInteger(image.size) || image.size < 0 ||
        typeof image.addedAt !== 'number' || !Number.isFinite(image.addedAt) || image.addedAt < 0) throw new Error('Invalid image record');
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
    if (image.rootOnBoard !== undefined && typeof image.rootOnBoard !== 'boolean') throw new Error('Invalid Root board state');
    if (image.stashOrder !== undefined && (!Number.isSafeInteger(image.stashOrder) || image.stashOrder < 0)) throw new Error('Invalid stash order');
    if (image.boardScope !== undefined && image.boardScope !== null && (typeof image.boardScope !== 'string' || !categoryIds.has(image.boardScope))) throw new Error('Invalid image board scope');
    if (image.visual !== undefined && !isVisualAnalysis(image.visual)) throw new Error('Invalid image analysis');
    if (image.clip !== undefined && !isContentAnalysis(image.clip)) throw new Error('Invalid content analysis');
    if (image.clipSkipped !== undefined && (typeof image.clipSkipped !== 'string' || image.clipSkipped.length > 200 || !/^[\w/@:.-]+$/.test(image.clipSkipped))) throw new Error('Invalid content analysis');
    if (image.fileModifiedAt != null &&
        (typeof image.fileModifiedAt !== 'number' || !Number.isFinite(image.fileModifiedAt) || Math.abs(image.fileModifiedAt) > 8.64e15)) {
      throw new Error('Invalid image file date');
    }
    if (cleanRelativePath(image.path) !== image.path || paths.has(image.path)) throw new Error('Invalid or duplicate image path');
    paths.add(image.path);
    if (cleanRelativePath(image.file) !== `images/${image.id}/${image.path.split('/').at(-1)}`) {
      throw new Error('Invalid image asset path');
    }
    ids.add(image.id);
  }
  return {
    name: backup.name,
    settings: { clipEnabled },
    categories: (categories as BackupV2['categories']).map(({ id, name, createdAt, layoutInitialized }) => ({ id, name, createdAt, ...(layoutInitialized === undefined ? {} : { layoutInitialized }) })),
    images: images.map((image) => ({ ...image, categoryId: backup.version === 2 ? image.categoryId || null : null })),
  };
}
