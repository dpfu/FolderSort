import * as React from 'react';
import { ArrowRight, Folder, GripHorizontal, Pencil } from 'lucide-react';
import { categoryColor } from './categoryTree';
import type { BoardPoint } from './categoryBoard';
import type { StashTile } from './stashBoard';

export default function StashBoardLayer({ groups, urls, zoom, busy, hoverId, pulseId, editingId, onOpen, onMove, onPreviewMove, onCancelMove, onRename }: {
  groups: StashTile[]; urls: Map<string, string>; zoom: number; busy: boolean; hoverId: string | null; pulseId: string | null; editingId: string | null;
  onOpen: (id: string) => void; onMove: (group: StashTile, delta: BoardPoint) => void;
  onPreviewMove: (group: StashTile, delta: BoardPoint) => void; onCancelMove: () => void; onRename: (id: string, name: string) => Promise<void>;
}) {
  return <div className="stash-board">{groups.map(group => <Stash key={group.id} {...{ group, urls, zoom, busy, hoverId, pulseId, editingId, onOpen, onMove, onPreviewMove, onCancelMove, onRename }} />)}</div>;
}

function Stash({ group, urls, zoom, busy, hoverId, pulseId, editingId, onOpen, onMove, onPreviewMove, onCancelMove, onRename }: Omit<Parameters<typeof StashBoardLayer>[0], 'groups'> & { group: StashTile }) {
  const [editing, setEditing] = React.useState(editingId === group.id);
  const [name, setName] = React.useState(group.name.split('/').at(-1)!);
  const [error, setError] = React.useState('');
  const drag = React.useRef<{ pointerId: number; x: number; y: number; delta: BoardPoint }>();
  const input = React.useRef<HTMLInputElement>(null);
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
    <button type="button" className="stash-tile__open" aria-label={`Open stash ${group.name}`} onClick={() => onOpen(group.id)} disabled={busy}>
      <span className="stash-tile__previews" aria-hidden="true">{group.previewIds.length ? group.previewIds.map((id, index) => <img key={id} src={urls.get(id)} alt="" style={{ '--preview-index': index } as React.CSSProperties} draggable={false} />) : <Folder size={42} />}</span>
      <span className="stash-tile__counts"><span><b>{group.directCount.toLocaleString()}</b> {group.directCount === 1 ? 'image' : 'images'} here{group.childCount > 0 && <small>{group.totalCount.toLocaleString()} including {group.childCount} sub-{group.childCount === 1 ? 'stash' : 'stashes'}</small>}</span><ArrowRight size={18} /></span>
    </button>
    {hoverId === group.id && <span className="stash-tile__drop">Release to move into stash</span>}
  </section>;
}
