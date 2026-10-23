import { ActionButton } from './UiActions';

/** Selection swaps actions in one reserved slot; navigation and utilities stay put. */
export default function WorkspaceSelectionActions({ count, selectMode, busy, dragging, onSelectMode, onDeselect, onMove, onCreate }: {
  count: number; selectMode: boolean; busy: boolean; dragging: boolean;
  onSelectMode: () => void; onDeselect: () => void; onMove: () => void; onCreate: () => void;
}) {
  const selected = count > 0;
  const createLabel = selected ? `Stash ${count.toLocaleString()} ${count === 1 ? 'image' : 'images'}` : 'Create stash';
  return <div className="workspace-selection" role="group" aria-label="Image actions">
    {selected ? <>
      <span className="workspace-selection__count" title={`${count.toLocaleString()} selected`}>
        {count.toLocaleString()}<span className="workspace-action-label"> selected</span>
      </span>
      <ActionButton key="move" icon="moveToStash" label="Move to stash…" className="workspace-selection__move" disabled={busy || dragging} onClick={onMove}>
        <span className="workspace-action-label">Move to stash…</span>
      </ActionButton>
    </> : <ActionButton key="select" icon={selectMode ? 'selected' : 'select'} label="Select multiple images" className="workspace-selection__select"
      title="Select images · Drag a box on the board" aria-pressed={selectMode} disabled={busy || dragging} onClick={onSelectMode}>
      <span className="workspace-action-label">Select</span>
    </ActionButton>}
    <ActionButton key="create" icon="createStash" label={createLabel} className={`workspace-selection__create${selected ? ' is-primary' : ''}`}
      disabled={busy || dragging} onClick={onCreate}>
      <span className="workspace-action-label">{selected ? createLabel : 'New stash'}</span>
    </ActionButton>
    {selected && <ActionButton key="deselect" icon="close" label="Deselect images" disabled={dragging} onClick={onDeselect} />}
  </div>;
}
