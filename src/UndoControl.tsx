import * as React from 'react';
import { ActionButton } from './UiActions';

export type UndoView = { id: number; message: string; detail: string; label: string; busy: boolean; onUndo: () => void };

export default function UndoControl({ action }: { action?: UndoView }) {
  const [fresh, setFresh] = React.useState(false);
  React.useEffect(() => {
    if (!action) { setFresh(false); return; }
    setFresh(true); const timer = window.setTimeout(() => setFresh(false), 4500);
    return () => window.clearTimeout(timer);
  }, [action?.id]);
  return <div className={`undo-control${fresh ? ' is-fresh' : ''}`}>
    <ActionButton icon="undo" label={action?.label || 'Undo'} disabled={!action || action.busy} onClick={action?.onUndo}
      title={action ? `${action.message} ${action.detail} · Ctrl/Cmd+Z` : 'No recent action to undo'} />
    <span className="srOnly" role="status" aria-live="polite" aria-atomic="true">{action ? `${action.message} ${action.label} available.` : ''}</span>
  </div>;
}
