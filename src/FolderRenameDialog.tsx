import * as React from 'react';
import Modal from './Modal';
import { useAsyncTask } from './useAsyncTask';
import type { LibraryCategory } from './libraryStore';

export default function FolderRenameDialog({ folder, busy, onRename, onClose }: {
  folder: LibraryCategory; busy: boolean; onRename: (id: string, name: string) => Promise<void>; onClose: () => void;
}) {
  const [name, setName] = React.useState(folder.name.split('/').at(-1)!), [error, setError] = React.useState('');
  const { task, running } = useAsyncTask();
  const input = React.useRef<HTMLInputElement>(null), errorId = React.useId();
  React.useEffect(() => { if (error && !busy) input.current?.focus({ preventScroll: true }); }, [error, busy]);
  return <Modal label="Rename folder" className="stash-picker" onClose={() => { if (!running) onClose(); }}>
    <form className="workspace-rename" onSubmit={event => {
      event.preventDefault(); if (busy || !name.trim()) return;
      const ticket = task.begin(); if (!ticket) return;
      void onRename(folder.id, [...folder.name.split('/').slice(0, -1), name.trim()].join('/'))
        .then(() => { if (task.complete(ticket)) onClose(); })
        .catch(cause => { if (task.fail(ticket, cause)) setError(cause instanceof Error ? cause.message : String(cause)); });
    }}><h2>Rename folder</h2><input ref={input} data-modal-autofocus aria-label="Folder name" aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
      value={name} disabled={running} onChange={event => { setName(event.target.value); setError(''); }} />
      <div><button type="button" disabled={running} onClick={onClose}>Cancel</button><button type="submit" disabled={busy || running || !name.trim()}>Save</button></div>
      {error && <p id={errorId} role="alert">{error}</p>}
    </form>
  </Modal>;
}
