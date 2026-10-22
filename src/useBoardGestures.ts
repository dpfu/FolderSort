import * as React from 'react';
import type { CameraView } from './camera';
import { anchorBoardGesture, moveBoardGesture, type GestureAnchor, type GestureCamera, type GesturePoint } from './boardGestures';

type TouchPoint = GesturePoint & { target: Element };
type TouchGesture = { ids: number[]; anchor: GestureAnchor; distance: number; moved: boolean; start: GesturePoint };
type SafariGesture = Event & { scale?: number; clientX?: number; clientY?: number };

/** Own board gestures before card drags can commit. Camera updates run once per frame. */
export function useBoardGestures({ enabled, boardRef, readView, onChange, onBlankClick }: {
  enabled: boolean; boardRef: React.RefObject<HTMLDivElement>; readView: () => CameraView | null;
  onChange: (view: GestureCamera) => void; onBlankClick?: () => void;
}) {
  const callbacks = React.useRef({ readView, onChange, onBlankClick }); callbacks.current = { readView, onChange, onBlankClick };
  const [navigating, setNavigating] = React.useState(false);
  React.useEffect(() => {
    const board = boardRef.current;
    if (!enabled || !board) return;
    const touches = new Map<number, TouchPoint>();
    let gesture: TouchGesture | undefined, safari: GestureAnchor | undefined;
    let owned = false, cancelling = false, suppressClick = false, frame = 0;
    let pending: GestureCamera | undefined;
    const local = (point: GesturePoint) => { const rect = board.getBoundingClientRect(); return { x: point.x - rect.left, y: point.y - rect.top }; };
    const view = (): CameraView | null => { const current = callbacks.current.readView(); return current && pending ? { ...current, ...pending } : current; };
    const flush = () => { cancelAnimationFrame(frame); frame = 0; const next = pending; pending = undefined; if (next) callbacks.current.onChange(next); };
    const queue = (next: GestureCamera) => { pending = next; if (!frame) frame = requestAnimationFrame(flush); };
    const stop = (event: Event) => { if (event.cancelable) event.preventDefault(); event.stopPropagation(); };
    const capture = (id: number) => { try { board.setPointerCapture(id); } catch { /* A touch may already have ended. */ } };
    const release = (id: number) => { if (board.hasPointerCapture(id)) board.releasePointerCapture(id); };
    const cancelDrags = () => {
      // Motion cards and stash drags already restore themselves on cancellation.
      // Retain our records: the physical fingers now navigate the camera.
      cancelling = true;
      for (const [id, point] of touches) {
        point.target.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: id, pointerType: 'touch', clientX: point.x, clientY: point.y }));
        for (let node: Element | null = point.target; node && node !== board; node = node.parentElement) {
          if (node.hasPointerCapture(id)) node.releasePointerCapture(id);
        }
      }
      cancelling = false;
    };
    const reset = () => {
      flush(); touches.forEach((_, id) => release(id)); touches.clear(); gesture = undefined; safari = undefined; owned = false; setNavigating(false);
    };
    const start = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') { if (!touches.size) suppressClick = false; return; }
      if (!touches.size) suppressClick = false;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY, target: event.target as Element });
      if (owned && !gesture) { stop(event); capture(event.pointerId); return; }
      if (touches.size >= 2) {
        stop(event);
        if (gesture?.ids.length === 2) { capture(event.pointerId); return; }
        const current = view(); if (!current) return;
        const entries = [...touches.entries()].slice(0, 2), a = entries[0][1], b = entries[1][1];
        const midpoint = local({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        cancelDrags();
        gesture = { ids: entries.map(([id]) => id), anchor: anchorBoardGesture(current, midpoint), distance: Math.max(16, Math.hypot(a.x - b.x, a.y - b.y)), moved: true, start: midpoint };
        owned = true; suppressClick = true; setNavigating(true); touches.forEach((_, id) => capture(id));
      } else if ((event.target as Element).hasAttribute('data-board-background')) {
        const current = view(); if (!current) return;
        const point = local({ x: event.clientX, y: event.clientY });
        gesture = { ids: [event.pointerId], anchor: anchorBoardGesture(current, point), distance: 1, moved: false, start: point };
        owned = true; stop(event); capture(event.pointerId);
      }
    };
    const move = (event: PointerEvent) => {
      const point = touches.get(event.pointerId); if (!point) return;
      point.x = event.clientX; point.y = event.clientY;
      if (!owned) return;
      stop(event);
      if (!gesture || !gesture.ids.includes(event.pointerId)) return;
      const a = touches.get(gesture.ids[0])!, b = touches.get(gesture.ids[1]);
      const midpoint = local(b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a);
      gesture.moved ||= Math.hypot(midpoint.x - gesture.start.x, midpoint.y - gesture.start.y) > 3;
      if (!gesture.moved) return;
      suppressClick = true; setNavigating(true);
      queue(moveBoardGesture(gesture.anchor, midpoint, b ? Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance : 1));
    };
    const end = (event: PointerEvent) => {
      if (cancelling || !touches.has(event.pointerId)) return;
      if (owned) {
        stop(event); flush();
        if (event.type === 'pointerup' && gesture?.ids.length === 1 && !gesture.moved) callbacks.current.onBlankClick?.();
        // Lift all fingers before starting a new image drag after a pinch.
        if (gesture?.ids.includes(event.pointerId)) gesture = undefined;
        release(event.pointerId);
      }
      touches.delete(event.pointerId);
      if (!touches.size || event.type === 'pointercancel') reset();
    };
    const click = (event: MouseEvent) => { if (suppressClick && event.detail > 0) stop(event); };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || touches.size) return;
      const current = view(); if (!current) return;
      stop(event);
      const point = local({ x: event.clientX, y: event.clientY });
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? current.viewportH : 1);
      queue(moveBoardGesture(anchorBoardGesture(current, point), point, Math.exp(-Math.max(-100, Math.min(100, delta)) * .01)));
    };
    const safariPoint = (event: SafariGesture) => local({ x: event.clientX ?? board.getBoundingClientRect().left + board.clientWidth / 2, y: event.clientY ?? board.getBoundingClientRect().top + board.clientHeight / 2 });
    const safariStart = (event: SafariGesture) => { event.preventDefault(); const current = view(); if (!touches.size && current) safari = anchorBoardGesture(current, safariPoint(event)); };
    const safariMove = (event: SafariGesture) => { event.preventDefault(); if (safari && !touches.size) queue(moveBoardGesture(safari, safariPoint(event), event.scale)); };
    const safariEnd = (event: Event) => { event.preventDefault(); safari = undefined; flush(); };
    const hidden = () => { if (document.hidden) reset(); };
    board.addEventListener('pointerdown', start, true);
    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', end, true); window.addEventListener('pointercancel', end, true);
    board.addEventListener('click', click, true); board.addEventListener('wheel', wheel, { passive: false });
    board.addEventListener('gesturestart', safariStart, { passive: false }); board.addEventListener('gesturechange', safariMove, { passive: false }); board.addEventListener('gestureend', safariEnd, { passive: false });
    window.addEventListener('blur', reset); document.addEventListener('visibilitychange', hidden);
    return () => {
      board.removeEventListener('pointerdown', start, true);
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', end, true); window.removeEventListener('pointercancel', end, true);
      board.removeEventListener('click', click, true); board.removeEventListener('wheel', wheel);
      board.removeEventListener('gesturestart', safariStart); board.removeEventListener('gesturechange', safariMove); board.removeEventListener('gestureend', safariEnd);
      window.removeEventListener('blur', reset); document.removeEventListener('visibilitychange', hidden);
      cancelAnimationFrame(frame); touches.forEach((_, id) => release(id));
    };
  }, [enabled, boardRef]);
  return navigating;
}
