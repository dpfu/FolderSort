import type { LibraryCategory } from './libraryStore';
import type { BoardPoint } from './categoryBoard';

export const parentPath = (name: string) => name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';

/** Shared geometry for rendered stacks, first-open grids and incoming batches. */
export function stashTileGeometry(categories: LibraryCategory[], scope: string | null, width: number,
  anchors: Record<string, BoardPoint>, occupied: BoardPoint[] = []) {
  const current = categories.find(stash => stash.id === scope)?.name || '';
  const children = categories.filter(stash => parentPath(stash.name).toLocaleLowerCase() === current.toLocaleLowerCase());
  const columns = Math.max(1, Math.floor((width - 64) / 264));
  // Reserve saved stacks first, including those later in the name order.
  const used = [...occupied, ...children.flatMap(stash => anchors[stash.id] ? [anchors[stash.id]] : [])];
  return children.map((stash, index) => {
    let point = anchors[stash.id] || { x: 32 + index % columns * 264, y: 150 + Math.floor(index / columns) * 280 };
    if (!anchors[stash.id]) {
      while (used.some(other => Math.abs(other.x - point.x) < 236 && Math.abs(other.y - point.y) < 240)) point = { ...point, y: point.y + 280 };
    }
    if (!anchors[stash.id]) used.push(point);
    return { id: stash.id, name: stash.name, ...point, width: 236, height: 248 };
  });
}
