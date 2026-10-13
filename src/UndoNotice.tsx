import { Undo2 } from 'lucide-react';
import './undo-notice.css';

/** Keep recovery visible; never hide it on a timer or steal keyboard focus. */
export default function UndoNotice({ message, detail, label, busy, onUndo }: {
  message: string; detail: string; label: string; busy: boolean; onUndo: () => void;
}) {
  return <section className="undo-notice" aria-label="Undo recent change">
    <Undo2 className="undo-notice__icon" size={22} aria-hidden="true" />
    <div role="status"><strong>{message}</strong><span>{detail}</span></div>
    <button type="button" disabled={busy} onClick={onUndo} title="Undo this change · Ctrl/Cmd+Z. Available until the next stash change, clear or delete action, or until you reload.">
      <Undo2 size={17} aria-hidden="true" /><span>{label}</span>
    </button>
  </section>;
}
