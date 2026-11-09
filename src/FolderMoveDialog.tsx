import * as React from 'react';
import { Check, Folder, LayoutDashboard, Search, X } from 'lucide-react';
import Modal from './Modal';
import { useAsyncTask } from './useAsyncTask';
import { folderMoveProblem, folderParentId } from './folderNesting';
import type { LibraryCategory } from './libraryStore';

export default function FolderMoveDialog({ folder, categories, busy, onChoose, onClose }: {
  folder: LibraryCategory; categories: LibraryCategory[]; busy: boolean;
  onChoose: (id: string | null) => Promise<void>; onClose: () => void;
}) {
  const [search, setSearch] = React.useState('');
  const { task, running, state: { error } } = useAsyncTask();
  const query = search.trim().toLocaleLowerCase();
  const parentId = folderParentId(folder, categories);
  const choose = async (id: string | null) => {
    if (busy) return;
    const ticket = task.begin(); if (!ticket) return;
    try { await onChoose(id); if (task.complete(ticket)) onClose(); }
    catch (cause) { task.fail(ticket, cause instanceof Error ? cause.message : 'Could not move folder.'); }
  };
  const matches = categories.filter(item => item.name.toLocaleLowerCase().includes(query));
  const showRoot = !query || 'staging'.includes(query);
  return <Modal label="Move folder" className="stash-picker" onClose={() => { if (!running) onClose(); }}>
    <div className="stash-picker__content">
      <header><div><h2>Move folder</h2><p>{folder.name}</p></div><button type="button" aria-label="Close folder chooser" disabled={running} onClick={onClose}><X size={20} /></button></header>
      <label className="stash-picker__search"><Search size={17} /><input data-modal-autofocus type="search" aria-label="Find folders" placeholder="Find a folder…" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <div className="stash-picker__list">
        {showRoot && <button type="button" aria-label={`Move folder ${folder.name} to Staging`} disabled={busy || running || parentId === null} onClick={() => void choose(null)}><LayoutDashboard size={18} /><span>Staging<small>Top-level folders</small></span>{parentId === null && <Check size={16} />}</button>}
        {matches.map(item => {
          const problem = folderMoveProblem(folder, item), current = item.id === parentId;
          return <button type="button" key={item.id} aria-label={`Move folder ${folder.name} into ${item.name}`} title={problem || (current ? 'Current location' : item.name)} disabled={busy || running || current || !!problem} onClick={() => void choose(item.id)}><Folder size={18} /><span>{item.name.split('/').at(-1)}{item.name.includes('/') && <small>{item.name}</small>}</span>{current && <Check size={16} />}</button>;
        })}
        {!showRoot && !matches.length && <p role="status">No folders match “{search.trim()}”.</p>}
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  </Modal>;
}
