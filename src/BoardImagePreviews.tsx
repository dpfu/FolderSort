import * as React from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle } from 'lucide-react';
import type { LibraryImage } from './libraryStore';
import type { BoardMove } from './useImageIntake';
import type { ImageThumbnailCache } from './imageThumbnails';
import { useThumbnailUrls } from './useThumbnailUrls';
import { PREVIEW_FRAME_PADDING } from './imageIntakeLayout';
import { PointerSession } from './pointerSession';
import type { PreviewItem, PreviewSlot } from './previewBatch';
import './board-suggestions.css';

type Point = { x: number; y: number };
export type PreviewDrop = (id: string, point: Point, anchor: Point) => Promise<boolean>;

function PreviewPhoto({ slot, index, image, url, source, disabled, zoom, onToggle, onDrop, onHover, updateFrame }: {
  slot: PreviewSlot<PreviewItem>; index: number; image?: LibraryImage; url?: string; source?: string; disabled: boolean; zoom: number;
  onToggle?: (id: string) => void; onDrop?: PreviewDrop; onHover?: (point: Point | null) => void; updateFrame: () => void;
}) {
  const [pointer] = React.useState(() => new PointerSession<{ id: string; url: string; start: Point; anchor: Point; width: number; started: boolean }>());
  const [drag, setDrag] = React.useState<{ url: string; point: Point; anchor: Point; width: number }>();
  const skipClick = React.useRef(false);
  const hover = React.useRef(onHover); hover.current = onHover;
  React.useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !pointer.current) return;
      event.preventDefault(); event.stopPropagation(); pointer.cancel(); skipClick.current = true; setDrag(undefined); hover.current?.(null);
    };
    window.addEventListener('keydown', cancel, true);
    return () => { window.removeEventListener('keydown', cancel, true); if (pointer.cancel()?.started) hover.current?.(null); };
  }, [pointer]);
  const id = slot.item?.id;
  React.useEffect(() => {
    if (pointer.current && (disabled || pointer.current.data.id !== id)) {
      pointer.cancel(); skipClick.current = true; setDrag(undefined); hover.current?.(null);
    }
  }, [disabled, id, pointer]);
  return <figure className={`board-suggestion${!slot.included ? ' is-excluded' : ''}${drag ? ' is-preview-dragging' : ''}${!id ? ' is-vacant' : ''}`}
    data-suggestion-preview={id} data-preview-slot={index} data-testid={id ? 'suggestion-' + id : undefined} tabIndex={-1}
    style={{ left: slot.x, top: slot.y, '--preview-delay': Math.min(index, 5) * 18 + 'ms', '--preview-control-scale': 1 / zoom } as React.CSSProperties}
    aria-label={id ? 'Preview: ' + image?.path : 'No more images for this slot'} aria-disabled={disabled || !id} title={image?.path}
    onPointerDown={event => {
      event.stopPropagation(); if (event.button !== 0 || disabled || !id || !url || !onDrop) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (!pointer.begin(event.pointerId, { id, url, start: { x: event.clientX, y: event.clientY }, anchor: { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height }, width: box.width, started: false })) return;
      event.preventDefault(); skipClick.current = false; event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const current = pointer.read(event.pointerId); if (!current) return;
      const point = { x: event.clientX, y: event.clientY };
      if (!current.started && Math.hypot(point.x - current.start.x, point.y - current.start.y) < 5) return;
      current.started = true; skipClick.current = true; setDrag({ url: current.url, point, anchor: current.anchor, width: current.width }); onHover?.(point);
    }}
    onPointerUp={event => {
      const current = pointer.finish(event.pointerId); if (!current) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      setDrag(undefined); onHover?.(null);
      if (current.started && current.id === id && !disabled) void onDrop?.(current.id, { x: event.clientX, y: event.clientY }, current.anchor);
    }}
    onPointerCancel={event => { if (pointer.finish(event.pointerId)) { skipClick.current = true; setDrag(undefined); onHover?.(null); } }}
    onLostPointerCapture={event => { if (pointer.finish(event.pointerId)) { skipClick.current = true; setDrag(undefined); onHover?.(null); } }}
    onClick={event => { event.stopPropagation(); if (!disabled && id && !skipClick.current && !(event.target as Element).closest('input')) onToggle?.(id); skipClick.current = false; }}>
    {id ? url ? <img key={id} src={url} alt={image?.path || 'Preview image'} draggable={false} onLoad={event => {
      const photo = event.currentTarget, cell = photo.parentElement;
      if (!cell || !photo.naturalWidth || !photo.naturalHeight) return;
      const scale = Math.min(172 / photo.naturalWidth, 172 / photo.naturalHeight);
      cell.style.setProperty('--preview-width', photo.naturalWidth * scale + 'px'); cell.style.setProperty('--preview-height', photo.naturalHeight * scale + 'px'); updateFrame();
    }} /> : <LoaderCircle className="is-spinning" size={20} /> : <span className="board-suggestion__empty" aria-hidden="true">—</span>}
    {id && onToggle && <input type="checkbox" className="board-suggestion__include" aria-label={`Include ${image?.path || id} in batch`} checked={slot.included} disabled={disabled}
      onPointerDown={event => { event.stopPropagation(); event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); }} onClick={event => event.stopPropagation()} onChange={() => onToggle(id)} />}
    {source && <figcaption title={'Move from ' + source}>From {source.split('/').at(-1)}</figcaption>}
    {drag && createPortal(<div className="preview-image-drag" data-preview-drag-ghost style={{ left: drag.point.x - drag.width * drag.anchor.x, top: drag.point.y - drag.width * drag.anchor.y, width: drag.width, height: drag.width }}><img src={drag.url} alt="" draggable={false} /></div>, document.body)}
  </figure>;
}

