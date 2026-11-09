import * as React from 'react';
import { ChevronRight, Folder, FolderInput, FolderTree, LayoutDashboard, PanelRightClose } from 'lucide-react';
import { PointerSession } from './pointerSession';
import { useStableCallback } from './useStableCallback';
import { folderMoveProblem } from './folderNesting';
import { folderTree, visibleFolders } from './folderTree';
import { MAX_FOLDER_SIDEBAR_WIDTH, MIN_FOLDER_SIDEBAR_WIDTH, type FolderSidebarView } from './useFolderSidebar';
import type { LibraryCategory } from './libraryStore';
import './folder-sidebar.css';

type Point = { x: number; y: number };
type Props = {
  categories: LibraryCategory[]; currentId: string | null; view: FolderSidebarView;
  onView: React.Dispatch<React.SetStateAction<FolderSidebarView>>;
  busy: boolean; dragging: boolean; dragFolderId: string | null;
  onNavigate: (id: string | null) => Promise<void>; onRequestMove: (id: string) => void;
  onDrag: (id: string | null, point?: Point) => void;
  onDrop: (id: string, point: Point) => void;
};
type Hover = { id: string; error?: string };

export default function FolderSidebar(props: Props) {
  const { categories, currentId, view, onView, busy, dragging, dragFolderId } = props;
  const root = React.useRef<HTMLElement>(null), list = React.useRef<HTMLElement>(null), show = React.useRef<HTMLButtonElement>(null);
  const latest = React.useRef(props); latest.current = props;
  const expanded = React.useMemo(() => new Set(view.expanded), [view.expanded]);
  const roots = React.useMemo(() => folderTree(categories), [categories]);
  const rows = React.useMemo(() => visibleFolders(roots, expanded), [roots, expanded]);
  const [hover, setHover] = React.useState<Hover>();
  const hoverRef = React.useRef<Hover>();
  const timer = React.useRef<number>(), scrollFrame = React.useRef<number>(), lastPoint = React.useRef<Point>();
  const timerKey = React.useRef('');
  const [pointer] = React.useState(() => new PointerSession<{ id: string; start: Point; started: boolean }>());
  const [resize] = React.useState(() => new PointerSession<{ x: number; width: number }>());
  const [ghost, setGhost] = React.useState<{ id: string; point: Point }>();
  const skipClick = React.useRef(false);
  const navigationRequest = React.useRef(0);
  const currentPath = categories.find(folder => folder.id === currentId)?.name.toLocaleLowerCase();
  const currentVisible = rows.some(row => row.node.folder.id === currentId);
  React.useEffect(() => {
    if (!view.open || latest.current.dragging) return;
    const frame = requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('.folder-sidebar__name[aria-current="page"]')?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [view.open, currentId, currentPath, currentVisible]);
  const label = (id: string) => id === 'root' ? 'Staging' : categories.find(folder => folder.id === id)?.name.split('/').at(-1) || 'folder';
  const expand = useStableCallback((id: string) => onView(previous => previous.expanded.includes(id) ? previous : { ...previous, expanded: [...previous.expanded, id] }));
  const cancelHover = useStableCallback(() => {
    window.clearTimeout(timer.current); cancelAnimationFrame(scrollFrame.current!); timerKey.current = ''; lastPoint.current = undefined;
    hoverRef.current = undefined; setHover(undefined);
  });
  const updateHover = useStableCallback((point: Point) => {
    lastPoint.current = point;
    const aside = root.current, active = latest.current;
    if (!aside || !active.dragging || active.busy) return;
    const elements = document.elementsFromPoint(point.x, point.y);
    const inside = elements.some(element => aside.contains(element));
    const target = inside ? elements.map(element => element.closest<HTMLElement>('[data-sidebar-folder]')).find(Boolean) : undefined;
    const id = target?.dataset.sidebarFolder;
    const source = active.categories.find(folder => folder.id === active.dragFolderId);
    const destination = active.categories.find(folder => folder.id === id);
    const error = source && id ? folderMoveProblem(source, destination || null) : undefined;
    if (hoverRef.current?.id !== id || hoverRef.current?.error !== error) {
      const next = id ? { id, error } : undefined; hoverRef.current = next; setHover(next);
    }
    const key = inside && !active.view.open ? 'open' : id && !error && !active.view.expanded.includes(id) && active.categories.some(folder => folder.name.toLocaleLowerCase().startsWith((destination?.name.toLocaleLowerCase() || '\0') + '/')) ? id : '';
    if (key !== timerKey.current) {
      window.clearTimeout(timer.current); timerKey.current = key;
      if (key) timer.current = window.setTimeout(() => {
        timerKey.current = '';
        if (key === 'open') active.onView(previous => ({ ...previous, open: true })); else expand(key);
      }, key === 'open' ? 350 : 550);
    }
  });
  React.useEffect(() => {
    if (!dragging || busy) { cancelHover(); return; }
    const move = (event: PointerEvent) => updateHover({ x: event.clientX, y: event.clientY });
    const scroll = () => {
      const point = lastPoint.current, node = list.current, bounds = node?.getBoundingClientRect();
      if (point && node && bounds && point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom) {
        const delta = point.y < bounds.top + 28 ? -8 : point.y > bounds.bottom - 28 ? 8 : 0;
        if (delta) { node.scrollTop += delta; updateHover(point); }
      }
      scrollFrame.current = requestAnimationFrame(scroll);
    };
    document.addEventListener('pointermove', move, true); scrollFrame.current = requestAnimationFrame(scroll);
    return () => { document.removeEventListener('pointermove', move, true); cancelHover(); };
  }, [dragging, busy, updateHover, cancelHover]);
  const endDrag = useStableCallback(() => {
    const previous = pointer.cancel(); setGhost(undefined);
    if (previous?.started) { skipClick.current = true; latest.current.onDrag(null); }
    return previous;
  });
  React.useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (pointer.current) { event.preventDefault(); event.stopPropagation(); endDrag(); }
      const sizing = resize.cancel();
      if (sizing) { event.preventDefault(); event.stopPropagation(); latest.current.onView(previous => ({ ...previous, width: sizing.width })); }
    };
    const blur = () => { endDrag(); resize.cancel(); };
    window.addEventListener('keydown', escape, true); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', escape, true); window.removeEventListener('blur', blur); endDrag(); };
  }, [endDrag, pointer, resize]);
  React.useEffect(() => { if (busy) endDrag(); }, [busy, endDrag]);
  const toggle = () => {
    if (dragging) return;
    onView(previous => ({ ...previous, open: !previous.open }));
    requestAnimationFrame(() => (view.open ? show.current : root.current?.querySelector<HTMLButtonElement>('[data-collapse-sidebar]'))?.focus({ preventScroll: true }));
  };
  const navigate = async (id: string | null, keyboard: boolean) => {
    if (busy || dragging) return;
    const request = ++navigationRequest.current;
    await props.onNavigate(id);
    if (request !== navigationRequest.current || latest.current.currentId !== id) return;
    if (window.matchMedia('(max-width:700px)').matches) {
      onView(previous => ({ ...previous, open: false })); requestAnimationFrame(() => show.current?.focus({ preventScroll: true }));
    } else if (keyboard) requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>(`[data-sidebar-folder="${CSS.escape(id || 'root')}"] .folder-sidebar__name`)?.focus({ preventScroll: true }));
  };
  const rowClass = (id: string) => `folder-sidebar__row${currentId === (id === 'root' ? null : id) ? ' is-current' : ''}${hover?.id === id ? hover.error ? ' is-invalid-target' : ' is-drop-target' : ''}${dragFolderId === id ? ' is-drag-source' : ''}`;
  const rowAttributes = (id: string) => ({ 'data-sidebar-folder': id, 'data-folder-destination': id });
  return <aside ref={root} className={`folder-sidebar${view.open ? ' is-open' : ''}`} aria-label="Folders">
    <div className="folder-sidebar__rail" hidden={view.open}>
      <button ref={show} type="button" aria-label="Show folders" title="Show folders" aria-expanded={view.open} aria-controls="folder-sidebar-panel" onClick={toggle}><FolderTree size={19} /></button>
      <span aria-hidden="true">{categories.length.toLocaleString()}</span>
    </div>
    <div className="folder-sidebar__panel" id="folder-sidebar-panel" hidden={!view.open}>
      <button type="button" className="folder-sidebar__resize" role="separator" aria-label="Resize folders sidebar" aria-orientation="vertical" aria-valuemin={MIN_FOLDER_SIDEBAR_WIDTH} aria-valuemax={MAX_FOLDER_SIDEBAR_WIDTH} aria-valuenow={view.width}
        onPointerDown={event => { if (event.button !== 0 || dragging) return; event.preventDefault(); resize.begin(event.pointerId, { x: event.clientX, width: view.width }); event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { const start = resize.read(event.pointerId); if (start) onView(previous => ({ ...previous, width: Math.max(MIN_FOLDER_SIDEBAR_WIDTH, Math.min(MAX_FOLDER_SIDEBAR_WIDTH, Math.round(start.width + start.x - event.clientX))) })); }}
        onPointerUp={event => resize.finish(event.pointerId)} onPointerCancel={event => resize.finish(event.pointerId)} onLostPointerCapture={event => resize.finish(event.pointerId)}
        onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); onView(previous => ({ ...previous, width: Math.max(MIN_FOLDER_SIDEBAR_WIDTH, Math.min(MAX_FOLDER_SIDEBAR_WIDTH, previous.width + (event.key === 'ArrowLeft' ? 10 : -10))) })); }} />
      <header><strong>Folders</strong><button data-collapse-sidebar type="button" aria-label="Hide folders" title="Hide folders" aria-expanded={view.open} onClick={toggle}><PanelRightClose size={18} /></button></header>
      <div className="folder-sidebar__staging"><div className={rowClass('root')} {...rowAttributes('root')}>
        <button type="button" className="folder-sidebar__name" aria-current={currentId === null ? 'page' : undefined} disabled={busy} onClick={event => void navigate(null, event.detail === 0)}><LayoutDashboard size={17} /><span>Staging</span></button>
      </div></div>
      <nav className="folder-sidebar__tree" aria-label="Folder hierarchy" ref={list}>
        {!rows.length && <p className="folder-sidebar__empty">No folders yet</p>}
        {rows.map(({ node, depth }) => {
          const folder = node.folder, path = folder.name.toLocaleLowerCase();
          return <div key={folder.id} className={rowClass(folder.id)} style={{ '--folder-depth': depth } as React.CSSProperties} {...rowAttributes(folder.id)}>
            {node.children.length ? <button type="button" className="folder-sidebar__expand" aria-label={`${expanded.has(folder.id) ? 'Collapse' : 'Expand'} folder ${folder.name}`} aria-expanded={expanded.has(folder.id)} disabled={busy}
              onClick={() => { if (!dragging) onView(previous => ({ ...previous, expanded: expanded.has(folder.id) ? previous.expanded.filter(id => id !== folder.id) : [...previous.expanded, folder.id] })); }}><ChevronRight size={14} /></button> : <span className="folder-sidebar__indent" />}
            <button type="button" className={`folder-sidebar__name${currentPath?.startsWith(path + '/') ? ' is-ancestor' : ''}`} aria-label={`Open folder ${folder.name}`} title={folder.name} aria-current={currentId === folder.id ? 'page' : undefined} disabled={busy}
              onClick={event => { if (skipClick.current && event.detail > 0) { skipClick.current = false; return; } void navigate(folder.id, event.detail === 0); }}
              onPointerDown={event => { if (event.button !== 0 || busy || dragging) return; event.stopPropagation(); skipClick.current = false; event.currentTarget.focus({ preventScroll: true }); pointer.begin(event.pointerId, { id: folder.id, start: { x: event.clientX, y: event.clientY }, started: false }); event.currentTarget.setPointerCapture(event.pointerId); }}
              onPointerMove={event => { const active = pointer.read(event.pointerId); if (!active) return; const point = { x: event.clientX, y: event.clientY }; if (!active.started && Math.hypot(point.x - active.start.x, point.y - active.start.y) < 5) return; active.started = true; setGhost({ id: active.id, point }); props.onDrag(active.id, point); }}
              onPointerUp={event => { const active = pointer.finish(event.pointerId); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (!active?.started) return; skipClick.current = true; setGhost(undefined); props.onDrag(null); props.onDrop(active.id, { x: event.clientX, y: event.clientY }); }}
              onPointerCancel={event => { if (pointer.read(event.pointerId)) endDrag(); }} onLostPointerCapture={event => { if (pointer.read(event.pointerId)) endDrag(); }}>
              <Folder size={16} /><span>{folder.name.split('/').at(-1)}</span>
            </button>
            <button type="button" className="folder-sidebar__move" aria-label={`Move folder ${folder.name}`} title="Move folder…" disabled={busy || dragging} onClick={() => props.onRequestMove(folder.id)}><FolderInput size={16} /></button>
          </div>;
        })}
      </nav>
      {dragging && hover && <p className={`folder-sidebar__drop-status${hover.error ? ' has-error' : ''}`} role="status">{hover.error || `Move ${dragFolderId ? '“' + label(dragFolderId) + '”' : 'images'} ${hover.id === 'root' ? 'to' : 'into'} ${label(hover.id)}`}</p>}
    </div>
    {ghost && <div className="folder-sidebar__ghost" aria-hidden="true" style={{ left: ghost.point.x + 12, top: ghost.point.y - 18 }}><Folder size={18} /><span>{label(ghost.id)}</span></div>}
  </aside>;
}
