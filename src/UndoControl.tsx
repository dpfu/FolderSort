import * as React from 'react';
import { ActionButton } from './UiActions';

export type UndoView = { id: number; message: string; detail: string; label: string; busy: boolean; onUndo: () => void };

export default function UndoControl({ action, labelled = false }: { action?: UndoView; labelled?: boolean }) {
  const [fresh, setFresh] = React.useState(false);
  const touch = React.useRef<{ pointerId: number; x: number; y: number; actionId: number }>();
  const handledTouch = React.useRef(false);
  React.useEffect(() => {
    if (!action) { setFresh(false); return; }
    setFresh(true); const timer = window.setTimeout(() => setFresh(false), 4500);
    return () => window.clearTimeout(timer);
  }, [action?.id]);
  return <div className={`undo-control${fresh ? ' is-fresh' : ''}`}>
    <ActionButton icon="undo" label={action?.label || 'Undo'} disabled={!action || action.busy}
      onPointerDown={event => {
        handledTouch.current = false;
        touch.current = event.pointerType === 'touch' && action && !action.busy
          ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, actionId: action.id } : undefined;
      }}
      onPointerUp={event => {
        const press = touch.current; touch.current = undefined;
        if (!press || press.pointerId !== event.pointerId) return;
        handledTouch.current = true;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (action?.id === press.actionId && !action.busy && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 10
          && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) action.onUndo();
      }}
      onPointerCancel={() => { touch.current = undefined; handledTouch.current = true; }}
      onClick={event => {
        if (handledTouch.current && (event.detail > 0 || (event.nativeEvent as PointerEvent).pointerType)) return;
        if (action && !action.busy) action.onUndo();
      }}
      title={action ? `${action.message} ${action.detail} · Ctrl/Cmd+Z` : 'No recent action to undo'}>{labelled && <span>Undo</span>}</ActionButton>
    <span className="srOnly" role="status" aria-live="polite" aria-atomic="true">{action ? `${action.message} ${action.label} available.` : ''}</span>
  </div>;
}
