import * as React from 'react';
import type { BoardPoint } from './categoryBoard';
import { useStableCallback } from './useStableCallback';

type Card = BoardPoint & { id: string; z?: number };
type Follower = { node: HTMLElement; translate: string };
type Gesture = {
  id: string; ids: string[]; origin?: Card; minimum?: BoardPoint; followers: Follower[];
};
const NONE = new Set<string>();

function restore(gesture?: Gesture) {
  for (const { node, translate } of gesture?.followers || []) {
    node.style.translate = translate;
    node.style.removeProperty('--board-drag-z');
    node.removeAttribute('data-board-drag-follower');
  }
}

/** Translate mounted companions without React renders or storage writes per frame.
 * Motion owns the grabbed card; the existing fixed preview represents it. */
export function useBoardGroupDrag(board: React.RefObject<HTMLDivElement>) {
  const gesture = React.useRef<Gesture>();
  const [instantIds, setInstantIds] = React.useState<Set<string>>(NONE);
  React.useEffect(() => () => restore(gesture.current), []);

  const start = useStableCallback((id: string, ids: string[], cards: Card[], onBoard: boolean) => {
    restore(gesture.current);
    const selected = new Set(ids), members = onBoard ? cards.filter(card => selected.has(card.id)) : [];
    const origin = members.length > 1 ? members.find(card => card.id === id) : undefined;
    const byId = new Map(members.map(card => [card.id, card]));
    const next: Gesture = { id, ids: [...ids], origin, followers: [] };
    if (origin) {
      next.minimum = { x: Math.min(...members.map(card => card.x)), y: Math.min(...members.map(card => card.y)) };
      // Only mounted cards participate in the visual preview; large selections
      // retain the board's virtualization. Every selected record moves on drop.
      for (const node of board.current?.querySelectorAll<HTMLElement>('.card') || []) {
        const card = byId.get((node.dataset.testid || '').replace('card-', ''));
        if (!card || card.id === id) continue;
        next.followers.push({ node, translate: node.style.translate });
        node.dataset.boardDragFollower = '';
        node.style.setProperty('--board-drag-z', String(100000 + (card.z || 0)));
      }
    }
    gesture.current = next;
    setInstantIds(origin ? new Set(members.map(card => card.id)) : NONE);
  });
  const selection = useStableCallback((id: string) => gesture.current?.id === id ? gesture.current.ids : undefined);
  const project = useStableCallback((point: BoardPoint): BoardPoint | undefined => {
    const { origin, minimum } = gesture.current || {};
    if (!origin || !minimum) return;
    // Keep the group's spacing when a member reaches the world's top/left edge.
    return { x: Math.max(point.x, origin.x - minimum.x), y: Math.max(point.y, origin.y - minimum.y) };
  });
  const preview = useStableCallback((point: BoardPoint) => {
    const projected = project(point), current = gesture.current;
    if (!projected || !current?.origin) return;
    const x = projected.x - current.origin.x, y = projected.y - current.origin.y;
    for (const { node } of current.followers) node.style.translate = `${x}px ${y}px`;
    return projected;
  });
  const end = useStableCallback(() => {
    restore(gesture.current); gesture.current = undefined; setInstantIds(NONE);
  });
  return { start, selection, project, preview, end, instantIds };
}
