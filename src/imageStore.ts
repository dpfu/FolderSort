import { stashTileGeometry } from './stashGeometry';
import type { BoardPoint } from './categoryBoard';
import { database, commitTransaction } from './libraryDatabase';
import { nanoid } from 'nanoid';
import { compareNames } from './sortNames';
import type { ImageMetadata } from './imageAnalysis';
import { compareStashImages, stashGrid } from './stashLayout';

export type ProjectSettingsData = { clipEnabled: boolean };

export function projectClipEnabled(project: Pick<LibraryProject, "settings"> | undefined): boolean {
  return project?.settings?.clipEnabled !== false;
}

export type LibraryProject = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings?: ProjectSettingsData;
  stashSequence?: number;
};

export type LibraryImage = ImageMetadata & {
  id: string;
  projectId: string;
  path: string;
  mime: string;
  size: number;
  addedAt: number;
  categoryId: string | null;
  stashOrder?: number;
  // Missing means board for projects created before the three-area workspace.
  placement?: 'board' | 'tray';
  /** Working board location is independent of the one folder assignment. */
  boardScope?: string | null;
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
  layoutInitialized?: boolean;
};

export type IncomingImage = { file: File; path: string };

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

// Record this small preference synchronously before starting its IndexedDB write.
// A reload can interrupt a transaction; replay the unfinished change on startup.
const clipJournalPrefix = 'folder-sort:pending-clip:';
function clearClipJournal(id: string, enabled: boolean) {
  try {
    const key = clipJournalPrefix + id;
    if (localStorage.getItem(key) === String(enabled)) localStorage.removeItem(key);
  } catch { /* IndexedDB remains the saved source when localStorage is unavailable. */ }
}

export async function listProjects(): Promise<LibraryProject[]> {
  const pending: Array<[string, boolean]> = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(clipJournalPrefix)) continue;
      const value = localStorage.getItem(key);
      if (value === 'true' || value === 'false') pending.push([key.slice(clipJournalPrefix.length), value === 'true']);
    }
  } catch { /* Private/storage-restricted contexts can still use IndexedDB. */ }
  const db = await database;
  if (pending.length) {
    const tx = db.transaction('projects', 'readwrite');
    for (const [id, clipEnabled] of pending) {
      const project = await tx.store.get(id);
      if (project) await tx.store.put({ ...project, settings: { ...project.settings, clipEnabled }, updatedAt: Date.now() }, id);
    }
    await tx.done;
    for (const [id, enabled] of pending) clearClipJournal(id, enabled);
  }
  return (await db.getAll('projects')).sort((a, b) => b.updatedAt - a.updatedAt);
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
  const project: LibraryProject = { id: nanoid(), name: trimmed, createdAt: now, updatedAt: now, settings: { clipEnabled: true } };
  const tx = (await database).transaction(['projects', 'meta'], 'readwrite');
  await commitTransaction(tx, async () => {
    await tx.objectStore('projects').put(project, project.id);
    await tx.objectStore('meta').put(project.id, 'activeProjectId');
  });
  return project;
}

export async function renameProject(id: string, name: string): Promise<LibraryProject> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a project name');
  const db = await database;
  const tx = db.transaction('projects', 'readwrite');
  const project = await tx.store.get(id);
  if (!project) { await tx.done; throw new Error('Project not found'); }
  const updated = { ...project, name: trimmed, updatedAt: Date.now() };
  await tx.store.put(updated, id);
  await tx.done;
  return updated;
}

/** Settings live with the project, so switching projects and restoring backups keeps them. */
export async function setProjectClipEnabled(id: string, clipEnabled: boolean): Promise<LibraryProject> {
  try { localStorage.setItem(clipJournalPrefix + id, String(clipEnabled)); } catch { /* Fall back to IndexedDB. */ }
  try {
    const db = await database;
    const tx = db.transaction('projects', 'readwrite');
    const project = await tx.store.get(id);
    if (!project) { await tx.done; throw new Error('Project not found'); }
    const updated: LibraryProject = { ...project, settings: { ...project.settings, clipEnabled }, updatedAt: Date.now() };
    await tx.store.put(updated, id); await tx.done;
    return updated;
  } finally { clearClipJournal(id, clipEnabled); }
}

export async function listImages(projectId: string): Promise<LibraryImage[]> {
  return (await (await database).getAllFromIndex('images', 'byProject', projectId))
    .map((image) => ({ ...image, categoryId: image.categoryId || null }))
    .sort((a, b) => compareNames(a.path, b.path));
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
  return categories.sort((a, b) => compareNames(a.name, b.name));
}

