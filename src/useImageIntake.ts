import { useTimedValue } from './useTimedValue';
import * as React from 'react';
import { arrangeBoardBatch } from './pileLayout';
import { imageOnScopeBoard } from './stashBoard';
import type { LibraryImage } from './libraryStore';
import type { CategoryBoardGroup } from './categoryBoard';
import { useStableCallback } from './useStableCallback';
import { placeInPlaceBatch, readIntakeView } from './imageIntakeLayout';

/** boardScope is the destination folder; null moves to Staging, omission keeps membership. */
export type BoardMove = { id: string; x: number; y: number; boardScope?: string | null };
const SIZE = 172;

/** Plan a move into the current folder and animate its arrival. */
export function useImageIntake({ images, scopeId, zoom, bottomInset = 0, board, pane, cards, groups, onPlace }: {
  images: LibraryImage[]; scopeId: string | null; zoom: number; bottomInset?: number;
  board: React.RefObject<HTMLDivElement>; pane: React.RefObject<HTMLDivElement>;
  cards: Array<{ id: string; x: number; y: number }>; groups: CategoryBoardGroup[];
  onPlace: (moves: BoardMove[]) => void;
}) {
  type Arrival = { phase: 'idle' | 'arriving'; ids: string[]; origins: Map<string, { x: number; y: number; delay: number; inPlace?: boolean }> };
  const [empty] = React.useState<Arrival>(() => ({ phase: 'idle', ids: [], origins: new Map() }));
  const [arrival, setArrival] = useTimedValue(empty, 900);
  const animate = useStableCallback((ids: string[]) => setArrival({ phase: 'arriving', ids: ids.slice(0, 24), origins: new Map() }));
  const settle = useStableCallback((moves: BoardMove[]) => setArrival({ phase: 'arriving', ids: moves.slice(0, 24).map(move => move.id),
    origins: new Map(moves.slice(0, 24).map((move, index) => [move.id, { x: move.x, y: move.y, delay: Math.min(index, 5) * .025, inPlace: true }])) }));
  const add = useStableCallback((ids: string[], _origin?: DOMRect) => {
    const byId = new Map(images.map(image => [image.id, image]));
    const eligible = [...new Set(ids)].filter(id => { const image = byId.get(id); return image && !imageOnScopeBoard(image, scopeId); });
    const view = readIntakeView(board.current, pane.current, zoom, bottomInset);
    if (!eligible.length || !view) return 0;
    // Keep large additions within the persisted world's coordinate range even
    // on a narrow board; a one-column phone layout would exceed it at 3,000.
    const columns = Math.max(1, Math.min(10, Math.floor(view.width / (SIZE + 20))), Math.ceil((eligible.length + cards.length + groups.length * 4) / 350));
    const originX = Math.min(90000, Math.max(16, view.x)), originY = Math.min(16000, Math.max(16, view.y));
    const reservedStacks = () => groups.flatMap(group => Array.from({ length: Math.ceil(group.height / SIZE) }, (_, row) =>
      Array.from({ length: Math.ceil(group.width / SIZE) }, (_, column) => ({ x: group.x + column * SIZE, y: group.y + row * SIZE }))).flat());
    const moves = eligible.length <= 24 ? placeInPlaceBatch(eligible, view)
      : arrangeBoardBatch(eligible, [...cards, ...reservedStacks()], { x: originX, y: originY }, columns);
    settle(moves); onPlace(moves);
    return moves.length;
  });
  return { add, animate, settle, dealtIds: arrival.ids, dealOrigins: arrival.origins };
}
