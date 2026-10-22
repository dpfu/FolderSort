import * as React from 'react';
import { arrangeBoardBatch, arrangeVisibleBatch } from './pileLayout';
import { imageOnScopeBoard } from './stashBoard';
import type { LibraryImage } from './libraryStore';
import type { CategoryBoardGroup } from './categoryBoard';
import { useStableCallback } from './useStableCallback';
import { fitBoardView } from './stashView';

export type BoardMove = { id: string; x: number; y: number; boardScope?: string | null };
const SIZE = 172;

/** Intake plans placement; assignment is always a separate explicit action. */
export function useImageIntake({ images, scopeId, zoom, board, pane, cards, groups, onPlace, onFrame }: {
  images: LibraryImage[]; scopeId: string | null; zoom: number;
  board: React.RefObject<HTMLDivElement>; pane: React.RefObject<HTMLDivElement>;
  cards: Array<{ id: string; x: number; y: number }>; groups: CategoryBoardGroup[];
  onPlace: (moves: BoardMove[]) => void;
  onFrame?: (view: { x: number; y: number; zoom: number }) => void;
}) {
  const [dealtIds, setDealtIds] = React.useState<string[]>([]);
  const [dealOrigins, setDealOrigins] = React.useState<Map<string, { x: number; y: number; delay: number }>>(new Map());
  const timer = React.useRef<number>();
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  const animate = useStableCallback((ids: string[]) => {
    setDealtIds(ids.slice(0, 24)); window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { setDealtIds([]); setDealOrigins(new Map()); }, 900);
  });
  const add = useStableCallback((ids: string[], origin?: DOMRect) => {
    const byId = new Map(images.map(image => [image.id, image]));
    const eligible = [...new Set(ids)].filter(id => { const image = byId.get(id); return image && !imageOnScopeBoard(image, scopeId); });
    const bounds = pane.current?.getBoundingClientRect(), canvas = board.current?.querySelector('[data-testid="board-canvas"]')?.getBoundingClientRect();
    if (!eligible.length || !bounds || !canvas) return 0;
    const view = { x: (bounds.left + 20 - canvas.left) / zoom, y: (bounds.top + 20 - canvas.top) / zoom,
      width: Math.max(SIZE, (bounds.width - 40) / zoom), height: Math.max(SIZE, (bounds.height - 40) / zoom) };
    const occupied = [...cards.map(card => ({ ...card, width: SIZE, height: SIZE })), ...groups.map(group => ({ ...group, protected: true }))];
    // Keep large additions within the persisted world's coordinate range even
    // on a narrow board; a one-column phone layout would exceed it at 3,000.
    const columns = Math.max(1, Math.min(10, Math.floor(view.width / (SIZE + 20))), Math.ceil((eligible.length + cards.length + groups.length * 4) / 350));
    const originX = Math.min(90000, Math.max(16, view.x)), originY = Math.min(16000, Math.max(16, view.y));
    const needsRoom = eligible.length <= 24 && !cards.length && !groups.length && eligible.length > Math.max(1, Math.floor(view.width / (SIZE + 12))) * Math.max(1, Math.floor(view.height / (SIZE + 12)));
    const reservedStacks = () => groups.flatMap(group => Array.from({ length: Math.ceil(group.height / SIZE) }, (_, row) =>
      Array.from({ length: Math.ceil(group.width / SIZE) }, (_, column) => ({ x: group.x + column * SIZE, y: group.y + row * SIZE }))).flat());
    let moves = eligible.length <= 24 ? arrangeVisibleBatch(eligible, occupied, view, SIZE)
      : arrangeBoardBatch(eligible, [...cards, ...reservedStacks()], { x: originX, y: originY }, columns);
    // A fitted stack can leave the camera looking across negative world space.
    // If the first batch has no clear landing area, extend the layout and frame
    // it together with the stacks. Existing objects stay exactly where they are.
    const overlaps = (a: { x: number; y: number }, b: { x: number; y: number; width: number; height: number }) =>
      a.x < b.x + b.width && a.x + SIZE > b.x && a.y < b.y + b.height && a.y + SIZE > b.y;
    const reframe = eligible.length <= 24 && !cards.length && (needsRoom || moves.some((move, index) =>
      groups.some(group => overlaps(move, group)) || moves.slice(0, index).some(other => overlaps(move, { ...other, width: SIZE, height: SIZE }))));
    if (reframe) moves = arrangeBoardBatch(eligible, reservedStacks(), { x: originX, y: originY },
      Math.max(1, Math.ceil(Math.sqrt(eligible.length * bounds.width / bounds.height))));
    if (origin) setDealOrigins(new Map(moves.slice(0, 24).map((move, index) => [move.id, {
      x: (origin.left + origin.width / 2 - canvas.left) / zoom - SIZE / 2,
      y: (origin.top + origin.height / 2 - canvas.top) / zoom - SIZE / 2, delay: index * .035,
    }])));
    animate(moves.map(move => move.id)); onPlace(moves);
    if (reframe) onFrame?.(fitBoardView([...groups, ...moves.map(move => ({ ...move, width: SIZE, height: SIZE }))], bounds.width, bounds.height));
    return moves.length;
  });
  return { add, animate, dealtIds, dealOrigins };
}
