import * as React from 'react';
import { createPortal } from 'react-dom';
import { Plus, Shuffle, X } from 'lucide-react';
import BoardImagePreviews from './BoardImagePreviews';
import { capturePreviewFrameExit } from './previewFrame';
import { placeInPlaceBatch, readIntakeView } from './imageIntakeLayout';
import { clampBatch, MAX_RANDOM_BATCH, randomBatch } from './useRootIntake';
import { useStableCallback } from './useStableCallback';
import type { BoardMove } from './useImageIntake';
import type { LibraryImage } from './libraryStore';
import type { ImageThumbnailCache } from './imageThumbnails';
import './staging-intake.css';

export default function RandomImageAdd({ candidateIds, count, board, pane, zoom, host, images, thumbnails, urls, disabled, layoutKey, onCount, onAccept, onClose }: {
  candidateIds: string[]; count: number; board: React.RefObject<HTMLDivElement>; pane: React.RefObject<HTMLDivElement>; zoom: number;
  host: HTMLElement | null; images: Map<string, LibraryImage>; thumbnails: ImageThumbnailCache; urls: Map<string, string>;
  disabled: boolean; layoutKey: string; onCount: (count: number) => void;
  onAccept: (moves: BoardMove[]) => boolean; onClose: (restoreFocus?: boolean) => void;
}) {
  const current = React.useRef({ images, board, pane, zoom, onAccept, onClose }); current.current = { images, board, pane, zoom, onAccept, onClose };
  const controls = React.useRef<HTMLElement>(null);
  const previews = React.useRef<HTMLDivElement>(null);
  const [canvasHost, setCanvasHost] = React.useState<HTMLElement | null>(null);
  const [pool, setPool] = React.useState(() => randomBatch(candidateIds, MAX_RANDOM_BATCH));
  const [moves, setMoves] = React.useState<BoardMove[]>([]);
  const committed = React.useRef(false);
  const available = candidateIds.filter(id => { const image = images.get(id); return image?.categoryId === null && image.rootOnBoard === false; });
  const eligible = new Set(available), amount = Math.min(available.length, clampBatch(count, available.length));
  const ids = pool.filter(id => eligible.has(id)).slice(0, amount);
  const idsKey = ids.join(',');
  const initialLayout = React.useRef(layoutKey);
  const close = useStableCallback((focus: boolean = false) => current.current.onClose(focus));
  React.useLayoutEffect(() => {
    setCanvasHost(board.current?.querySelector<HTMLElement>('[data-testid="board-canvas"]') || null);
    const view = readIntakeView(board.current, pane.current, zoom);
    if (view) setMoves(placeInPlaceBatch(ids, view));
  }, [idsKey]);
  React.useLayoutEffect(() => { controls.current?.querySelector('button')?.focus({ preventScroll: true }); }, [host]);
  React.useEffect(() => {
    if (layoutKey !== initialLayout.current && !committed.current) close();
  }, [layoutKey, close]);
  React.useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !committed.current) { event.preventDefault(); event.stopPropagation(); close(true); } };
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !pane.current?.contains(event.target)) close(); };
    document.addEventListener('keydown', escape, true); document.addEventListener('pointerdown', outside, true);
    return () => { document.removeEventListener('keydown', escape, true); document.removeEventListener('pointerdown', outside, true); };
  }, [close, pane]);
  const refresh = () => {
    const unseen = available.filter(id => !ids.includes(id));
    setPool([...randomBatch(unseen, MAX_RANDOM_BATCH), ...randomBatch(ids, MAX_RANDOM_BATCH)].slice(0, MAX_RANDOM_BATCH));
  };
  const visible = moves.filter(move => eligible.has(move.id));
  return <>
    <BoardImagePreviews host={canvasHost} previewRef={previews} moves={visible} images={images} urls={urls} thumbnails={thumbnails} label="Random image previews" />
    {host && createPortal(<section ref={controls} className="staging-preview" role="region" aria-label="Random image previews"
      onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <button type="button" className="staging-preview__accept" disabled={disabled || !visible.length || visible.length !== ids.length}
        onClick={() => {
          if (disabled || committed.current) return;
          const finishFrame = capturePreviewFrameExit(previews.current);
          committed.current = true;
          if (current.current.onAccept(visible)) { finishFrame(); close(true); } else committed.current = false;
        }}><Plus size={18} />{visible.length === 1 ? 'Add this image' : `Add these ${visible.length}`}</button>
      <select aria-label="Number of preview images" value={amount || 1} disabled={disabled || !available.length}
        onChange={event => onCount(Number(event.currentTarget.value))}>
        {Array.from({ length: Math.max(1, Math.min(MAX_RANDOM_BATCH, available.length)) }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
      </select>
      <button type="button" className="staging-preview__icon" aria-label="Try other random images" title="Try other random images" disabled={disabled || available.length <= ids.length} onClick={refresh}><Shuffle size={17} /></button>
      <button type="button" className="staging-preview__icon" aria-label="Dismiss random image previews" title="Dismiss previews · Escape" onClick={() => close(true)}><X size={17} /></button>
      <span className="sorting-workspace__visually-hidden" role="status">{visible.length} {visible.length === 1 ? 'image previewed' : 'images previewed'}. Not added yet.</span>
    </section>, host)}
  </>;
}
