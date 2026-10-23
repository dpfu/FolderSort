import * as React from 'react';
import { ChevronDown, ChevronRight, CircleHelp, Download, Folder, Pencil, ScanSearch, SlidersHorizontal } from 'lucide-react';
import ActionMenu from './ActionMenu';
import MenuBar from './MenuBar';
import { ActionButton, MenuItem } from './UiActions';
import UndoControl, { type UndoView } from './UndoControl';
import Modal from './Modal';
import ContentIndexBadge from './ContentIndexBadge';
import WorkspaceSelectionActions from './WorkspaceSelectionActions';
import { MIN_BOARD_ZOOM } from './stashView';
import type { LibraryCategory } from './libraryStore';

type Props = {
  projectName: string; current?: LibraryCategory; breadcrumbs: LibraryCategory[]; parent?: LibraryCategory;
  selectedCount: number; selectMode: boolean;
  busy: boolean; dragging: boolean; zoom: number; undo?: UndoView;
  clipEnabled: boolean; takeOutHover: string | null;
  status: string; error: string; similarity: React.ReactNode; exportActions: React.ReactNode;
  onBack: () => void; onSettings: () => void; onNavigate: (id: string | null) => void; onDeselect: () => void;
  onMove: () => void;
  onSelectMode: () => void; onCreate: () => void;
  onInspect: () => void; onZoom: (zoom: number) => void;
  onFit: () => void; onRename: (id: string, name: string) => Promise<void>;
};

function BoardZoomControls({ zoom, dragging, onZoom, onFit }: Pick<Props, 'zoom' | 'dragging' | 'onZoom' | 'onFit'>) {
  return <>
    <div className="workspace-zoom" role="group" aria-label="Board zoom">
      <ActionButton icon="zoomOut" label="Zoom out" disabled={dragging || zoom <= MIN_BOARD_ZOOM}
        onClick={() => onZoom(Math.max(MIN_BOARD_ZOOM, Math.round((zoom - .15) * 100) / 100))} />
      <span>{Math.round(zoom * 100)}%</span>
      <ActionButton icon="add" label="Zoom in" disabled={dragging || zoom >= 2}
        onClick={() => onZoom(Math.min(2, Math.round((zoom + .15) * 100) / 100))} />
    </div>
    <MenuItem icon="fit" label="Fit board" disabled={dragging} onClick={onFit} />
  </>;
}

