import type { BoardMove } from './useImageIntake';

export type IntakeView = { x: number; y: number; width: number; height: number };
export const PREVIEW_FRAME_PADDING = 6;
const SIZE = 172, GAP = 12;

/** Related drafts have stable slots, independent of quantity, occupancy or camera. */
export function placeAnchoredBatch(ids: string[], origin: { x: number; y: number }): BoardMove[] {
  return ids.map((id, index) => ({ id, x: Math.round(origin.x + index % 3 * (SIZE + GAP)),
    y: Math.round(origin.y + Math.floor(index / 3) * (SIZE + GAP)) }));
}

/** Session-only placement history. Undone/removed batches no longer advance it. */
export function nextSuggestionOrigin(reference: { x: number; y: number }, batches: BoardMove[][],
  stillPlaced: (move: BoardMove) => boolean): { x: number; y: number } {
  const last = [...batches].reverse().find(batch => batch.some(stillPlaced));
  return last ? { x: Math.min(...last.map(move => move.x)), y: Math.max(...last.map(move => move.y)) + SIZE + 24 }
    : { x: reference.x + SIZE + 64, y: reference.y };
}

/** Lay out only incoming images in the current view. Occupancy deliberately
 * does not affect the draft: overlaps are preferable to losing one's place. */
export function placeInPlaceBatch(ids: string[], view: IntakeView, reference?: { x: number; y: number }): BoardMove[] {
  if (!ids.length) return [];
  const left = Math.max(0, view.x), top = Math.max(0, view.y);
  const width = Math.max(SIZE, view.width), height = Math.max(SIZE, view.height);
  let columns = Math.max(1, Math.min(ids.length, Math.floor(width / SIZE)));
  if (Math.ceil(ids.length / columns) * (SIZE + GAP) - GAP > height) {
    // Prefer a little horizontal overlap to completely covering a lower row.
    // Keep card centres exposed when a small first batch just misses a full row.
    columns = Math.min(ids.length, Math.max(columns, 1 + Math.floor((width - SIZE) / (SIZE / 2 + GAP / 2))));
  }
  const rows = Math.ceil(ids.length / columns);
  const stepX = columns > 1 ? Math.min(SIZE + GAP, (width - SIZE) / (columns - 1)) : 0;
  // Big batches may overlap each other as well, without changing the camera.
  const stepY = rows > 1 ? Math.min(SIZE + GAP, (height - SIZE) / (rows - 1)) : 0;
  const groupWidth = SIZE + (columns - 1) * stepX, groupHeight = SIZE + (rows - 1) * stepY;
  const clamp = (point: { x: number; y: number }) => ({
    x: Math.max(left, Math.min(left + width - groupWidth, point.x)),
    y: Math.max(top, Math.min(top + height - groupHeight, point.y)),
  });
  const candidates = reference ? [
    { x: reference.x + SIZE + GAP, y: reference.y },
    { x: reference.x - (groupWidth - SIZE) / 2, y: reference.y + SIZE + GAP },
    { x: reference.x - groupWidth - GAP, y: reference.y },
    { x: reference.x - (groupWidth - SIZE) / 2, y: reference.y - groupHeight - GAP },
  ] : [{ x: left + (width - groupWidth) / 2, y: top + height - groupHeight }];
  const start = clamp(candidates.find(point => point.x >= left && point.x + groupWidth <= left + width
    && point.y >= top && point.y + groupHeight <= top + height) || candidates[0]);
  return ids.map((id, index) => ({ id, x: Math.round(start.x + index % columns * stepX), y: Math.round(start.y + Math.floor(index / columns) * stepY) }));
}

export function readIntakeView(board: HTMLElement | null, pane: HTMLElement | null, zoom: number, bottomInset = 64): IntakeView | undefined {
  const bounds = pane?.getBoundingClientRect(), canvas = board?.querySelector('[data-testid="board-canvas"]')?.getBoundingClientRect();
  if (!bounds || !canvas || !Number.isFinite(zoom) || zoom <= 0) return;
  const x = Math.max(0, (bounds.left + 20 - canvas.left) / zoom), y = Math.max(0, (bounds.top + 20 - canvas.top) / zoom);
  return { x, y, width: Math.max(SIZE, (bounds.right - 20 - canvas.left) / zoom - x),
    height: Math.max(SIZE, (bounds.bottom - 20 - bottomInset - canvas.top) / zoom - y) };
}
