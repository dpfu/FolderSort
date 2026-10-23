import { parentPath, stashTileGeometry } from './stashGeometry';
import { type LibraryCategory, type LibraryImage } from './libraryStore';
import { compareStashImages } from './stashLayout';
import { categoryCounts } from './categoryTree';
import type { BoardPoint, CategoryBoardGroup } from './categoryBoard';

export const STASH_HOLD_MS = 600;
export const STASH_HOLD_SLOP = 12;
export const boardScope = (image: LibraryImage) => image.categoryId;
export const imageOnScopeBoard = (image: LibraryImage, scope: string | null) => image.categoryId === scope;
export { parentPath } from './stashGeometry';
export type StashTile = CategoryBoardGroup & { directCount: number; totalCount: number; childCount: number; previewIds: string[]; topImageId?: string };

/** Only immediate children become tiles. Count descendants once; render three previews. */
export function stashBoardLayout(images: LibraryImage[], categories: LibraryCategory[], scope: string | null,
  width: number, anchors: Record<string, BoardPoint>, occupied: BoardPoint[] = []): StashTile[] {
  const current = categories.find(stash => stash.id === scope)?.name || '';
  const byId = new Map(categories.map(stash => [stash.id, stash]));
  const totals = categoryCounts(images, categories);
  const direct = new Map<string, number>();
  const previews = new Map<string, LibraryImage[]>();
  const tops = new Map<string, LibraryImage>();
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
    const top = tops.get(image.categoryId);
    if (!top || compareStashImages(image, top) < 0) tops.set(image.categoryId, image);
    const name = byId.get(image.categoryId)?.name.toLocaleLowerCase();
    if (!name) continue;
    const relative = current ? name.slice(current.length + 1) : name;
    const child = childByName.get((current ? `${current.toLocaleLowerCase()}/` : '') + relative.split('/')[0]);
    if (!child || (current && !name.startsWith(`${current.toLocaleLowerCase()}/`))) continue;
    const ids = previews.get(child.id) || [];
    ids.push(image); ids.sort((a, b) => Number(b.categoryId === child.id) - Number(a.categoryId === child.id) || compareStashImages(a, b));
    if (ids.length > 3) ids.pop(); previews.set(child.id, ids);
  }
  return stashTileGeometry(categories, scope, width, anchors, occupied).map(tile => ({ ...tile, expanded: false,
    ids: [], directCount: direct.get(tile.id) || 0, totalCount: totals.get(tile.id) || 0,
    childCount: childCounts.get(tile.name.toLocaleLowerCase()) || 0,
    previewIds: (previews.get(tile.id) || []).map(image => image.id), topImageId: tops.get(tile.id)?.id }));
}

/** Deliberate central overlap, using the fitted image rather than its square frame. */
export function inGroupingTarget(point: BoardPoint, bounds: { left: number; top: number; width: number; height: number }) {
  return Math.abs(point.x - bounds.left - bounds.width / 2) <= bounds.width * .32 &&
    Math.abs(point.y - bounds.top - bounds.height / 2) <= bounds.height * .32;
}
