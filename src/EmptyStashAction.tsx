import * as React from 'react';
import { Trash2 } from 'lucide-react';

/** Same empty-only action on a stack, inside a stash, and in the project list. */
export default function EmptyStashAction({ name, empty, busy, onDelete }: {
  name: string; empty: boolean; busy: boolean; onDelete: () => Promise<void>;
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState('');
  const reasonId = React.useId();
  return <>
    <button type="button" className="action-menu__item" aria-label={`Delete empty stash ${name}`}
      aria-describedby={!empty ? reasonId : undefined} disabled={busy || pending || !empty}
      onClick={event => { if (pending || busy || !empty) return; setPending(true); setError('');
        const menu = event.currentTarget.closest('details');
        void onDelete().then(() => { if (menu) menu.open = false; }).catch(cause => setError(cause instanceof Error ? cause.message : 'Could not delete stash.')).finally(() => setPending(false));
      }}><Trash2 size={16} aria-hidden="true" /><span>Delete empty stash</span></button>
    {!empty && <p id={reasonId}>Move images and sub-stashes out first.</p>}
    {error && <p role="alert">{error}</p>}
  </>;
}
