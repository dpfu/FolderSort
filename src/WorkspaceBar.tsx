import * as React from 'react';
import { ChevronDown, ChevronRight, CircleHelp, Download, Folder, Pencil, ScanSearch, SlidersHorizontal } from 'lucide-react';
import ActionMenu from './ActionMenu';
import MenuBar from './MenuBar';
import { ActionButton, MenuItem } from './UiActions';
import UndoControl, { type UndoView } from './UndoControl';
import Modal from './Modal';
import ContentIndexBadge from './ContentIndexBadge';
import { MIN_BOARD_ZOOM } from './stashView';
import type { LibraryCategory } from './libraryStore';
import './workspace-shell.css';

type Props = {
  current?: LibraryCategory; breadcrumbs: LibraryCategory[]; parent?: LibraryCategory; directCount: number;
  selectedCount: number; selectionOrigin?: string; selectMode: boolean; allOnBoard: boolean; canMoveHere: boolean;
  busy: boolean; dragging: boolean; boardCount: number; sortedCount: number; zoom: number; undo?: UndoView;
  clipEnabled: boolean; takeOutHover: boolean;
  status: string; error: string; processing: React.ReactNode; similarity: React.ReactNode; exportActions: React.ReactNode;
  onBack: () => void; onSettings: () => void; onNavigate: (id: string | null) => void; onSelectMode: () => void; onDeselect: () => void;
  onCreate: () => void; onMove: () => void; onMoveHere: () => void; onReturn: () => void; onAdd: () => void;
  onInspect: () => void; onClear: () => void; onClearSorted: () => void; onZoom: (zoom: number) => void;
  onFit: () => void; onRename: (id: string, name: string) => Promise<void>;
};

