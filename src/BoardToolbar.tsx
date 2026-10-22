import { ActionButton } from './UiActions';
import { MIN_BOARD_ZOOM } from './stashView';

export default function BoardToolbar({ title, selected, selectMode, busy, dragging, zoom, onSelectMode, onDeselect, onMove, onCreate, onZoom, onFit }: {
  title: string; selected: number; selectMode: boolean; busy: boolean; dragging: boolean; zoom: number;
  onSelectMode: () => void; onDeselect: () => void; onMove: () => void; onCreate: () => void;
  onZoom: (zoom: number) => void; onFit: () => void;
}) {
  return <header className="board-toolbar" role="toolbar" aria-label="Board controls">
    <div className="board-toolbar__title"><strong>{title}</strong>{selected > 0 && <span>{selected} selected</span>}</div>
    <div className="board-toolbar__actions">
      {selected ? <><ActionButton icon="moveToStash" label="Move to stash…" disabled={busy || dragging} onClick={onMove} />
        <ActionButton icon="close" label="Deselect images" disabled={dragging} onClick={onDeselect} /></>
        : <ActionButton icon={selectMode ? 'selected' : 'select'} label="Select multiple images" aria-pressed={selectMode} onClick={onSelectMode} />}
      <div className="board-toolbar__zoom" role="group" aria-label="Board zoom">
        <ActionButton icon="zoomOut" label="Zoom out" disabled={dragging || zoom <= MIN_BOARD_ZOOM} onClick={() => onZoom(Math.max(MIN_BOARD_ZOOM, Math.round((zoom - .15) * 100) / 100))} />
        <span>{Math.round(zoom * 100)}%</span>
        <ActionButton icon="add" label="Zoom in" disabled={dragging || zoom >= 2} onClick={() => onZoom(Math.min(2, Math.round((zoom + .15) * 100) / 100))} />
      </div>
      <ActionButton icon="fit" className="board-toolbar__labelled" label="Fit board" disabled={dragging} onClick={onFit}><span>Fit</span></ActionButton>
      <ActionButton icon="add" className="board-toolbar__labelled board-toolbar__create" label="Create stash" disabled={busy || dragging} onClick={onCreate}><span>Stash</span></ActionButton>
    </div>
  </header>;
}
