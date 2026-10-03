import type { LibraryCategory, LibraryImage } from './libraryStore';

export type CategoryBoardMode = 'free' | 'stacks' | 'linked';
export type BoardPoint = { x: number; y: number };
export type CategoryBoardPreferences = { mode: CategoryBoardMode; anchors: Record<string, BoardPoint>; expanded: string[]; autoNext: boolean };
export type CategoryBoardGroup = BoardPoint & { id: string; name: string; ids: string[]; width: number; height: number; expanded: boolean };
export const BOARD_IMAGE_SIZE = 172;

export function readBoardPreferences(projectId: string): CategoryBoardPreferences {
  const fallback: CategoryBoardPreferences = { mode: 'free', anchors: {}, expanded: [], autoNext: false };
  try {
    const saved = JSON.parse(localStorage.getItem(`folder-sort-board:${projectId}`) || 'null');
    if (!saved || typeof saved !== 'object') return fallback;
    const anchors: Record<string, BoardPoint> = {};
    for (const [id, point] of Object.entries(saved.anchors || {}).slice(0, 10000)) {
      const p = point as BoardPoint;
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0) anchors[id] = { x: Math.min(100000, p.x), y: Math.min(1000000, p.y) };
    }
    return { mode: ['free', 'stacks', 'linked'].includes(saved.mode) ? saved.mode : 'free', anchors,
      expanded: Array.isArray(saved.expanded) ? saved.expanded.filter((id: unknown) => typeof id === 'string').slice(0, 10000) : [], autoNext: saved.autoNext === true };
  } catch { return fallback; }
}

/** A category's direct members form one group. Nested categories keep their own
 * group, just as they keep their own destination folder. No images are copied. */
export function categoryBoardLayout(images: LibraryImage[], categories: LibraryCategory[], mode: CategoryBoardMode,
  width: number, anchors: Record<string, BoardPoint>, expanded: Set<string>, preferredId?: string | null) {
  const positions = new Map<string, BoardPoint>();
  const visibleIds = new Set<string>();
  if (mode === 'free') return { groups: [] as CategoryBoardGroup[], positions, visibleIds, height: 0, workWidth: 0 };
  const members = new Map<string, LibraryImage[]>();
  const known = new Set(categories.map(category => category.id));
  const unsorted = images.filter(image => !image.categoryId || !known.has(image.categoryId));
  for (const image of images) {
    if (!image.categoryId || !known.has(image.categoryId)) continue;
    const group = members.get(image.categoryId) || [];
    group.push(image); members.set(image.categoryId, group);
  }
  const mobile = width < 660 && unsorted.length <= 8;
  const workColumns = Math.max(Math.ceil(unsorted.length / 400), mobile ? Math.max(1, Math.floor((width - 48) / 192)) : 2);
  const workWidth = unsorted.length ? workColumns * 192 : 0;
  unsorted.forEach((image, index) => {
    positions.set(image.id, { x: 32 + index % workColumns * 192, y: 160 + Math.floor(index / workColumns) * 192 });
    visibleIds.add(image.id);
  });
  const startX = mobile || !workWidth ? 32 : workWidth + 64;
  const startY = mobile && unsorted.length ? 160 + Math.ceil(unsorted.length / workColumns) * 192 + 64 : 136;
  let cursorX = startX, cursorY = startY, rowHeight = 0, bandX = startX;
  const groups: CategoryBoardGroup[] = [];
  for (const category of categories) {
    const groupImages = members.get(category.id) || [];
    const open = expanded.has(category.id);
    const columns = Math.max(1, Math.ceil(groupImages.length / 400), Math.min(3, Math.floor((Math.max(230, width - startX - 32) - 32) / 192)));
    const groupWidth = mode === 'stacks' && open ? columns * 192 + 24 : 236;
    const groupHeight = mode === 'stacks' && open ? 66 + Math.max(1, Math.ceil(groupImages.length / columns)) * 192 : 280;
    const bandWidth = Math.max(groupWidth, width - startX - 32);
    if (cursorX > bandX && cursorX + groupWidth > bandX + bandWidth) { cursorX = bandX; cursorY += rowHeight + 28; rowHeight = 0; }
    if (cursorY + groupHeight > 95000) { bandX += bandWidth + 64; cursorX = bandX; cursorY = startY; rowHeight = 0; }
    const defaultPoint = { x: cursorX, y: cursorY };
    let point = anchors[category.id] || defaultPoint;
    let linkedWidth = groupWidth, linkedHeight = groupHeight;
    if (mode === 'linked' && groupImages.length) {
      const xs = groupImages.map(image => image.boardX ?? 32), ys = groupImages.map(image => image.boardY ?? 160);
      point = { x: Math.max(8, Math.min(...xs) - 12), y: Math.max(8, Math.min(...ys) - 56) };
      linkedWidth = Math.max(236, Math.max(...xs) + BOARD_IMAGE_SIZE + 12 - point.x);
      linkedHeight = Math.max(140, Math.max(...ys) + BOARD_IMAGE_SIZE + 16 - point.y);
    }
    groups.push({ id: category.id, name: category.name, ids: groupImages.map(image => image.id), ...point,
      width: linkedWidth, height: linkedHeight, expanded: open });
    if (mode === 'stacks') {
      groupImages.forEach((image, index) => positions.set(image.id, open
        ? { x: point.x + 18 + index % columns * 192, y: point.y + 58 + Math.floor(index / columns) * 192 }
        : { x: point.x + 22 + Math.min(index, 2) * 10, y: point.y + 65 + Math.min(index, 2) * 6 }));
      const previews = preferredId && groupImages.some(image => image.id === preferredId)
        ? [...groupImages.filter(image => image.id !== preferredId).slice(0, 2), groupImages.find(image => image.id === preferredId)!]
        : groupImages.slice(0, 3);
      (open ? groupImages : previews).forEach(image => visibleIds.add(image.id));
      // Keep the active image at the front without expanding a huge stack.
      if (!open) previews.forEach((image, index) => positions.set(image.id, { x: point.x + 22 + index * 10, y: point.y + 65 + index * 6 }));
    }
    cursorX += groupWidth + 28; rowHeight = Math.max(rowHeight, groupHeight);
  }
  const height = Math.max(900, startY + 320, ...groups.map(group => group.y + group.height + 96), ...[...positions.values()].map(point => point.y + 240));
  return { groups, positions, visibleIds, height, workWidth };
}

/** Translate a linked category as one object and clamp the whole group, rather
 * than clamping members individually and changing their relative positions. */
export function translateCategory(images: LibraryImage[], ids: string[], delta: BoardPoint) {
  const members = new Set(ids);
  const selected = images.filter(image => members.has(image.id));
  if (!selected.length) return [];
  const xs = selected.map(image => image.boardX ?? 0), ys = selected.map(image => image.boardY ?? 0);
  const dx = Math.min(100000 - Math.max(...xs), Math.max(delta.x, -Math.min(...xs)));
  const dy = Math.min(100000 - Math.max(...ys), Math.max(delta.y, -Math.min(...ys)));
  return selected.map(image => ({ id: image.id, x: Math.round((image.boardX ?? 0) + dx), y: Math.round((image.boardY ?? 0) + dy) }));
}
