import type { BoardEdit } from './boardEdit';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Plus, Shuffle, X } from 'lucide-react';
import BoardImagePreviews from './BoardImagePreviews';
import { capturePreviewFrameExit } from './previewFrame';
import { placeInPlaceBatch, readIntakeView } from './imageIntakeLayout';
import { MAX_RANDOM_BATCH } from './useRootIntake';
import { shuffled } from './useBrowserOrder';
import { useStableCallback } from './useStableCallback';
import { usePreviewSession } from './usePreviewSession';
import { consumePreview, emptyPreviewBatch, previewLocation, previewMoves, reconcilePreview, resizePreview, togglePreview, type PreviewPlace, type PreviewPlacementActions } from './previewBatch';
import type { BoardMove } from './useImageIntake';
import type { LibraryImage } from './libraryStore';
import type { ImageThumbnailCache } from './imageThumbnails';
import './staging-intake.css';

type Point = { x: number; y: number };
export default function RandomImageAdd({ candidateIds, count, board, pane, zoom, host, images, thumbnails, urls, disabled, positions, groupLayoutKey, onCount, onAccept, onClose, onPlace, onHover, onPlaceInto, onViewPreview, onMovePreview }: PreviewPlacementActions & {
  candidateIds: string[]; count: number; board: React.RefObject<HTMLDivElement>; pane: React.RefObject<HTMLDivElement>; zoom: number;
  host: HTMLElement | null; images: Map<string, LibraryImage>; thumbnails: ImageThumbnailCache; urls: Map<string, string>;
  disabled: boolean; positions: ReadonlyMap<string, Point>; groupLayoutKey: string; onCount: (count: number) => void;
  onAccept: (moves: BoardMove[]) => BoardEdit; onClose: (restoreFocus?: boolean) => void; onPlace: PreviewPlace; onHover: (point: Point | null) => void;
}) {
  const current = React.useRef({ images, onAccept, onClose, onPlace, disabled }); current.current = { images, onAccept, onClose, onPlace, disabled };
  const controls = React.useRef<HTMLElement>(null), previews = React.useRef<HTMLDivElement>(null);
  const [canvasHost, setCanvasHost] = React.useState<HTMLElement | null>(null);
  const [amount, setAmount] = React.useState(() => Math.max(1, Math.min(MAX_RANDOM_BATCH, count, candidateIds.length)));
  const [pool] = React.useState(() => shuffled(candidateIds).map(id => ({ id })));
  const { session, state } = usePreviewSession(emptyPreviewBatch<{ id: string }>(), true);
  const owned = React.useRef(new Map<string, string>());
  const allowed = (id: string) => { const image = current.current.images.get(id); return image?.categoryId === null && image.rootOnBoard === false && (!owned.current.has(id) || owned.current.get(id) === previewLocation(image)); };
  const moves = previewMoves(state.data), retained = previewMoves(state.data, true), adding = session.accepting;
  const available = candidateIds.filter(allowed);
  const layoutKey = [...positions].filter(([id]) => !owned.current.has(id)).map(([id, point]) => `${id}:${point.x}:${point.y}`).join('|') + groupLayoutKey;
  const initialLayout = React.useRef(layoutKey);
  const close = useStableCallback((focus: boolean = false) => { if (session.close(emptyPreviewBatch())) current.current.onClose(focus); });
  React.useLayoutEffect(() => {
    setCanvasHost(board.current?.querySelector<HTMLElement>('[data-testid="board-canvas"]') || null);
    const view = readIntakeView(board.current, pane.current, zoom);
    if (view) session.update(batch => {
      const points = placeInPlaceBatch(Array.from({ length: amount }, (_, i) => String(i)), view);
      // Explicit quantity changes retain choices and use the existing fitted
      // layout. Single-image drops never run this layout pass.
      const slots = batch.slots.map((slot, index) => points[index] ? { ...slot, x: points[index].x, y: points[index].y } : slot);
      return resizePreview({ ...batch, slots, pool }, points, allowed);
    });
  }, [amount]);
  React.useEffect(() => { if (!adding) session.update(batch => reconcilePreview(batch, allowed)); }, [images, adding]);
  React.useLayoutEffect(() => { controls.current?.querySelector('button')?.focus({ preventScroll: true }); }, [host]);
  React.useEffect(() => {
    if (layoutKey !== initialLayout.current && !session.accepted && !session.accepting) close();
  }, [layoutKey, close]);
  React.useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !(event.target instanceof Element && event.target.closest('[data-context-menu], dialog')) && !session.accepted && !session.accepting) { event.preventDefault(); event.stopPropagation(); close(true); } };
    const outside = (event: PointerEvent) => { if (event.target instanceof Element && !event.target.closest('.undo-control, [data-context-menu], dialog') && !pane.current?.contains(event.target)) close(); };
    document.addEventListener('keydown', escape, true); document.addEventListener('pointerdown', outside, true);
    return () => { document.removeEventListener('keydown', escape, true); document.removeEventListener('pointerdown', outside, true); };
  }, [close, pane]);
  const placeOne = async (id: string, commit: () => BoardEdit) => {
    if (current.current.disabled || !allowed(id) || !session.current.data.slots.some(slot => slot.item?.id === id)) return false;
    const task = session.accept(); if (!task) return false;
    owned.current.set(id, previewLocation(current.current.images.get(id)!));
    try {
      const edit = commit();
      if (edit.status !== 'accepted') { owned.current.delete(id); session.cancel(task); return false; }
      const outcome = await edit.completion;
      if (outcome.status === 'failed') throw new Error(outcome.error);
      session.resume(task, reconcilePreview(consumePreview(session.current.data, id), allowed));
      return true;
    } catch (cause) {
      owned.current.delete(id); session.reject(task, cause instanceof Error ? cause.message : 'Could not place this image.'); return false;
    }
  };
  const refresh = () => {
    const seen = new Set(moves.map(move => move.id));
    const ids = [...shuffled(available.filter(id => !seen.has(id))), ...shuffled(available.filter(id => seen.has(id)))];
    session.update(batch => reconcilePreview({ slots: batch.slots.map(slot => ({ ...slot, item: undefined, included: true, history: [] })), pool: ids.map(id => ({ id })) }, allowed));
  };
  return <>
    <BoardImagePreviews host={canvasHost} previewRef={previews} moves={moves} slots={state.data.slots} images={images} urls={urls} thumbnails={thumbnails} label="Random image previews"
      disabled={disabled || adding} zoom={zoom} onToggle={id => session.update(batch => togglePreview(batch, id))} onDrop={(id, point, anchor) => placeOne(id, () => current.current.onPlace(id, point, anchor))} onHover={onHover}
      onView={onViewPreview} onAddOne={(id, point) => placeOne(id, () => onPlaceInto(id, null, point))} onMoveOne={id => onMovePreview(id, destination => placeOne(id, () => onPlaceInto(id, destination)))} />
    {host && createPortal(<section ref={controls} className="staging-preview" role="region" aria-label="Random image previews"
      onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <button type="button" className="staging-preview__accept" disabled={disabled || adding || !retained.length}
        onClick={() => {
          if (disabled) return;
          const task = session.accept(); if (!task) return;
          const finishFrame = capturePreviewFrameExit(previews.current);
          try {
            if (current.current.onAccept(retained).status === 'accepted') { session.resolve(task, session.current.data); finishFrame(); close(true); }
            else session.reject(task, 'The board changed. Preview these images again before adding them.');
          } catch (cause) { session.reject(task, cause instanceof Error ? cause.message : 'Could not add these images.'); }
        }}><Plus size={18} />{`Add ${retained.length}`}</button>
      <select aria-label="Number of preview images" value={amount} disabled={disabled || adding || !available.length}
        onChange={event => { const value = Number(event.currentTarget.value); setAmount(value); onCount(value); }}>
        {Array.from({ length: Math.max(amount, Math.min(MAX_RANDOM_BATCH, available.length)) }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
      </select>
      <button type="button" className="staging-preview__icon" aria-label="Try other random images" title="Try other random images" disabled={disabled || adding || available.length <= moves.length} onClick={refresh}><Shuffle size={17} /></button>
      <button type="button" className="staging-preview__icon" aria-label="Dismiss random image previews" title="Dismiss previews · Escape" disabled={adding} onClick={() => close(true)}><X size={17} /></button>
      {state.notice && <p role="alert">{state.notice}</p>}
      <span className="sorting-workspace__visually-hidden" role="status">{retained.length} of {moves.length} images included. Not added yet.</span>
    </section>, host)}
  </>;
}
