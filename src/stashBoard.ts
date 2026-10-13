import { imageIsOnBoard, type LibraryCategory, type LibraryImage } from './libraryStore';
import { categoryCounts } from './categoryTree';
import type { BoardPoint, CategoryBoardGroup } from './categoryBoard';

export const STASH_HOLD_MS = 600;
export const STASH_HOLD_SLOP = 12;
export const boardScope = (image: LibraryImage) => image.boardScope === undefined ? image.categoryId : image.boardScope;
export const imageOnScopeBoard = (image: LibraryImage, scope: string | null) => imageIsOnBoard(image) && boardScope(image) === scope;
export const parentPath = (name: string) => name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
export type StashTile = CategoryBoardGroup & { directCount: number; totalCount: number; childCount: number; previewIds: string[] };

/** Only immediate children become tiles. Count descendants once; render three previews. */
export function stashBoardLayout(images: LibraryImage[], categories: LibraryCategory[], scope: string | null,
  width: number, anchors: Record<string, BoardPoint>, occupied: BoardPoint[] = []): StashTile[] {
  const current = categories.find(stash => stash.id === scope)?.name || '';
  const byId = new Map(categories.map(stash => [stash.id, stash]));
  const totals = categoryCounts(images, categories);
  const direct = new Map<string, number>();
  const previews = new Map<string, string[]>();
  const children = categories.filter(stash => parentPath(stash.name).toLocaleLowerCase() === current.toLocaleLowerCase());
  const childByName = new Map(children.map(stash => [stash.name.toLocaleLowerCase(), stash]));
  const childCounts = new Map<string, number>();
  for (const stash of categories) {
    const parent = parentPath(stash.name).toLocaleLowerCase();
    childCounts.set(parent, (childCounts.get(parent) || 0) + 1);
  }
  for (const image of images) {
    if (!image.categoryId) continue;
    direct.set(image.categoryId, (direct.get(image.categoryId) || 0) + 1);
    const name = byId.get(image.categoryId)?.name.toLocaleLowerCase();
    if (!name) continue;
    const relative = current ? name.slice(current.length + 1) : name;
    const child = childByName.get((current ? `${current.toLocaleLowerCase()}/` : '') + relative.split('/')[0]);
    if (!child || (current && !name.startsWith(`${current.toLocaleLowerCase()}/`))) continue;
    const ids = previews.get(child.id) || [];
    if (ids.length < 3) { ids.push(image.id); previews.set(child.id, ids); }
  }
  const columns = Math.max(1, Math.floor((width - 64) / 264));
  const used = [...occupied];
  return children.map((stash, index) => {
    let point = anchors[stash.id] || { x: 32 + index % columns * 264, y: 150 + Math.floor(index / columns) * 280 };
    if (!anchors[stash.id]) {
      while (used.some(other => Math.abs(other.x - point.x) < 236 && Math.abs(other.y - point.y) < 240)) point = { ...point, y: point.y + 280 };
    }
    used.push(point);
    return { id: stash.id, name: stash.name, ...point, width: 236, height: 248, expanded: false,
      ids: [], directCount: direct.get(stash.id) || 0, totalCount: totals.get(stash.id) || 0,
      childCount: childCounts.get(stash.name.toLocaleLowerCase()) || 0,
      previewIds: previews.get(stash.id) || [] };
  });
}

/** Deliberate central overlap, using the fitted image rather than its square frame. */
export function inGroupingTarget(point: BoardPoint, bounds: { left: number; top: number; width: number; height: number }) {
  return Math.abs(point.x - bounds.left - bounds.width / 2) <= bounds.width * .32 &&
    Math.abs(point.y - bounds.top - bounds.height / 2) <= bounds.height * .32;
}
