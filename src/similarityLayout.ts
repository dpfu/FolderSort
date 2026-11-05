import { arrangeBoardBatch, arrangeVisibleBatch, type BoardBounds } from './pileLayout';
import type { SimilarMatch } from './imageAnalysis';

const SIZE = 172, GAP = 20;
type Point = { x: number; y: number };
type Viewport = { left: number; right: number; top: number; bottom: number };

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
