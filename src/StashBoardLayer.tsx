import * as React from 'react';
import { ArrowRight, Folder, GripHorizontal, Pencil } from 'lucide-react';
import { categoryColor } from './categoryTree';
import type { BoardPoint } from './categoryBoard';
import type { LibraryImage } from './libraryStore';
import type { StashTile } from './stashBoard';

export default function StashBoardLayer({ groups, urls, zoom, busy, hoverId, pulseId, editingId, images, onImageStart, onImageMove, onImageEnd, onImageDrop, onOpen, onMove, onPreviewMove, onCancelMove, onRename }: {
  images: Map<string, LibraryImage>;
  onImageStart: (id: string, point: BoardPoint, anchor: BoardPoint) => void;
  onImageMove: (id: string, point: BoardPoint) => void; onImageEnd: () => void;
  onImageDrop: (id: string, stashId: string, point: BoardPoint) => void;
  groups: StashTile[]; urls: Map<string, string>; zoom: number; busy: boolean; hoverId: string | null; pulseId: string | null; editingId: string | null;
  onOpen: (id: string) => void; onMove: (group: StashTile, delta: BoardPoint) => void;
  onPreviewMove: (group: StashTile, delta: BoardPoint) => void; onCancelMove: () => void; onRename: (id: string, name: string) => Promise<void>;
}) {
  return <div className="stash-board">{groups.map(group => <Stash key={group.id} {...{ group, urls, zoom, busy, hoverId, pulseId, editingId, images, onImageStart, onImageMove, onImageEnd, onImageDrop, onOpen, onMove, onPreviewMove, onCancelMove, onRename }} />)}</div>;
}

