import * as React from 'react';
import { Check, Folder, Plus, Search, X } from 'lucide-react';
import { categoryColor, categoryCounts } from './categoryTree';
import type { LibraryCategory, LibraryImage } from './libraryStore';
import Modal from './Modal';

type Props = { categories: LibraryCategory[]; images: LibraryImage[]; selected: LibraryImage[]; busy: boolean;
  onChoose: (id: string | null) => Promise<void>; onClose: () => void; onCreate?: (name: string) => Promise<void> };

export function StashPickerContent({ categories, images, selected, busy, onChoose, onClose, onCreate }: Props) {
  const [search, setSearch] = React.useState('');
  const [name, setName] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState('');
  const counts = React.useMemo(() => categoryCounts(images, categories), [images, categories]);
  const query = search.trim().toLocaleLowerCase();
  const showRoot = !query || 'root unsorted images'.includes(query);
  const matches = categories.filter(stash => stash.name.toLocaleLowerCase().includes(query));
  const choose = async (action: () => Promise<void>) => {
    if (pending || busy) return;
    setPending(true); setError('');
    try { await action(); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not move images.'); }
    finally { setPending(false); }
  };
  return <div className="stash-picker__content">
    <header><div><h2>Move to stash</h2><p>{selected.length.toLocaleString()} {selected.length === 1 ? 'image' : 'images'} selected</p></div><button type="button" aria-label="Close stash chooser" onClick={onClose}><X size={20} /></button></header>
    <label className="stash-picker__search"><Search size={17} /><input data-modal-autofocus type="search" aria-label="Find stashes" placeholder="Find a stash…" value={search} onChange={event => setSearch(event.target.value)} /></label>
    <div className="stash-picker__list">
      {showRoot && <button type="button" disabled={busy || pending} onClick={() => void choose(() => onChoose(null))}><Folder size={18} /><span>Root<small>Unsorted images</small></span><b>{counts.get('unassigned') || 0}</b></button>}
      {matches.map(stash => <button key={stash.id} type="button" aria-label={`Move ${selected.length === 1 ? selected[0]?.path : `${selected.length} images`} to ${stash.name}`} disabled={busy || pending} onClick={() => void choose(() => onChoose(stash.id))} style={{ '--stash-color': categoryColor(stash.name) } as React.CSSProperties}>
        <Folder size={18} /><span>{stash.name.split('/').at(-1)}{stash.name.includes('/') && <small>{stash.name}</small>}</span><b title="Including sub-stashes">{counts.get(stash.id) || 0}</b>{selected.length > 0 && selected.every(image => image.categoryId === stash.id) && <Check size={16} />}
      </button>)}
      {!showRoot && !matches.length ? <p role="status">No stashes match “{search.trim()}”.</p> : !categories.length && !query && <p>No stashes yet.</p>}
    </div>
    {onCreate && <form onSubmit={event => { event.preventDefault(); if (name.trim()) void choose(() => onCreate(name.trim())); }}><input aria-label="New stash name" placeholder="Or create a stash…" value={name} onChange={event => setName(event.target.value)} disabled={busy || pending} /><button type="submit" disabled={busy || pending || !name.trim()}><Plus size={17} />Create stash</button></form>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

export default function StashPicker(props: Props) {
  return <Modal label="Move to stash" className="stash-picker" onClose={props.onClose}><StashPickerContent {...props} /></Modal>;
}
