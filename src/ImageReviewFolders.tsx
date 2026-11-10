import * as React from 'react';
import { ChevronRight, Folder, FolderOpen, FolderPlus, Layers, PanelRightClose, Plus, Search } from 'lucide-react';
import { folderAncestors, folderTree, visibleFolders, type FolderTreeNode } from './folderTree';
import { parentPath } from './stashGeometry';
import { displayReviewKey, reviewDestinationKey, reviewKey, type ImageReviewPreferences } from './imageReviewPreferences';
import type { LibraryCategory, LibraryImage } from './libraryStore';

type Props = {
  image: LibraryImage; images: LibraryImage[]; categories: LibraryCategory[]; busy: boolean;
  preferences: ImageReviewPreferences; onPreferences: (change: (previous: ImageReviewPreferences) => ImageReviewPreferences) => void;
  onAssign: (id: string | null) => void; onCreate: (name: string) => Promise<boolean>; onHide: () => void;
  onShortcut: (destination: string, key?: string) => void; feedback?: string;
};
type Editing = { destination: string; message: string };
const hint = 'Press a key · Esc to clear';

/** Destination buttons move only the reviewed image; caret and key buttons never move it. */
export default function ImageReviewFolders({ image, images, categories, busy, preferences, onPreferences, onAssign, onCreate, onHide, onShortcut, feedback }: Props) {
  const root = React.useRef<HTMLElement>(null);
  const [query, setQuery] = React.useState(''), [searchCollapsed, setSearchCollapsed] = React.useState<string[]>([]);
  const [creating, setCreating] = React.useState(false), [name, setName] = React.useState('');
  const [editing, setEditing] = React.useState<Editing>();
  const [hintPosition, setHintPosition] = React.useState({ left: 0, top: 0 });
  const roots = React.useMemo(() => folderTree(categories), [categories]);
  const search = query.trim().toLocaleLowerCase();
  const matchingRoots = React.useMemo(() => {
    const filter = (nodes: FolderTreeNode[]): FolderTreeNode[] => nodes.flatMap(node => {
      const children = filter(node.children);
      return node.folder.name.toLocaleLowerCase().includes(search) || children.length ? [{ ...node, children }] : [];
    });
    return search ? filter(roots) : roots;
  }, [roots, search]);
  const expanded = React.useMemo(() => new Set(search ? categories.filter(folder => !searchCollapsed.includes(folder.id)).map(folder => folder.id) : preferences.expanded), [search, searchCollapsed, categories, preferences.expanded]);
  const rows = React.useMemo(() => visibleFolders(matchingRoots, expanded), [matchingRoots, expanded]);
  const counts = React.useMemo(() => {
    const result = new Map<string | null, number>();
    for (const item of images) if (item.categoryId !== null || item.rootOnBoard !== false) result.set(item.categoryId, (result.get(item.categoryId) || 0) + 1);
    return result;
  }, [images]);
  const currentId = image.categoryId === null && image.rootOnBoard === false ? undefined : image.categoryId;
  const currentPath = categories.find(folder => folder.id === currentId)?.name;
  React.useEffect(() => {
    const parents = folderAncestors(categories, currentId || null).filter(id => id !== currentId);
    if (parents.some(id => !preferences.expanded.includes(id))) onPreferences(previous => ({ ...previous, expanded: [...new Set([...previous.expanded, ...parents])] }));
  }, [currentId, currentPath]); // Only reveal the active path when location changes, not on each collapse.
  React.useEffect(() => { if (busy) setEditing(undefined); }, [busy]);
  React.useEffect(() => {
    if (!editing) return;
    const cancel = () => setEditing(undefined);
    const outside = (event: PointerEvent) => { if (!(event.target instanceof Element) || event.target.closest('[data-review-shortcut]')?.getAttribute('data-review-shortcut') !== editing.destination) cancel(); };
    document.addEventListener('pointerdown', outside, true); window.addEventListener('blur', cancel); window.addEventListener('resize', cancel);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); };
  }, [editing?.destination]);
  React.useLayoutEffect(() => {
    if (!editing) return;
    const button = root.current?.querySelector<HTMLElement>(`[data-review-shortcut="${CSS.escape(editing.destination)}"]`);
    if (!button) { setEditing(undefined); return; }
    const box = button.getBoundingClientRect();
    setHintPosition({ left: Math.max(8, Math.min(window.innerWidth - 254, box.right - 246)), top: Math.max(8, Math.min(window.innerHeight - 80, box.bottom + 6)) });
  }, [editing?.destination, editing?.message]);
  const toggle = (id: string) => {
    if (search) setSearchCollapsed(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
    else onPreferences(previous => ({ ...previous, expanded: previous.expanded.includes(id) ? previous.expanded.filter(value => value !== id) : [...previous.expanded, id] }));
  };
  const focusDestination = (key: string) => root.current?.querySelector<HTMLButtonElement>(`[data-review-destination="${CSS.escape(key)}"]`)?.focus();
  const treeKey = (event: React.KeyboardEvent, id: string | null) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const destinations = [...root.current!.querySelectorAll<HTMLButtonElement>('[data-review-destination]')], key = reviewDestinationKey(id);
    const index = destinations.findIndex(button => button.dataset.reviewDestination === key);
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') destinations[Math.max(0, Math.min(destinations.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    if (event.key === 'Home') destinations[0]?.focus();
    if (event.key === 'End') destinations.at(-1)?.focus();
    const row = rows.find(item => item.node.folder.id === id);
    if (event.key === 'ArrowRight' && row?.node.children.length) {
      if (!expanded.has(id!)) toggle(id!); else focusDestination(reviewDestinationKey(row.node.children[0].folder.id));
    }
    if (event.key === 'ArrowLeft' && id) {
      if (row?.node.children.length && expanded.has(id)) toggle(id);
      else { const folder = categories.find(folder => folder.id === id), parent = categories.find(candidate => candidate.name.toLocaleLowerCase() === parentPath(folder?.name || '').toLocaleLowerCase()); if (parent) focusDestination(reviewDestinationKey(parent.id)); }
    }
  };
  const shortcutKey = (event: React.KeyboardEvent<HTMLButtonElement>, destination: string) => {
    if (editing?.destination !== destination) return;
    if (event.key === 'Tab') { setEditing(undefined); return; }
    if (event.nativeEvent.isComposing) { event.stopPropagation(); return; }
    // Keep browser commands intact; do not let the project's Undo consume capture keys.
    if (event.metaKey || event.ctrlKey || event.altKey || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) { event.stopPropagation(); return; }
    event.preventDefault(); event.stopPropagation();
    if (event.repeat) return;
    if (event.key === 'Escape') { onShortcut(destination); setEditing(undefined); return; }
    const key = reviewKey(event.key);
    if (!key) { setEditing({ destination, message: 'Use a letter, number or symbol · Esc to clear' }); return; }
    const owner = Object.entries(preferences.shortcuts).find(([id, value]) => id !== destination && value === key && (id === 'staging' || categories.some(folder => reviewDestinationKey(folder.id) === id)));
    if (owner) {
      const name = owner[0] === 'staging' ? 'Staging' : categories.find(folder => reviewDestinationKey(folder.id) === owner[0])!.name;
      setEditing({ destination, message: `${displayReviewKey(key)} is used by ${name}. Try another key.` }); return;
    }
    onShortcut(destination, key); setEditing(undefined);
  };
  const row = (id: string | null, name: string, depth: number, children: boolean) => {
    const destination = reviewDestinationKey(id), key = preferences.shortcuts[destination], active = currentId === id, count = counts.get(id) || 0;
    const shortName = name.split('/').at(-1)!;
    return <div key={destination} className={`image-review-folders__row${active ? ' is-current' : ''}${feedback === destination ? ' is-feedback' : ''}`} data-review-folder={destination} style={{ '--review-depth': depth } as React.CSSProperties}>
      {children ? <button type="button" className="image-review-folders__expand" aria-label={`${expanded.has(id!) ? 'Collapse' : 'Expand'} folder ${name}`} aria-expanded={expanded.has(id!)} onClick={() => toggle(id!)} onKeyDown={event => treeKey(event, id)}><ChevronRight size={14} /></button> : <span className="image-review-folders__indent" />}
      <button type="button" className="image-review-folders__destination" data-review-destination={destination} aria-label={`${active ? 'Current folder:' : 'Move image to'} ${name}`} aria-disabled={active || busy} title={`${name} · ${count.toLocaleString()} ${count === 1 ? 'image' : 'images'} directly here${key ? ` · Shortcut ${displayReviewKey(key)}` : ''}`} aria-keyshortcuts={key && /^[a-z0-9]$/.test(key) ? key : undefined}
        onClick={() => { if (!active && !busy) onAssign(id); }} onKeyDown={event => treeKey(event, id)}>
        {id === null ? <Layers size={17} /> : active ? <FolderOpen size={17} /> : <Folder size={17} />}<span>{shortName}</span>
      </button>
      <span className="image-review-folders__count" aria-hidden="true">{count.toLocaleString()}</span>
      <button type="button" className="image-review-folders__shortcut" data-review-shortcut={destination} aria-label={`${key ? 'Change' : 'Set'} shortcut for ${name}${key ? `, currently ${displayReviewKey(key)}` : ''}`} title={`${key ? 'Change' : 'Set'} shortcut for ${shortName}`} aria-pressed={editing?.destination === destination} aria-describedby={editing?.destination === destination ? 'image-review-shortcut-help' : undefined} aria-disabled={busy}
        onClick={event => { if (!busy) { event.currentTarget.focus({ preventScroll: true }); setEditing(previous => previous?.destination === destination ? undefined : { destination, message: hint }); } }} onBlur={() => setEditing(undefined)} onKeyDown={event => shortcutKey(event, destination)}>
        {key ? <kbd className="image-review-key"><span>{displayReviewKey(key)}</span></kbd> : <span className="image-review-add-key" aria-hidden="true"><Plus size={12} /></span>}
      </button>
    </div>;
  };
  return <aside className="image-review-folders" aria-label="Move image to a folder" ref={root}>
    <header><strong>Move to folder</strong><button type="button" aria-label="Hide folders" title="Hide folders" onClick={onHide}><PanelRightClose size={18} /></button></header>
    <label className="image-review-folders__search"><Search size={16} /><input type="search" aria-label="Search folders" placeholder="Find a folder" value={query} onChange={event => { setQuery(event.target.value); setSearchCollapsed([]); }} /></label>
    <div className="image-review-folders__columns" aria-hidden="true"><span>Folder</span><span title="Images directly in each folder">Images</span><span>Key</span></div>
    <nav className="image-review-folders__tree" aria-label="Folder destinations" onScroll={() => setEditing(undefined)}>
      {(!search || 'staging'.includes(search)) && <div className="image-review-folders__staging">{row(null, 'Staging', 0, false)}</div>}
      {rows.map(({ node, depth }) => row(node.folder.id, node.folder.name, depth, node.children.length > 0))}
      {!!search && !rows.length && !'staging'.includes(search) && <p role="status">No matching folders</p>}
      {!categories.length && !search && <p>No folders yet</p>}
    </nav>
    <div className="image-review-folders__bottom">
      {!creating ? <button type="button" className="image-review-folders__new" disabled={busy} onClick={() => setCreating(true)}><FolderPlus size={17} /><span>New folder</span></button> : <form onSubmit={event => { event.preventDefault(); if (name.trim() && !busy) void onCreate(name.trim()).then(done => { if (done) { setCreating(false); setName(''); } }); }}>
        <input type="text" aria-label="New folder name" autoFocus placeholder="Folder name" value={name} onChange={event => setName(event.target.value)} disabled={busy} required />
        <div><button type="button" disabled={busy} onClick={() => { setCreating(false); setName(''); }}>Cancel</button><button type="submit" className="image-review-folders__create" disabled={busy || !name.trim()}>Create & move</button></div>
      </form>}
    </div>
    {editing && <div className="image-review-folders__hint" id="image-review-shortcut-help" role="status" aria-live="polite" style={hintPosition}>{editing.message}</div>}
  </aside>;
}
