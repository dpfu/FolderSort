import { arrangeBoardBatch, arrangeVisibleBatch, type BoardBounds } from './pileLayout';
import type { SimilarMatch } from './imageAnalysis';

const SIZE = 172, GAP = 20;
type Point = { x: number; y: number };
type Viewport = { left: number; right: number; top: number; bottom: number };

/** One coherent preview group. These integer coordinates are also the saved
 * coordinates: accepting suggestions must never run another layout pass. */
export function placeSuggestionGroup(ids: string[], referenceId: string, positions: ReadonlyMap<string, Point>, groups: BoardBounds[], columns: number) {
  const origin = positions.get(referenceId);
  if (!origin || !ids.length) return [];
  const occupied = [...positions.values()].map(point => ({ ...point, width: SIZE, height: SIZE })).concat(groups);
  const clear = (points: Point[]) => points.every(point => point.x >= 0 && point.y >= 0 && occupied.every(other =>
    point.x + SIZE + 10 <= other.x || other.x + other.width + 10 <= point.x ||
    point.y + SIZE + 10 <= other.y || other.y + other.height + 10 <= point.y));
  const step = SIZE + GAP, cols = Math.max(1, Math.min(ids.length + 1, columns));
  const result = (points: Point[]) => ids.map((id, index) => ({ id, x: Math.round(points[index].x), y: Math.round(points[index].y) }));
  // On a wide board this is a row to the right. A narrow board wraps the
  // group around the reference, keeping all four photos readable together.
  for (const direction of [1, -1]) {
    const points = ids.map((_, index) => ({ x: origin.x + direction * ((index + 1) % cols) * step,
      y: origin.y + Math.floor((index + 1) / cols) * step }));
    if (clear(points)) return result(points);
  }
  const groupColumns = Math.min(ids.length, Math.max(1, cols - 1));
  const width = (groupColumns - 1) * step + SIZE;
  const height = Math.floor((ids.length - 1) / groupColumns) * step + SIZE;
  const groupAt = (x: number, y: number) => ids.map((_, index) => ({ x: x + index % groupColumns * step, y: y + Math.floor(index / groupColumns) * step }));
  for (let ring = 1; ring <= 32; ring++) {
    for (const start of [{ x: origin.x + step * ring, y: origin.y }, { x: origin.x, y: origin.y + step * ring },
      { x: origin.x - width - GAP - step * (ring - 1), y: origin.y }, { x: origin.x, y: origin.y - height - GAP - step * (ring - 1) }]) {
      const points = groupAt(start.x, start.y);
      if (clear(points)) return result(points);
    }
  }
  // A full canvas can grow. Never cover a folder tile or rearrange its images.
  return result(groupAt(origin.x, Math.max(...occupied.map(rect => rect.y + rect.height)) + GAP));
}

/** Keep matches near their reference, using more board space when the view is full. */
export function placeSimilarImages(matches: Pick<SimilarMatch, 'id' | 'referenceId'>[], positions: ReadonlyMap<string, Point>, groups: BoardBounds[], view: Viewport) {
  const occupied: BoardBounds[] = [...positions.values()].map(point => ({ ...point, width: SIZE, height: SIZE })).concat(groups);
  const clear = (point: Point) => occupied.every(other => point.x + SIZE + 10 <= other.x || other.x + other.width + 10 <= point.x || point.y + SIZE + 10 <= other.y || other.y + other.height + 10 <= point.y);
  const visible = (point: Point) => point.x >= view.left + 12 && point.x + SIZE <= view.right - 12 && point.y >= view.top + 12 && point.y + SIZE <= view.bottom - 12;
  const viewport = { x: Math.max(0, view.left + 12), y: Math.max(0, view.top + 12), width: Math.max(SIZE, view.right - Math.max(0, view.left) - 24), height: Math.max(SIZE, view.bottom - Math.max(0, view.top) - 24) };
  const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]];
  return matches.map(match => {
    const origin = positions.get(match.referenceId) || viewport;
    let point: Point | undefined;
    for (let ring = 1; ring <= 5 && !point; ring++) point = offsets.map(([x, y]) => ({ x: origin.x + x * (SIZE + GAP) * ring, y: origin.y + y * (SIZE + GAP) * ring })).find(candidate => visible(candidate) && clear(candidate));
    if (!point) {
      const candidate = arrangeVisibleBatch([match.id], occupied, viewport, SIZE)[0];
      if (visible(candidate) && clear(candidate)) point = candidate;
    }
    if (!point) {
      // Reserve whole folder tiles, not only their top-left corner. Additional
      // rows extend the board instead of piling matches on existing images.
      const reserved = occupied.flatMap(rect => Array.from({ length: Math.ceil(rect.height / SIZE) }, (_, row) =>
        Array.from({ length: Math.ceil(rect.width / SIZE) }, (_, column) => ({ x: rect.x + column * SIZE, y: rect.y + row * SIZE }))).flat());
      point = arrangeBoardBatch([match.id], reserved, { x: Math.min(90000, viewport.x), y: Math.min(16000, viewport.y) }, Math.max(1, Math.min(10, Math.floor(viewport.width / (SIZE + GAP)))), SIZE)[0];
    }
    occupied.push({ ...point, width: SIZE, height: SIZE });
    return { id: match.id, ...point };
  });
}
