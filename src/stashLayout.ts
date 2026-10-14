import type { LibraryImage } from './libraryStore';
const comparePaths = new Intl.Collator(undefined, { numeric: true }).compare;

/** Explicit additions outrank legacy members; ties keep a deterministic order. */
export const compareStashImages = (a: LibraryImage, b: LibraryImage) =>
  (b.stashOrder || 0) - (a.stashOrder || 0) || b.addedAt - a.addedAt || comparePaths(a.path, b.path);

/** A compact grid with a spatial occupancy set, including for large stashes. */
export function stashGrid(ids: string[], width: number, occupied: Array<{ x: number; y: number; width?: number; height?: number }> = []) {
  const step = 214, left = 32, top = 120;
  const columns = Math.max(1, Math.floor((Math.min(width, 1800) - 64) / step), Math.ceil((ids.length + occupied.length) / 400));
  const blocked = new Set<string>();
  for (const point of occupied) {
    for (let column = Math.max(0, Math.ceil((point.x - left - 184) / step)); column <= Math.min(columns - 1, Math.floor((point.x - left + (point.width || 172) + 12) / step)); column++) {
      for (let row = Math.max(0, Math.ceil((point.y - top - 184) / step)); row <= Math.floor((point.y - top + (point.height || 172) + 12) / step); row++) blocked.add(`${column}:${row}`);
    }
  }
  let slot = 0;
  return ids.map(id => {
    while (blocked.has(`${slot % columns}:${Math.floor(slot / columns)}`)) slot++;
    const point = { id, x: left + slot % columns * step, y: top + Math.floor(slot / columns) * step };
    slot++; return point;
  });
}