/** Prepare contents once. Legacy manual positions are preserved; new stashes get a grid. */
export async function prepareStashBoard(projectId: string, stashId: string, width: number, anchors: Record<string, BoardPoint> = {}): Promise<boolean> {
  const tx = (await database).transaction(['images', 'categories'], 'readwrite');
  const stash = await tx.objectStore('categories').get(stashId);
  if (!stash || stash.projectId !== projectId) { await tx.done; throw new Error('Stash not found in this project'); }
  if (stash.layoutInitialized) { await tx.done; return false; }
  const images = await tx.objectStore('images').index('byProject').getAll(projectId);
  const members = images.filter(image => image.categoryId === stashId).sort(compareStashImages);
  const keep = stash.layoutInitialized === undefined ? members.filter(image => imageIsOnBoard(image) && image.boardX !== undefined && image.boardY !== undefined) : [];
  const kept = new Set(keep.map(image => image.id));
  const borrowed = images.filter(image => image.categoryId !== stashId && image.boardScope === stashId && imageIsOnBoard(image) && image.boardX !== undefined && image.boardY !== undefined);
  const occupied = [...keep, ...borrowed].map(image => ({ x: image.boardX!, y: image.boardY! }));
  const tiles = stashTileGeometry(await tx.objectStore('categories').index('byProject').getAll(projectId), stashId, width, anchors, occupied);
  const moves = stashGrid(members.filter(image => !kept.has(image.id)).map(image => image.id), width, [...occupied, ...tiles]);
  const positions = new Map(moves.map(move => [move.id, move]));
  await Promise.all(members.map(image => tx.objectStore('images').put({ ...image, placement: 'board', boardScope: stashId, ...(positions.get(image.id) ? { boardX: positions.get(image.id)!.x, boardY: positions.get(image.id)!.y } : {}) }, image.id)));
  await tx.objectStore('categories').put({ ...stash, layoutInitialized: true }, stashId);
  await tx.done; return true;
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
      const category = { id: nanoid(), projectId, name: candidate, createdAt: Date.now(), layoutInitialized: false };
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
  const image = await (await database).get('images', imageId);
  if (!image) throw new Error('Image not found');
  await assignImageCategories(image.projectId, [{ id: imageId, categoryId, boardPosition }]);
}

export type CategoryAssignment = { id: string; categoryId: string | null; boardPosition?: { x: number; y: number }; boardScope?: string | null; placement?: 'board' | 'tray' };

/** Undo only the fields changed by an action, keeping newer analysis metadata. */
export type ImageRestoreState = {
  id: string;
  categoryId?: string | null;
  boardScope?: string | null;
  stashOrder?: number;
  board?: Pick<LibraryImage, 'placement' | 'boardX' | 'boardY' | 'boardScope'>;
};

/** Create a folder and move its images together: failure leaves no empty folder behind. */
export async function createStashWithImages(projectId: string, ids: string[], parentId: string | null, label = 'New stash', placeOnBoard = false) {
  const clean = cleanCategoryName(label);
  if (clean.includes('/')) throw new Error('Use a single stash name. Open a stash to create a sub-stash.');
  const db = await database;
  const tx = db.transaction(['categories', 'images', 'projects'], 'readwrite');
  try {
    const uniqueIds = [...new Set(ids)];
    const [project, categories, records] = await Promise.all([
      tx.objectStore('projects').get(projectId), tx.objectStore('categories').index('byProject').getAll(projectId),
      uniqueIds.length > 64 ? tx.objectStore('images').index('byProject').getAll(projectId).then(images => {
        const byId = new Map(images.map(image => [image.id, image])); return uniqueIds.map(id => byId.get(id));
      }) : Promise.all(uniqueIds.map(id => tx.objectStore('images').get(id))),
    ]);
    if (!project) throw new Error('Project not found');
    const parent = parentId ? categories.find(stash => stash.id === parentId) : undefined;
    if (parentId && !parent) throw new Error('Stash not found in this project');
    if (records.some(image => !image || image.projectId !== projectId)) throw new Error('Image not found in this project');
    const prefix = parent ? `${parent.name}/` : '';
    const names = new Set(categories.map(stash => stash.name.toLocaleLowerCase()));
    let name = prefix + clean, suffix = 2;
    while (names.has(name.toLocaleLowerCase())) name = `${prefix}${clean} ${suffix++}`;
    const category: LibraryCategory = { id: nanoid(), projectId, name, createdAt: Date.now(), layoutInitialized: false };
    const states: ImageRestoreState[] = records.map(image => ({ id: image!.id, categoryId: image!.categoryId, stashOrder: image!.stashOrder,
      board: { placement: image!.placement, boardX: image!.boardX, boardY: image!.boardY, boardScope: image!.boardScope } }));
    await tx.objectStore('categories').put(category, category.id);
    let stashSequence = project.stashSequence || 0;
    await Promise.all(records.map(image => tx.objectStore('images').put({ ...image!, categoryId: category.id, boardScope: category.id, stashOrder: ++stashSequence, ...(placeOnBoard ? { placement: 'board' as const } : {}) }, image!.id)));
    await tx.objectStore('projects').put({ ...project, stashSequence, updatedAt: Date.now() }, projectId);
    await tx.done;
    return { category, states };
  } catch (cause) { try { tx.abort(); } catch { /* Already aborted. */ } await tx.done.catch(() => {}); throw cause; }
}