export default function WorkspaceBar(props: Props) {
  const [page, setPage] = React.useState<'main' | 'view' | 'similar' | 'export' | 'help'>('main');
  const [rename, setRename] = React.useState(false), [name, setName] = React.useState(''), [renameError, setRenameError] = React.useState('');
  const selected = props.selectedCount > 0;
  React.useEffect(() => { if (props.error) setPage('main'); }, [props.error]);
  const disabled = props.busy || props.dragging;
  const titles = { main: 'Board actions', view: 'Board view', similar: 'Find similar', export: 'Export project', help: 'Help' };
  const subpage = (next: typeof page, icon: React.ReactNode, label: string) => <button type="button" className="action-menu__page-button" onClick={() => setPage(next)}>{icon}<span>{label}</span><ChevronRight size={15} /></button>;
  return <>
    <MenuBar label="Board menu bar" leading={<ActionButton className="workspace-project" title={`Back to project · ${props.projectName}`} icon="back" label="Back to project" onClick={props.onBack}><span>{props.projectName}</span></ActionButton>}
      context={<nav className="workspace-location" aria-label="Stash navigation">
        <span className="workspace-location__separator" aria-hidden="true">/</span>
        <button type="button" title="Root · Unsorted images and top-level stashes" className={`workspace-crumb${!props.current ? ' is-current' : ''}${props.takeOutHover === 'root' ? ' is-stash-exit-target' : ''}`}
          aria-label={props.current && !props.parent ? 'Back to overview' : 'Go to overview'} aria-current={!props.current ? 'page' : undefined}
          data-stash-parent={props.current ? 'root' : undefined} onClick={() => props.onNavigate(null)}>
          <span data-current-location={!props.current ? '' : undefined}>Root</span>
        </button>
        {props.breadcrumbs.filter(stash => stash.id !== props.current?.id).map(stash => <span className={`workspace-ancestor${stash.id === props.parent?.id ? ' is-parent' : ''}`} key={stash.id}>
          <span className="workspace-location__separator" aria-hidden="true">/</span>
          <button type="button" className={`workspace-crumb${props.takeOutHover === stash.id ? ' is-stash-exit-target' : ''}`} title={stash.name}
            aria-label={stash.id === props.parent?.id ? `Back to ${stash.name}` : `Go to ${stash.name}`}
            data-stash-parent={stash.id === props.parent?.id ? stash.id : undefined} onClick={() => props.onNavigate(stash.id)}>{stash.name.split('/').at(-1)}</button>
        </span>)}
        {props.current && <><span className="workspace-location__separator" aria-hidden="true">/</span><span className="workspace-current" data-current-location title={props.current.name} aria-current="page">{props.current.name.split('/').at(-1)}</span></>}
        {props.current && <ActionMenu label="Choose stash" align="left" className="workspace-location__menu" trigger={<ChevronDown size={15} />}>
          <p>{props.projectName}</p>
          <button type="button" className="action-menu__item" data-close-menu aria-label="Root" title="Unsorted images and top-level stashes" onClick={() => props.onNavigate(null)}><Folder size={18} /><span>Root<small>Unsorted images and top-level stashes</small></span></button>
          {props.breadcrumbs.map(stash => <button key={stash.id} type="button" className="action-menu__item" data-close-menu aria-current={stash.id === props.current?.id ? 'page' : undefined} onClick={() => props.onNavigate(stash.id)}><Folder size={18} /><span>{stash.name}</span></button>)}
        </ActionMenu>}
      </nav>}
      tools={<WorkspaceSelectionActions count={props.selectedCount} selectMode={props.selectMode} busy={props.busy} dragging={props.dragging}
        onSelectMode={props.onSelectMode} onDeselect={props.onDeselect} onMove={props.onMove} onCreate={props.onCreate} />}>
      <div className="workspace-index-slot"><ContentIndexBadge enabled={props.clipEnabled} activeOnly onOpen={props.onSettings} /></div>
      <ActionMenu label="Board zoom" className="workspace-zoom-menu" trigger={<><span>{Math.round(props.zoom * 100)}%</span><ChevronDown size={14} /></>}>
        <BoardZoomControls {...props} />
      </ActionMenu>
      <UndoControl action={props.undo} labelled />
      <ActionMenu label="Export project" icon="export" className="workspace-export" trigger={<><Download size={18} /><span>Export</span></>}>
        {props.exportActions}
      </ActionMenu>
      <ActionMenu label="Board actions" autoOpenRequest={props.error} className={`workspace-actions${props.error ? ' has-error' : ''}`} onOpenChange={open => { if (!open) setPage('main'); }}>
        {page !== 'main' && <div className="action-menu__page-heading"><ActionButton data-menu-autofocus icon="back" label="Back to board actions" onClick={() => setPage('main')} /><strong>{titles[page]}</strong></div>}
        {page === 'main' && <>
          {props.error && <p className="workspace-error" role="alert">{props.error}</p>}
          {selected ? <><h3>Selection</h3>
            <MenuItem icon={props.selectMode ? 'selected' : 'select'} label="Select multiple images" aria-pressed={props.selectMode} disabled={disabled} onClick={props.onSelectMode} />
            {props.selectedCount === 1 && <MenuItem icon="inspect" label="View image" disabled={disabled} onClick={props.onInspect} />}
          </> : <><h3>{props.current ? 'This stash' : 'Board'}</h3>
            {props.current && <button type="button" className="action-menu__item" data-close-menu disabled={disabled} onClick={() => { setName(props.current!.name.split('/').at(-1)!); setRenameError(''); setRename(true); }}><Pencil size={18} /><span>Rename stash</span></button>}</>}
          <div className="workspace-mobile-actions">{subpage('view', <SlidersHorizontal size={18} />, 'Board view')}</div>
          {subpage('similar', <ScanSearch size={18} />, 'Find similar to board')}
          <h3>Project</h3><div className="workspace-mobile-actions">{subpage('export', <Download size={18} />, 'Export project')}</div>
          <button type="button" className="action-menu__item" data-close-menu onClick={props.onSettings}><SlidersHorizontal size={18} /><span>Project settings</span></button>
          <MenuItem icon="back" label="Back to project" onClick={props.onBack} />
          <div className="workspace-index-mobile"><ContentIndexBadge enabled={props.clipEnabled} activeOnly labelled onOpen={props.onSettings} /></div>
          {subpage('help', <CircleHelp size={18} />, 'Help')}
        </>}
        {page === 'view' && <BoardZoomControls {...props} />}
        {page === 'similar' && props.similarity}
        {page === 'export' && props.exportActions}
        {page === 'help' && <div className="workspace-help">
          <p><b>Navigate</b> — pinch with two fingers to zoom and pan. Drag empty board space with one finger. Trackpad pinch also zooms the board.</p>
          <p><b>Browse</b> — filter all project images independently of the open stash.</p><p><b>Move</b> — adding or dropping images onto a board moves them into that folder. Double-tap to inspect.</p><p><b>Group</b> — hold one image over another, then release and name the stash.</p><p><b>Assign</b> — drop onto a named stash, or select and use the folder arrow.</p><p><b>Explore</b> — open a stash. Drag its top image out, or drop an image on the parent breadcrumb to move it there. Root holds unsorted images.</p><p>One image belongs to one stash. Stashes can contain images and sub-stashes.</p><p>Undo restores recent moves, stash changes and deletions in order. History ends on project switch or reload.</p>
        </div>}
      </ActionMenu>
      <span className="srOnly sorting-workspace__save-state">{props.busy ? "Saving" : "Saved"}</span><span className="srOnly" role="status" aria-live="polite">{props.status}</span>
    </MenuBar>
    {rename && props.current && <Modal label="Rename stash" className="stash-picker" onClose={() => setRename(false)}><form className="workspace-rename" onSubmit={event => {
      event.preventDefault(); if (!name.trim() || props.busy) return;
      void props.onRename(props.current!.id, [...props.current!.name.split('/').slice(0, -1), name.trim()].join('/')).then(() => setRename(false)).catch(error => setRenameError(error instanceof Error ? error.message : String(error)));
    }}><h2>Rename stash</h2><input data-modal-autofocus aria-label="Stash name" value={name} onChange={event => setName(event.target.value)} /><div><button type="button" onClick={() => setRename(false)}>Cancel</button><button type="submit" disabled={props.busy || !name.trim()}>Save</button></div>{renameError && <p role="alert">{renameError}</p>}</form></Modal>}
  </>;
}
