import { useFolderGestures } from './useFolderGestures';
import { useAsyncTask } from './useAsyncTask';
import * as React from 'react';
import { Folder, FolderInput, Pencil, Trash2 } from 'lucide-react';
import ActionMenu from './ActionMenu';
import EmptyStashAction from './EmptyStashAction';
import { categoryColor } from './categoryTree';
import type { BoardPoint } from './categoryBoard';
import type { LibraryImage } from './libraryStore';
import { useThumbnailUrls } from './useThumbnailUrls';
import type { ImageThumbnailCache } from './imageThumbnails';
import type { StashTile } from './stashBoard';
import type { RenameStash } from './useActionHistory';

export default function StashBoardLayer({ groups, urls, thumbnailCache, zoom, busy, hoverId, pulseId, editingId, images, onImageStart, onImageMove, onImageEnd, onImageDrop, onOpen, onMove, onPreviewMove, onCancelMove, onRename, onFinishNaming, onRequestMove, onDelete }: {
  images: Map<string, LibraryImage>; thumbnailCache?: ImageThumbnailCache;
  onImageStart: (id: string, point: BoardPoint, anchor: BoardPoint) => void;
  onImageMove: (id: string, point: BoardPoint) => void; onImageEnd: () => void;
  onImageDrop: (id: string, stashId: string, point: BoardPoint) => void;
  groups: StashTile[]; urls: Map<string, string>; zoom: number; busy: boolean; hoverId: string | null; pulseId: string | null; editingId: string | null;
  onOpen: (id: string) => void; onMove: (group: StashTile, delta: BoardPoint, point?: BoardPoint) => void;
  onPreviewMove: (group: StashTile, delta: BoardPoint, point?: BoardPoint) => void; onCancelMove: () => void; onRename: RenameStash;
  onFinishNaming: (id: string) => void;
  onRequestMove: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  return <div className="stash-board">{groups.map(group => <Stash key={group.id} {...{ group, urls, thumbnailCache, zoom, busy, hoverId, pulseId, editingId, images, onImageStart, onImageMove, onImageEnd, onImageDrop, onOpen, onMove, onPreviewMove, onCancelMove, onRename, onFinishNaming, onRequestMove, onDelete }} />)}</div>;
}

function Stash({ group, urls, thumbnailCache, zoom, busy, hoverId, pulseId, editingId, images, onImageStart, onImageMove, onImageEnd, onImageDrop, onOpen, onMove, onPreviewMove, onCancelMove, onRename, onFinishNaming, onRequestMove, onDelete }: Omit<Parameters<typeof StashBoardLayer>[0], 'groups'> & { group: StashTile }) {
  useThumbnailUrls(thumbnailCache, [...group.previewIds, ...(group.topImageId ? [group.topImageId] : [])]);
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(group.name.split('/').at(-1)!);
  const [error, setError] = React.useState('');
  const { task: renameTask } = useAsyncTask();
  const input = React.useRef<HTMLInputElement>(null);
  const firstNameFocus = React.useRef(false);
  const initialNaming = React.useRef(editingId === group.id);
  const gestures = useFolderGestures({ group, zoom, busy, onImageStart, onImageMove, onImageEnd, onImageDrop, onOpen, onMove, onPreviewMove, onCancelMove });
  const { takingOut } = gestures;
  const topImage = group.topImageId ? images.get(group.topImageId) : undefined;
  React.useEffect(() => {
    // Creation remembers the first rename for Undo grouping, but never opens or focuses a form.
    if (editingId === group.id) initialNaming.current = true;
  }, [editingId, group.id]);
  React.useEffect(() => { if (error && editing && !busy) input.current?.focus({ preventScroll: true }); }, [error, editing, busy]);
  React.useEffect(() => {
    if (!editing) return;
    const delay = firstNameFocus.current && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 360 : 0;
    const timer = window.setTimeout(() => { firstNameFocus.current = false; if (document.activeElement !== input.current) { input.current?.focus({ preventScroll: true }); input.current?.select(); } }, delay);
    return () => window.clearTimeout(timer);
  }, [editing]);
  const empty = group.directCount === 0 && group.totalCount === 0 && group.childCount === 0;
  const finishEditing = () => { initialNaming.current = false; setEditing(false); setError(''); onFinishNaming(group.id); };
  const saveName = async () => {
    const parent = group.name.includes('/') ? group.name.slice(0, group.name.lastIndexOf('/') + 1) : '';
    if (name.trim()) await onRename(group.id, parent + name.trim(), { initialNaming: initialNaming.current });
  };
  const commit = async () => {
    if (busy || !name.trim()) return; const ticket = renameTask.begin(); if (!ticket) return;
    try { await saveName(); if (renameTask.complete(ticket)) finishEditing(); }
    catch (cause) { if (renameTask.fail(ticket, cause)) setError(cause instanceof Error ? cause.message : 'Could not rename folder.'); }
  };
  const remove = async () => {
    // Commit an edited name before deletion so Undo restores that name too.
    if (editing && name.trim()) { await saveName(); if (!renameTask.active) return; finishEditing(); }
    await onDelete(group.id);
  };
  return <section className={`stash-tile${hoverId === group.id ? ' is-drop-target' : ''}${pulseId === group.id ? ' is-settled' : ''}`}
    data-stash-drop-id={group.id} data-board-group-id={group.id} aria-label={`Folder ${group.name}`}
    style={{ left: group.x, top: group.y, width: group.width, height: group.height, '--stash-color': categoryColor(group.name) } as React.CSSProperties}>
    <div className="stash-tile__head">
      <button type="button" className="stash-tile__handle" aria-label={`Move folder ${group.name}`} title="Drag to move the folder" disabled={busy}
        {...gestures.handle}>
        <Folder size={19} aria-hidden="true" />{!editing && <strong>{group.name.split('/').at(-1)}</strong>}
      </button>
      {editing && <form onSubmit={event => { event.preventDefault(); void commit(); }}><input ref={input} aria-label="Folder name" aria-invalid={!!error} aria-describedby={error ? `stash-error-${group.id}` : undefined} value={name} disabled={busy} maxLength={120} onChange={event => { setName(event.target.value); setError(''); }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); finishEditing(); setName(group.name.split('/').at(-1)!); } }} /><button type="submit" disabled={busy || !name.trim()}>Save</button></form>}
      <ActionMenu label={`Folder actions for ${group.name}`} className="stash-tile__menu">
        <p><span>{group.directCount.toLocaleString()} {group.directCount === 1 ? 'image' : 'images'} here</span>{group.childCount > 0 && <span>{group.totalCount.toLocaleString()} including subfolders</span>}</p>
        <button type="button" className="action-menu__item" data-close-menu disabled={busy} aria-label={`Rename folder ${group.name}`} onClick={() => { initialNaming.current = editingId === group.id; onFinishNaming(group.id); setName(group.name.split('/').at(-1)!); setEditing(true); }}><Pencil size={15} aria-hidden="true" /><span>Rename</span></button>
        <button type="button" className="action-menu__item" data-close-menu disabled={busy} onClick={() => onRequestMove(group.id)}><FolderInput size={15} aria-hidden="true" /><span>Move folder…</span></button>
        <EmptyStashAction name={group.name} empty={empty} busy={busy} onDelete={remove} />
      </ActionMenu>
    </div>
    {error && <p className="stash-tile__error" id={`stash-error-${group.id}`} role="alert">{error}</p>}
    <div className="stash-tile__previews">
      {[...group.previewIds].reverse().filter(id => id !== group.topImageId && urls.get(id)).map((id, index) => <img key={id} src={urls.get(id)} alt="" style={{ '--preview-index': index } as React.CSSProperties} draggable={false} />)}
      {empty ? <button type="button" className="stash-tile__delete-empty" aria-label={`Delete empty folder ${group.name}`} title="Delete empty folder" disabled={busy}
        onPointerDown={event => event.stopPropagation()}
        onClick={() => { void remove().catch(cause => setError(cause instanceof Error ? cause.message : 'Could not delete empty folder.')); }}><Trash2 size={18} /></button> : topImage ? <button type="button" className={`stash-tile__top${takingOut ? ' is-taking-out' : ''}`} aria-label={`Top image ${topImage.path.split('/').at(-1)} in folder ${group.name}`} aria-description="Drag to take out; click to open folder." disabled={busy}
        data-stash-top-image={topImage.id}
        {...gestures.top}>
        {urls.get(topImage.id) ? <img src={urls.get(topImage.id)} alt="" draggable={false} /> : <span className="stash-tile__missing"><Folder size={32} /><small>{topImage.path.split('/').at(-1)}</small></span>}
      </button> : !empty && <button type="button" className="stash-tile__browse" aria-label={`Browse folder ${group.name}`} disabled={busy} onClick={() => onOpen(group.id)}>
        {!group.previewIds.some(id => urls.get(id)) && <Folder size={42} aria-hidden="true" />}
      </button>}
    </div>
    <button type="button" className="stash-tile__open" aria-label={`Open folder ${group.name}`} aria-description={`${group.directCount.toLocaleString()} ${group.directCount === 1 ? 'image' : 'images'} directly in this folder${group.childCount ? `; ${group.childCount.toLocaleString()} ${group.childCount === 1 ? 'subfolder' : 'subfolders'}; ${group.totalCount.toLocaleString()} ${group.totalCount === 1 ? 'image' : 'images'} including subfolders` : ''}.`} onClick={() => onOpen(group.id)} disabled={busy}>
      <span className="stash-tile__counts"><span><b>{group.directCount.toLocaleString()}</b> {group.directCount === 1 ? 'image' : 'images'}</span>{group.childCount > 0 && <span className="stash-tile__subcount"> · {group.childCount.toLocaleString()} {group.childCount === 1 ? 'subfolder' : 'subfolders'}</span>}</span>
      <svg className="stash-entry-folder" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M3 9V5.5A1.5 1.5 0 0 1 4.5 4h4.8l2.1 2.5h8.1A1.5 1.5 0 0 1 21 8v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
        <path className="stash-entry-folder__front" d="M3 9h18v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z" />
      </svg>
    </button>
    {hoverId === group.id && <span className="stash-tile__drop">Release to move into folder</span>}
  </section>;
}