export async function undoStashCreation(projectId: string, stashId: string, states: ImageRestoreState[]) {
  const db = await database;
  const tx = db.transaction(['categories', 'images', 'projects'], 'readwrite');
  try {
    const [stash, categories, images, project] = await Promise.all([
      tx.objectStore('categories').get(stashId), tx.objectStore('categories').index('byProject').getAll(projectId),
      tx.objectStore('images').index('byProject').getAll(projectId), tx.objectStore('projects').get(projectId),
    ]);
    if (!project || !stash || stash.projectId !== projectId) throw new Error('Stash not found in this project');
    const restoring = new Map(states.map(state => [state.id, state]));
    const imageIds = new Set(images.map(image => image.id));
    const categoryIds = new Set(categories.map(category => category.id));
    if (categories.some(child => child.name.toLocaleLowerCase().startsWith(`${stash.name.toLocaleLowerCase()}/`)) ||
      images.some(image => (image.categoryId === stashId || image.boardScope === stashId) && !restoring.has(image.id))) throw new Error('This stash has new contents. Move them out before undoing its creation.');
    if (states.some(state => !imageIds.has(state.id) || state.categoryId && !categoryIds.has(state.categoryId) || state.board?.boardScope && !categoryIds.has(state.board.boardScope))) throw new Error('Could not restore the previous stash.');
    await Promise.all(images.filter(image => restoring.has(image.id)).map(image => {
      const state = restoring.get(image.id)!;
      const restored = { ...image, categoryId: state.categoryId ?? null };
      delete restored.placement; delete restored.boardX; delete restored.boardY; delete restored.boardScope; delete restored.stashOrder;
      if (state.stashOrder !== undefined) restored.stashOrder = state.stashOrder;
      return tx.objectStore('images').put({ ...restored, ...state.board }, image.id);
    }));
    await tx.objectStore('categories').delete(stashId);
    await tx.objectStore('projects').put({ ...project, updatedAt: Date.now() }, projectId);
    await tx.done;
  } catch (cause) { try { tx.abort(); } catch { /* Already aborted. */ } await tx.done.catch(() => {}); throw cause; }
}

export async function restoreImageStates(projectId: string, states: ImageRestoreState[]): Promise<void> {
  if (!states.length) return;
  if (states.some(state => state.board && [state.board.boardX, state.board.boardY].some(value => value !== undefined && (!Number.isFinite(value) || value < 0 || value > 100_000)))) throw new Error('Invalid board position');
  const db = await database;
  const tx = db.transaction(['images', 'projects', 'categories'], 'readwrite');
  try {
    const records = states.length > 64
      ? tx.objectStore('images').index('byProject').getAll(projectId).then(images => {
        const byId = new Map(images.map(image => [image.id, image])); return states.map(state => byId.get(state.id));
      }) : Promise.all(states.map(state => tx.objectStore('images').get(state.id)));
    const [project, images, categories] = await Promise.all([
      tx.objectStore('projects').get(projectId), records,
      Promise.all([...new Set(states.flatMap(state => [state.categoryId, state.boardScope, state.board?.boardScope].filter((id): id is string => !!id)))].map(id => tx.objectStore('categories').get(id))),
    ]);
    if (!project) throw new Error('Project not found');
    if (categories.some(category => !category || category.projectId !== projectId)) throw new Error('Category not found in this project');
    const updates = states.map((state, index) => {
      const image = images[index];
      if (!image || image.projectId !== projectId) throw new Error('Image not found in this project');
      const next = { ...image };
      if ('categoryId' in state) next.categoryId = state.categoryId ?? null;
      if ('boardScope' in state) next.boardScope = state.boardScope;
      if ('stashOrder' in state) { delete next.stashOrder; if (state.stashOrder !== undefined) next.stashOrder = state.stashOrder; }
      if (state.board) {
        delete next.placement; delete next.boardX; delete next.boardY; delete next.boardScope;
        if (state.board.placement !== undefined) next.placement = state.board.placement;
        if (state.board.boardX !== undefined) next.boardX = state.board.boardX;
        if (state.board.boardY !== undefined) next.boardY = state.board.boardY;
        if (state.board.boardScope !== undefined) next.boardScope = state.board.boardScope;
      }
      return next;
    });
    await Promise.all(updates.map(image => tx.objectStore('images').put(image, image.id)));
    await tx.objectStore('projects').put({ ...project, updatedAt: Date.now() }, projectId);
    await tx.done;
  } catch (cause) {
    try { tx.abort(); } catch { /* It may already have aborted. */ }
    await tx.done.catch(() => {}); throw cause;
  }
}