/** Drafts share the saved card's 172px contain geometry, including portrait images. */
export default function BoardImagePreviews({ host, moves, images, urls, thumbnails, categoryNames, label, previewRef, slots, disabled = false, zoom = 1, onToggle, onDrop, onHover }: {
  host: HTMLElement | null; moves: BoardMove[]; images: Map<string, LibraryImage>; urls: Map<string, string>;
  thumbnails?: ImageThumbnailCache; categoryNames?: Map<string, string>; label: string; previewRef?: React.Ref<HTMLDivElement>;
  slots?: PreviewSlot<PreviewItem>[]; disabled?: boolean; zoom?: number; onToggle?: (id: string) => void; onDrop?: PreviewDrop; onHover?: (point: Point | null) => void;
}) {
  const root = React.useRef<HTMLDivElement>(null), frame = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(previewRef, () => root.current!, [host]);
  const updateFrame = () => {
    const cells = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-preview-slot]') || []);
    if (!frame.current || !cells.length) return;
    const boxes = cells.map(cell => {
      const photo = cell.querySelector('img');
      const scale = photo?.naturalWidth && photo.naturalHeight ? Math.min(172 / photo.naturalWidth, 172 / photo.naturalHeight) : 1;
      const width = photo?.naturalWidth ? photo.naturalWidth * scale : 172;
      const height = photo?.naturalHeight ? photo.naturalHeight * scale : 172;
      return { x: parseFloat(cell.style.left) + (172 - width) / 2, y: parseFloat(cell.style.top) + (172 - height) / 2, width, height };
    });
    const left = Math.min(...boxes.map(box => box.x)) - PREVIEW_FRAME_PADDING, top = Math.min(...boxes.map(box => box.y)) - PREVIEW_FRAME_PADDING;
    Object.assign(frame.current.style, { left: left + 'px', top: top + 'px',
      width: Math.max(...boxes.map(box => box.x + box.width)) - left + PREVIEW_FRAME_PADDING + 'px',
      height: Math.max(...boxes.map(box => box.y + box.height)) - top + PREVIEW_FRAME_PADDING + 'px' });
  };
  React.useLayoutEffect(updateFrame, [host, moves, slots]);
  const owner = React.useRef(Symbol('board preview thumbnails'));
  const idsKey = moves.map(move => move.id).join(',');
  React.useEffect(() => {
    thumbnails?.setInterest(owner.current, moves.map(move => move.id));
    return () => thumbnails?.setInterest(owner.current, []);
  }, [thumbnails, idsKey]);
  useThumbnailUrls(thumbnails, moves.map(move => move.id));
  return host && createPortal(<div ref={root} className="board-suggestions__previews" role="group" aria-label={label}>
    {!!(slots?.length || moves.length) && <div ref={frame} className="board-preview-frame" aria-hidden="true" />}
    {(slots || moves.map(move => ({ ...move, item: { id: move.id }, included: true, history: [] }))).map((slot, index) => {
      const image = images.get(slot.item?.id || '');
      return <PreviewPhoto key={index} {...{ slot, index, image, disabled, zoom, onToggle, onDrop, onHover, updateFrame }} url={urls.get(slot.item?.id || '')} source={categoryNames?.get(image?.categoryId || '')} />;
    })}
  </div>, host);
}
