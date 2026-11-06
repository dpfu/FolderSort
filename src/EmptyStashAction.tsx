import { useAsyncTask } from './useAsyncTask';
import * as React from 'react';
import { Trash2 } from 'lucide-react';

/** Same empty-only action on a stack, inside a stash, and in the project list. */
export default function EmptyStashAction({ name, empty, busy, onDelete }: {
  name: string; empty: boolean; busy: boolean; onDelete: () => Promise<void>;
}) {
  const { task, running: pending, state: { error } } = useAsyncTask();
  const reasonId = React.useId();
  return <>
    <button type="button" className="action-menu__item" aria-label={`Delete empty folder ${name}`}
      aria-describedby={!empty ? reasonId : undefined} disabled={busy || pending || !empty}
      onClick={event => { if (busy || !empty) return; const ticket = task.begin(); if (!ticket) return;
        const menu = event.currentTarget.closest('details');
        void onDelete().then(() => { if (task.complete(ticket) && menu) menu.open = false; }).catch(cause => task.fail(ticket, cause instanceof Error ? cause.message : 'Could not delete folder.'));
      }}><Trash2 size={16} aria-hidden="true" /><span>Delete empty folder</span></button>
    {!empty && <p id={reasonId}>Move images and subfolders out first.</p>}
    {error && <p role="alert">{error}</p>}
  </>;
}
