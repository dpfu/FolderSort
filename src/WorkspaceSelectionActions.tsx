import { ActionButton } from './UiActions';

/** Selection swaps actions in one reserved slot; navigation and utilities stay put. */
export default function WorkspaceSelectionActions({ count, selectMode, busy, dragging, onSelectMode, onDeselect, onMove, onCreate, removal }: {
  count: number; selectMode: boolean; busy: boolean; dragging: boolean;
  onSelectMode: () => void; onDeselect: () => void; onMove: () => void; onCreate: () => void;
  removal?: { label: string; onRemove: () => void };
}) {
  const selected = count > 0;
  const createLabel = selected ? `Create folder with ${count.toLocaleString()} ${count === 1 ? 'image' : 'images'}` : 'Create folder';
  return <div className={`workspace-selection${selected ? ' is-selected' : ''}`} role="group" aria-label="Image actions">
    {selected ? <>
      <span className="workspace-selection__count" title={`${count.toLocaleString()} selected`}>
        {count.toLocaleString()}<span className="workspace-selection__suffix"> selected</span>
      </span>
      <ActionButton key="move" icon="moveToStash" label="Move to folder…" className="workspace-selection__move" disabled={busy || dragging} onClick={onMove}>
        <span className="workspace-action-label workspace-action-full">Move to folder…</span><span className="workspace-action-label workspace-action-short">Move…</span>
      </ActionButton>
    </> : <ActionButton key="select" icon={selectMode ? 'selected' : 'select'} label="Select multiple images" className="workspace-selection__select"
      title="Select images · Drag a box on the board" aria-pressed={selectMode} disabled={busy || dragging} onClick={onSelectMode}>
      <span className="workspace-action-label">Select</span>
    </ActionButton>}
    <ActionButton key="create" icon="createStash" label={createLabel} className="workspace-selection__create"
      disabled={busy || dragging} onClick={onCreate}>
      <span className="workspace-action-label">New folder</span>
    </ActionButton>
    {selected && removal && <ActionButton key="remove" icon="removeImage" label={removal.label} title={`${removal.label} · Return to the unsorted waiting queue`}
      className="workspace-selection__remove" disabled={busy || dragging} onClick={removal.onRemove}>
      <span className="workspace-action-label workspace-action-full">{removal.label}</span><span className="workspace-action-label workspace-action-short">Remove</span>
    </ActionButton>}
    {selected && <ActionButton key="deselect" icon="close" label="Deselect images" disabled={dragging} onClick={onDeselect} />}
  </div>;
}
