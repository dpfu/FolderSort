import * as React from 'react';
import { fitBoardView } from './stashView';
import { useStableCallback } from './useStableCallback';

/** Reveal is camera navigation, never a layout edit or folder move. */
export function useBoardReveal({ scopeId, cards, pane, onExpand, onFrame }: {
  scopeId: string | null; cards: Array<{ id: string; x: number; y: number }>;
  pane: React.RefObject<HTMLElement>; onExpand: (expanded: boolean) => void;
  onFrame: (view: { x: number; y: number; zoom: number }) => void;
}) {
  const latest = React.useRef({ scopeId, cards, onFrame }); latest.current = { scopeId, cards, onFrame };
  const frame = React.useRef<number>();
  React.useEffect(() => () => window.cancelAnimationFrame(frame.current!), []);
  return useStableCallback((ids: string[]) => {
    const wanted = new Set(ids), scope = scopeId;
    if (!cards.some(card => wanted.has(card.id))) return;
    onExpand(false);
    window.cancelAnimationFrame(frame.current!);
    // Wait for the expanded browser to give the board its real viewport back.
    frame.current = window.requestAnimationFrame(() => {
      if (latest.current.scopeId !== scope || !pane.current) return;
      const items = latest.current.cards.filter(card => wanted.has(card.id)).map(card => ({ ...card, width: 172, height: 172 }));
      if (items.length) latest.current.onFrame(fitBoardView(items, pane.current.clientWidth, pane.current.clientHeight));
    });
  });
}