export default function WorkspaceBar(props: Props) {
  const [page, setPage] = React.useState<'main' | 'view' | 'similar' | 'export' | 'status' | 'help'>('main');
  const [rename, setRename] = React.useState(false), [name, setName] = React.useState(''), [renameError, setRenameError] = React.useState('');
  const selected = props.selectedCount > 0;
  React.useEffect(() => { if (props.error) setPage('status'); }, [props.error]);
  const disabled = props.busy || props.dragging;
  const titles = { main: 'Board actions', view: 'Board view', similar: 'Find similar', export: 'Export project', status: 'Activity', help: 'Help' };
  const subpage = (next: typeof page, icon: React.ReactNode, label: string) => <button type="button" className="action-menu__page-button" onClick={() => setPage(next)}>{icon}<span>{label}</span><ChevronRight size={15} /></button>;
  return <>
    <MenuBar label="Board menu bar" leading={<ActionButton data-stash-parent={props.current ? props.parent?.id || "root" : undefined} className={props.takeOutHover ? "is-stash-exit-target" : ""} title={props.dragging && props.current ? `Drop to move to ${props.parent?.name || "overview"}` : undefined} icon="back" label={props.current ? `Back to ${props.parent?.name || 'overview'}` : 'Back to project'} onClick={props.current ? () => props.onNavigate(props.parent?.id || null) : props.onBack} />}
      context={<nav className="workspace-location" aria-label="Stash navigation">
        <ActionMenu label="Choose stash" align="left" className="workspace-location__menu" trigger={<><div><strong data-current-location>{props.current?.name.split('/').at(-1) || 'Overview'}</strong><small>{props.directCount.toLocaleString()}</small></div><ChevronDown size={14} /></>}>
          <MenuItem icon="back" label="Project" aria-label="Back to project" onClick={props.onBack} />
          <button type="button" className="action-menu__item" data-close-menu aria-current={!props.current ? 'page' : undefined} onClick={() => props.onNavigate(null)}><Folder size={18} /><span>Overview</span></button>
          {props.breadcrumbs.map(stash => <button key={stash.id} type="button" className="action-menu__item" data-close-menu aria-current={stash.id === props.current?.id ? 'page' : undefined} onClick={() => props.onNavigate(stash.id)}><Folder size={18} /><span>{stash.name}</span></button>)}
        </ActionMenu>
      </nav>}>
      {selected ? <>
        <ActionButton icon="moveToStash" label="Move to stash…" disabled={disabled} onClick={props.onMove} />
        <ActionButton icon="close" className="workspace-deselect" label="Deselect images" title={`${props.selectedCount} selected · Deselect`} disabled={props.dragging} onClick={props.onDeselect} />
      </> : <ActionButton icon={props.selectMode ? 'selected' : 'select'} label="Select multiple images" aria-pressed={props.selectMode} onClick={props.onSelectMode} />}
      <ActionButton icon="createStash" className="workspace-primary" label="Create stash" disabled={disabled} onClick={props.onCreate}><span>Create stash</span></ActionButton>
      <ActionButton icon="fit" className="workspace-fit" label="Fit board" disabled={props.dragging} onClick={props.onFit} />
      {!selected && <ContentIndexBadge enabled={props.clipEnabled} onOpen={props.onSettings} />}
      <UndoControl action={props.undo} />
      <ActionMenu label="Board actions" autoOpenRequest={props.error} className={`workspace-actions${props.error ? ' has-error' : ''}`} onOpenChange={open => { if (!open) setPage('main'); }}>
        {page !== 'main' && <div className="action-menu__page-heading"><ActionButton icon="back" label="Back to board actions" onClick={() => setPage('main')} /><strong>{titles[page]}</strong></div>}
        {page === 'main' && <>
          {props.error && <p className="workspace-error" role="alert">{props.error}</p>}
          {selected ? <><h3>Selection</h3>
            <MenuItem icon="close" label={`Deselect ${props.selectedCount} images`} onClick={props.onDeselect} />
            {props.selectedCount === 1 && <MenuItem icon="inspect" label="View image" disabled={disabled} onClick={props.onInspect} />}
            {props.canMoveHere && <MenuItem icon="moveToStash" label="Move into this stash" disabled={disabled} onClick={props.onMoveHere} />}
            {props.allOnBoard ? <MenuItem icon="returnToPile" label="Remove from board" aria-label="Remove selected images from board" title="Keep images and stash membership" disabled={disabled} onClick={props.onReturn} />
              : <MenuItem icon="add" label="Add to board" disabled={disabled} onClick={props.onAdd} />}
          </> : <><h3>{props.current ? 'This stash' : 'Board'}</h3>
            {props.current && <button type="button" className="action-menu__item" data-close-menu disabled={disabled} onClick={() => { setName(props.current!.name.split('/').at(-1)!); setRenameError(''); setRename(true); }}><Pencil size={18} /><span>Rename stash</span></button>}</>}
          {subpage('view', <SlidersHorizontal size={18} />, 'Board view')}
          {subpage('similar', <ScanSearch size={18} />, 'Find similar to board')}
          {props.sortedCount > 0 && props.sortedCount < props.boardCount && <MenuItem icon="returnToPile" label="Clear sorted images" title="Remove assigned images from this board; keep images and stashes" disabled={disabled} onClick={props.onClearSorted} />}
          <MenuItem icon="clearBoard" label="Clear board" title="Remove loose images from this board; keep images and stashes" disabled={!props.boardCount || disabled} onClick={props.onClear} />
          <h3>Project</h3>{subpage('export', <Download size={18} />, 'Export project')}
          <button type="button" className="action-menu__item" data-close-menu onClick={props.onSettings}><SlidersHorizontal size={18} /><span>Project settings</span></button>
          <MenuItem icon="back" label="Back to project" onClick={props.onBack} />
          {subpage('status', <span className={`workspace-status-dot${props.error ? ' is-error' : ''}`} />, 'Activity')}
          {subpage('help', <CircleHelp size={18} />, 'Help')}
        </>}
        {page === 'view' && <><MenuItem icon="fit" label="Fit all images and stashes" onClick={props.onFit} /><div className="workspace-zoom" role="group" aria-label="Board zoom">
          <ActionButton icon="zoomOut" label="Zoom out" onClick={() => props.onZoom(Math.max(MIN_BOARD_ZOOM, Math.round((props.zoom - .15) * 100) / 100))} />
          <strong>{Math.round(props.zoom * 100)}%</strong><ActionButton icon="add" label="Zoom in" onClick={() => props.onZoom(Math.min(2, Math.round((props.zoom + .15) * 100) / 100))} />
        </div></>}
        {page === 'similar' && props.similarity}
        {page === 'export' && props.exportActions}
        {page === 'status' && <><p role={props.error ? 'alert' : 'status'}>{props.error || props.status || 'Saved locally'}</p>{props.processing}{props.undo && <p>{props.undo.message}</p>}</>}
        {page === 'help' && <div className="workspace-help">
          <p><b>Browse</b> — filter all project images independently of the open stash.</p><p><b>Arrange</b> — drag onto the board to compare. Double-tap to inspect.</p><p><b>Group</b> — hold one image over another, then release and name the stash.</p><p><b>Assign</b> — drop onto a named stash, or select and use the folder arrow.</p><p><b>Explore</b> — open a stash. Drag its top image out, or drop an image on Back to move it to the parent.</p><p>One image belongs to one stash. Stashes can contain images and sub-stashes.</p><p>Undo restores recent moves, stash changes, clears and deletions in order. History ends on project switch or reload.</p>
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