function Stash({ group, urls, zoom, busy, hoverId, pulseId, editingId, images, onImageStart, onImageMove, onImageEnd, onImageDrop, onOpen, onMove, onPreviewMove, onCancelMove, onRename }: Omit<Parameters<typeof StashBoardLayer>[0], 'groups'> & { group: StashTile }) {
  const [editing, setEditing] = React.useState(editingId === group.id);
  const [name, setName] = React.useState(group.name.split('/').at(-1)!);
  const [error, setError] = React.useState('');
  const drag = React.useRef<{ pointerId: number; x: number; y: number; delta: BoardPoint }>();
  const input = React.useRef<HTMLInputElement>(null);
  const taking = React.useRef<{ id: string; pointerId: number; x: number; y: number; anchor: BoardPoint; started: boolean }>();
  const [takingOut, setTakingOut] = React.useState(false);
  const topImage = group.topImageId ? images.get(group.topImageId) : undefined;
  const cancelImage = () => { if (taking.current?.started) onImageEnd(); taking.current = undefined; setTakingOut(false); };
  React.useEffect(() => () => { if (taking.current?.started) onImageEnd(); }, []);
  React.useEffect(() => { if (editingId === group.id) setEditing(true); }, [editingId, group.id]);
  React.useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);
  const commit = async () => {
    if (busy) return;
    const parent = group.name.includes('/') ? group.name.slice(0, group.name.lastIndexOf('/') + 1) : '';
    try { if (name.trim() && parent + name.trim() !== group.name) await onRename(group.id, parent + name.trim()); setEditing(false); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not rename stash.'); }
  };
  return <section className={`stash-tile${hoverId === group.id ? ' is-drop-target' : ''}${pulseId === group.id ? ' is-settled' : ''}`}
    data-stash-drop-id={group.id} data-board-group-id={group.id} aria-label={`Stash ${group.name}`}
    style={{ left: group.x, top: group.y, width: group.width, height: group.height, '--stash-color': categoryColor(group.name) } as React.CSSProperties}>
    <div className="stash-tile__head">
      <button type="button" className="stash-tile__handle" aria-label={`Move stash ${group.name}`} title="Drag to move the stash" disabled={busy}
        onPointerDown={event => { if (event.button !== 0) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, delta: { x: 0, y: 0 } }; }}
        onPointerMove={event => { const d = drag.current; if (!d || d.pointerId !== event.pointerId) return; d.delta = { x: Math.max(-group.x + 8, (event.clientX - d.x) / zoom), y: Math.max(-group.y + 8, (event.clientY - d.y) / zoom) }; onPreviewMove(group, d.delta); }}
        onPointerUp={() => { const d = drag.current; drag.current = undefined; if (!d) return; if (Math.hypot(d.delta.x, d.delta.y) > 4 / zoom) onMove(group, d.delta); else onCancelMove(); }}
        onPointerCancel={() => { drag.current = undefined; onCancelMove(); }} onLostPointerCapture={() => { if (drag.current) { drag.current = undefined; onCancelMove(); } }}
        onKeyDown={event => { if (!event.key.startsWith('Arrow')) return; event.preventDefault(); const n = event.shiftKey ? 48 : 16; onMove(group, { x: event.key === 'ArrowLeft' ? -n : event.key === 'ArrowRight' ? n : 0, y: event.key === 'ArrowUp' ? -n : event.key === 'ArrowDown' ? n : 0 }); }}><GripHorizontal size={17} /></button>
      {editing ? <form onSubmit={event => { event.preventDefault(); void commit(); }}><input ref={input} aria-label="Stash name" value={name} disabled={busy} maxLength={120} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setEditing(false); setName(group.name.split('/').at(-1)!); } }} /><button type="submit" disabled={busy}>Save</button></form> : <><strong>{group.name.split('/').at(-1)}</strong><button type="button" aria-label={`Rename stash ${group.name}`} onClick={() => { setName(group.name.split('/').at(-1)!); setEditing(true); }}><Pencil size={14} /></button></>}
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="stash-tile__previews">
      {[...group.previewIds].reverse().filter(id => id !== group.topImageId && urls.get(id)).map((id, index) => <img key={id} src={urls.get(id)} alt="" style={{ '--preview-index': index } as React.CSSProperties} draggable={false} />)}
      {topImage ? <button type="button" className={`stash-tile__top${takingOut ? ' is-taking-out' : ''}`} aria-label={`Top image ${topImage.path.split('/').at(-1)} in stash ${group.name}`} title="Drag to take out · click to open stash" disabled={busy}
        data-stash-top-image={topImage.id}
        onPointerDown={event => {
          if (event.button !== 0 || busy) return; event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect(); event.currentTarget.setPointerCapture(event.pointerId);
          const thumbnail = event.currentTarget.querySelector('img');
          const ratio = thumbnail?.naturalWidth && thumbnail.naturalHeight ? thumbnail.naturalWidth / thumbnail.naturalHeight : 1;
          // The board uses a square frame; retain the grabbed point on the fitted image.
          const anchor = { x: .5 + ((event.clientX - rect.left) / rect.width - .5) * Math.min(1, ratio),
            y: .5 + ((event.clientY - rect.top) / rect.height - .5) * Math.min(1, 1 / ratio) };
          taking.current = { id: topImage.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, anchor, started: false };
        }}
        onPointerMove={event => {
          const current = taking.current; if (!current || current.pointerId !== event.pointerId) return;
          const point = { x: event.clientX, y: event.clientY };
          if (!current.started && Math.hypot(point.x - current.x, point.y - current.y) >= 5) { current.started = true; setTakingOut(true); onImageStart(current.id, point, current.anchor); }
          if (current.started) onImageMove(current.id, point);
        }}
        onPointerUp={event => {
          const current = taking.current; if (!current) return; taking.current = undefined; setTakingOut(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          if (current.started) { onImageDrop(current.id, group.id, { x: event.clientX, y: event.clientY }); onImageEnd(); }
          else onOpen(group.id);
        }} onPointerCancel={cancelImage} onLostPointerCapture={cancelImage}
        onClick={event => { if (event.detail === 0 && !(event.nativeEvent as PointerEvent).pointerType) onOpen(group.id); }}>
        {urls.get(topImage.id) ? <img src={urls.get(topImage.id)} alt="" draggable={false} /> : <span className="stash-tile__missing"><Folder size={32} /><small>{topImage.path.split('/').at(-1)}</small></span>}
      </button> : !group.previewIds.some(id => urls.get(id)) && <Folder size={42} />}
    </div>
    <button type="button" className="stash-tile__open" aria-label={`Open stash ${group.name}`} onClick={() => onOpen(group.id)} disabled={busy}>
      <span className="stash-tile__counts"><span><b>{group.directCount.toLocaleString()}</b> {group.directCount === 1 ? 'image' : 'images'} here{group.childCount > 0 && <small>{group.totalCount.toLocaleString()} including {group.childCount} sub-{group.childCount === 1 ? 'stash' : 'stashes'}</small>}</span><ArrowRight size={18} /></span>
    </button>
    {hoverId === group.id && <span className="stash-tile__drop">Release to move into stash</span>}
  </section>;
}