/** Assign a selection in one transaction, merging the latest records (including analysis). */
export async function assignImageCategories(projectId: string, assignments: CategoryAssignment[]): Promise<LibraryImage[]> {
  if (!assignments.length) return [];
  if (assignments.some(({ boardPosition }) => boardPosition && ![boardPosition.x, boardPosition.y].every(value => Number.isFinite(value) && value >= 0 && value <= 100_000))) {
    throw new Error('Invalid board position');
  }
  const db = await database;
  const tx = db.transaction(['images', 'projects', 'categories'], 'readwrite');
  try {
    const project = await tx.objectStore('projects').get(projectId);
    if (!project) throw new Error('Project not found');
    const categoryIds = new Set(assignments.flatMap(item => [item.categoryId, item.boardScope].filter((id): id is string => !!id)));
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
    let stashSequence = project.stashSequence || 0;
    for (const [index, assignment] of assignments.entries()) {
      const image = records[index];
      if (!image || image.projectId !== projectId) throw new Error('Image not found in this project');
      updates.push({ ...image, categoryId: assignment.categoryId, stashOrder: assignment.categoryId ? ++stashSequence : undefined, ...(assignment.placement ? { placement: assignment.placement } : {}), boardScope: assignment.boardScope === undefined ? assignment.categoryId : assignment.boardScope, ...(assignment.boardPosition ? {
        placement: 'board', boardX: Math.round(assignment.boardPosition.x), boardY: Math.round(assignment.boardPosition.y),
      } : {}) });
    }
    await Promise.all(updates.map(image => tx.objectStore('images').put(image, image.id)));
    await tx.objectStore('projects').put({ ...project, stashSequence, updatedAt: Date.now() }, projectId);
    await tx.done;
    return updates;
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

export async function placeImagesOnBoard(projectId: string, moves: Array<{ id: string; x: number; y: number; boardScope?: string | null }>): Promise<void> {
  if (!moves.length) return;
  if (moves.some(({ x, y }) => ![x, y].every((value) => Number.isFinite(value) && value >= 0 && value <= 100_000))) {
    throw new Error('Invalid board position');
  }
  const db = await database;
  const tx = db.transaction(['images', 'projects', 'categories'], 'readwrite');
  try {
    const [records, project] = await Promise.all([
      moves.length > 64 ? tx.objectStore('images').index('byProject').getAll(projectId).then(images => {
        const byId = new Map(images.map(image => [image.id, image])); return moves.map(move => byId.get(move.id));
      }) : Promise.all(moves.map(move => tx.objectStore('images').get(move.id))),
      tx.objectStore('projects').get(projectId),
    ]);
    if (!project) throw new Error('Project not found');
    const scopes = await Promise.all([...new Set(moves.flatMap(move => move.boardScope ? [move.boardScope] : []))].map(id => tx.objectStore('categories').get(id)));
    if (scopes.some(stash => !stash || stash.projectId !== projectId)) throw new Error('Stash not found in this project');
    const updates = moves.map((move, index) => {
      const image = records[index];
      if (!image || image.projectId !== projectId) throw new Error('Image not found in this project');
      return { ...image, placement: 'board' as const, boardX: Math.round(move.x), boardY: Math.round(move.y), ...(move.boardScope !== undefined ? { boardScope: move.boardScope } : {}) };
    });
    await Promise.all(updates.map(image => tx.objectStore('images').put(image, image.id)));
    await tx.objectStore('projects').put({ ...project, updatedAt: Date.now() }, projectId);
    await tx.done;
  } catch (cause) {
    try { tx.abort(); } catch { /* The transaction may already be aborted. */ }
    await tx.done.catch(() => {}); throw cause;
  }
}

export async function returnImagesToTray(projectId: string, imageIds: string[]): Promise<void> {
  await restoreImageStates(projectId, imageIds.map(id => ({ id, board: { placement: 'tray' } })));
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

/** Rebuild only content features; originals, placement and assignments stay intact. */
export async function clearContentAnalysis(projectId: string): Promise<void> {
  const tx = (await database).transaction('images', 'readwrite');
  let cursor = await tx.store.index('byProject').openCursor(projectId);
  while (cursor) {
    const { clip: _clip, clipSkipped: _skipped, ...image } = cursor.value;
    await cursor.update(image);
    cursor = await cursor.continue();
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
    try {
      const current = await tx.objectStore('projects').get(projectId);
      if (!current) throw new Error('Project not found');
      const stashSequence = (current.stashSequence || 0) + Number(!!image.categoryId);
      if (image.categoryId) image.stashOrder = stashSequence;
      await tx.objectStore('assets').put(item.file, id);
      await tx.objectStore('images').put(image, id);
      await tx.objectStore('projects').put({ ...current, stashSequence, updatedAt: now }, projectId);
      await tx.done;
    } catch (cause) {
      try { tx.abort(); } catch { /* Already aborted. */ }
      await tx.done.catch(() => {}); throw cause;
    }
    known.add(path);
    added++;
    onProgress?.(added + skipped, incoming.length);
  }
  return { added, skipped };
}

export async function removeImage(id: string): Promise<void> {
  await removeImageWithUndo(id);
}

export type RemovedImage = { image: LibraryImage; original?: Blob; thumbnail?: Blob };

export async function removeImageWithUndo(id: string): Promise<RemovedImage | undefined> {
  const db = await database;
  const read = db.transaction(['images', 'assets']);
  const found = await read.objectStore('images').get(id);
  if (!found) { await read.done; return; }
  const [original, thumbnail] = await Promise.all([
    read.objectStore('assets').get(id), read.objectStore('assets').get(thumbnailKey(id)),
  ]);
  await read.done;
  // WebKit can invalidate database-backed Blob data after its record is deleted.
  // Materialize one independent recovery copy before deleting, outside any live
  // IDB transaction. Keep File names/dates when the original is a File.
  const copy = async (blob: Blob | undefined) => {
    if (!blob) return;
    const bytes = await blob.arrayBuffer();
    return blob instanceof File ? new File([bytes], blob.name, { type: blob.type, lastModified: blob.lastModified }) : new Blob([bytes], { type: blob.type });
  };
  const [savedOriginal, savedThumbnail] = await Promise.all([copy(original), copy(thumbnail)]);
  const tx = db.transaction(['images', 'assets', 'projects'], 'readwrite');
  const image = await tx.objectStore('images').get(id);
  if (!image) { await tx.done; return; }
  await tx.objectStore('images').delete(id);
  await tx.objectStore('assets').delete(id);
  await tx.objectStore('assets').delete(thumbnailKey(id));
  const project = await tx.objectStore('projects').get(image.projectId);
  if (project) await tx.objectStore('projects').put({ ...project, updatedAt: Date.now() }, project.id);
  await tx.done;
  return { image, original: savedOriginal, thumbnail: savedThumbnail };
}

export async function restoreRemovedImage(snapshot: RemovedImage): Promise<void> {
  const db = await database;
  const tx = db.transaction(['images', 'assets', 'projects', 'categories'], 'readwrite');
  try {
    const image = snapshot.image;
    const [project, present, category] = await Promise.all([
      tx.objectStore('projects').get(image.projectId), tx.objectStore('images').get(image.id),
      image.categoryId ? tx.objectStore('categories').get(image.categoryId) : undefined,
    ]);
    if (!project) throw new Error('Project not found');
    if (present) throw new Error('This image is already in the project');
    if (image.categoryId && (!category || category.projectId !== image.projectId)) throw new Error('Category not found in this project');
    await tx.objectStore('images').put(image, image.id);
    if (snapshot.original) await tx.objectStore('assets').put(snapshot.original, image.id);
    if (snapshot.thumbnail) await tx.objectStore('assets').put(snapshot.thumbnail, thumbnailKey(image.id));
    await tx.objectStore('projects').put({ ...project, updatedAt: Date.now() }, project.id);
    await tx.done;
  } catch (cause) {
    try { tx.abort(); } catch { /* It may already have aborted. */ }
    await tx.done.catch(() => {}); throw cause;
  }
}
