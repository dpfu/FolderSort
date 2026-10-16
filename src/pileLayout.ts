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

export type BoardBounds = { x: number; y: number; width: number; height: number; protected?: boolean };

/** Small intake batches stay in the visible board. Prefer clear space around
 * its centre; if it is full, use the least overlap rather than sending images
 * out of view. Index occupied rectangles, including stash stacks. */
export function arrangeVisibleBatch(ids: string[], occupied: BoardBounds[], view: BoardBounds, cardSize = 172) {
  const step = cardSize + 20;
  const left = Math.max(0, view.x), top = Math.max(0, view.y);
  const right = Math.max(left, view.x + view.width - cardSize);
  const bottom = Math.max(top, view.y + view.height - cardSize);
  const center = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const buckets = new Map<string, Set<BoardBounds>>();
  const cells = (rect: BoardBounds, visit: (key: string) => void) => {
    for (let y = Math.floor((rect.y - 10) / step); y <= Math.floor((rect.y + rect.height + 10) / step); y++) {
      for (let x = Math.floor((rect.x - 10) / step); x <= Math.floor((rect.x + rect.width + 10) / step); x++) visit(`${x},${y}`);
    }
  };
  const add = (rect: BoardBounds) => cells(rect, key => {
    const bucket = buckets.get(key) || new Set<BoardBounds>(); bucket.add(rect); buckets.set(key, bucket);
  });
  occupied.forEach(rect => {
    if (rect.x + rect.width >= left - 10 && rect.x <= right + cardSize + 10 &&
      rect.y + rect.height >= top - 10 && rect.y <= bottom + cardSize + 10) add(rect);
  });
  const points: Array<{ x: number; y: number }> = [];
  const seen = new Set<string>();
  const candidate = (x: number, y: number) => {
    const point = { x: Math.round(Math.max(left, Math.min(right, x))), y: Math.round(Math.max(top, Math.min(bottom, y))) };
    const key = `${point.x},${point.y}`;
    if (!seen.has(key)) { seen.add(key); points.push(point); }
  };
  const columns = Math.max(1, Math.min(ids.length, Math.floor((right - left) / step) + 1));
  const rows = Math.ceil(ids.length / columns);
  ids.forEach((_, index) => candidate(center.x + (index % columns - (columns - 1) / 2) * step,
    center.y + (Math.floor(index / columns) - (rows - 1) / 2) * step));
  // A half-step lattice finds room between existing loose images. The batch
  // is capped by the intake UI; this search is independent of dataset size.
  for (let y = top; y <= bottom + step / 2; y += step / 2) {
    for (let x = left; x <= right + step / 2; x += step / 2) candidate(x, y);
  }
  const preferred = points.slice(0, ids.length);
  return ids.map((id, index) => {
    const target = preferred[index] || center;
    const ordered = [...points].sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y));
    let best = ordered[0], leastOverlap = Infinity, leastProtectedOverlap = Infinity;
    for (const point of ordered) {
      const rect = { ...point, width: cardSize, height: cardSize };
      const neighbours = new Set<BoardBounds>();
      cells(rect, key => buckets.get(key)?.forEach(other => neighbours.add(other)));
      let overlap = 0, protectedOverlap = 0;
      for (const other of neighbours) {
        const area = Math.max(0, Math.min(rect.x + cardSize + 10, other.x + other.width) - Math.max(rect.x - 10, other.x))
          * Math.max(0, Math.min(rect.y + cardSize + 10, other.y + other.height) - Math.max(rect.y - 10, other.y));
        if (other.protected) protectedOverlap += area; else overlap += area;
      }
      if (protectedOverlap < leastProtectedOverlap || protectedOverlap === leastProtectedOverlap && overlap < leastOverlap) {
        best = point; leastOverlap = overlap; leastProtectedOverlap = protectedOverlap;
      }
      if (!overlap && !protectedOverlap) break;
    }
    add({ ...best, width: cardSize, height: cardSize });
    return { id, ...best };
  });
}

/** Visit only the strip's visible slots, plus moved or pinned images. The ID
 * index is reused between scroll frames; moved images retain free placement. */
export function visibleStripIndices(count: number, step: number, imageSize: number, left: number, right: number,
  moved: ReadonlyMap<string, { x: number }>, indexById: ReadonlyMap<string, number>, pinned: Array<string | null | undefined>): number[] {
  if (count <= 60) return Array.from({ length: count }, (_, index) => index);
  const first = Math.max(0, Math.ceil((left - imageSize - 26) / step));
  const last = Math.min(count - 1, Math.floor((right - 26) / step));
  const indices = new Set<number>();
  for (let index = first; index <= last; index++) indices.add(index);
  for (const [id, point] of moved) {
    const index = indexById.get(id);
    if (index === undefined) continue;
    if (point.x + imageSize >= left && point.x <= right) indices.add(index);
    else indices.delete(index);
  }
  for (const id of pinned) {
    const index = id ? indexById.get(id) : undefined;
    if (index !== undefined) indices.add(index);
  }
  return [...indices].sort((a, b) => a - b);
}
