export type PileLayout = 'mess' | 'grid';

export function pileGeometry(width: number, size: number, layout: PileLayout, count: number) {
  const padding = width < 600 ? 20 : 36;
  const step = layout === 'mess' ? size * .94 + 16 : size + 24;
  const columns = Math.max(1, Math.floor((width - padding * 2) / step));
  const columnWidth = (width - padding * 2) / columns;
  const rowHeight = layout === 'mess' ? size + 32 : size + 42;
  const rows = Math.ceil(count / columns);
  return { columns, columnWidth, rowHeight, padding, height: Math.max(0, rows * rowHeight + padding * 2) };
}

export function visiblePileRange(count: number, geometry: ReturnType<typeof pileGeometry>, top: number, height: number) {
  const firstRow = Math.max(0, Math.floor((top - geometry.padding) / geometry.rowHeight) - 2);
  const lastRow = Math.ceil((top + height - geometry.padding) / geometry.rowHeight) + 2;
  return { first: Math.min(count, firstRow * geometry.columns), end: Math.min(count, Math.max(0, lastRow * geometry.columns)) };
}

export function pileJitter(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash, 31) + id.charCodeAt(i) | 0;
  hash = Math.abs(hash);
  return { x: (hash % 17) - 8, y: ((hash >>> 4) % 15) - 7, angle: ((hash >>> 8) % 15) - 7 };
}

/** Place a batch without overlaps or an O(images²) collision scan. Occupied
 * cells use a spatial index; additional rows simply extend the existing board. */
export function arrangeBoardBatch(ids: string[], existing: Array<{ x: number; y: number }>, origin: { x: number; y: number }, columns: number, cardSize = 172) {
  const step = cardSize + 20;
  const buckets = new Map<string, Array<{ x: number; y: number }>>();
  const key = (x: number, y: number) => `${Math.floor(x / step)},${Math.floor(y / step)}`;
  const add = (point: { x: number; y: number }) => {
    const cell = key(point.x, point.y), points = buckets.get(cell) || [];
    points.push(point); buckets.set(cell, points);
  };
  existing.forEach(add);
  const occupied = (point: { x: number; y: number }) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const neighbours = buckets.get(key(point.x + dx * step, point.y + dy * step)) || [];
      if (neighbours.some(other => Math.abs(other.x - point.x) < cardSize + 10 && Math.abs(other.y - point.y) < cardSize + 10)) return true;
    }
    return false;
  };
  let slot = 0;
  const safeColumns = Math.max(1, Math.floor(columns));
  return ids.map(id => {
    let point;
    do {
      point = { x: Math.max(0, Math.round(origin.x + slot % safeColumns * step)), y: Math.max(0, Math.round(origin.y + Math.floor(slot / safeColumns) * step)) };
      slot++;
    } while (occupied(point));
    add(point);
    return { id, ...point };
  });
}
