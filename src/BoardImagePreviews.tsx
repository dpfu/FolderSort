import * as React from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle } from 'lucide-react';
import type { LibraryImage } from './libraryStore';
import type { BoardMove } from './useImageIntake';
import type { ImageThumbnailCache } from './imageThumbnails';
import { useThumbnailUrls } from './useThumbnailUrls';
import { PREVIEW_FRAME_PADDING } from './imageIntakeLayout';
import './board-suggestions.css';

/** Drafts share the saved card's 172px contain geometry, including portrait images. */
export default function BoardImagePreviews({ host, moves, images, urls, thumbnails, categoryNames, label, previewRef }: {
  host: HTMLElement | null; moves: BoardMove[]; images: Map<string, LibraryImage>; urls: Map<string, string>;
  thumbnails?: ImageThumbnailCache; categoryNames?: Map<string, string>; label: string; previewRef?: React.Ref<HTMLDivElement>;
}) {
  const root = React.useRef<HTMLDivElement>(null), frame = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(previewRef, () => root.current!, [host]);
  const updateFrame = () => {
    const cells = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-suggestion-preview]') || []);
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
  React.useLayoutEffect(updateFrame, [host, moves]);
  const owner = React.useRef(Symbol('board preview thumbnails'));
  const idsKey = moves.map(move => move.id).join(',');
  React.useEffect(() => {
    thumbnails?.setInterest(owner.current, moves.map(move => move.id));
    return () => thumbnails?.setInterest(owner.current, []);
  }, [thumbnails, idsKey]);
  useThumbnailUrls(thumbnails, moves.map(move => move.id));
  return host && createPortal(<div ref={root} className="board-suggestions__previews" role="group" aria-label={label}>
    {!!moves.length && <div ref={frame} className="board-preview-frame" aria-hidden="true" />}
    {moves.map((move, index) => {
      const image = images.get(move.id), source = categoryNames?.get(image?.categoryId || '');
      return <figure key={move.id} className="board-suggestion" data-suggestion-preview={move.id} data-testid={'suggestion-' + move.id}
        style={{ left: move.x, top: move.y, '--preview-delay': Math.min(index, 5) * 18 + 'ms' } as React.CSSProperties}
        aria-label={'Preview: ' + image?.path} title={image?.path}
        onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
        {urls.get(move.id) ? <img src={urls.get(move.id)} alt={image?.path || 'Preview image'} draggable={false} onLoad={event => {
          const image = event.currentTarget, cell = image.parentElement;
          if (!cell || !image.naturalWidth || !image.naturalHeight) return;
          const scale = Math.min(172 / image.naturalWidth, 172 / image.naturalHeight);
          cell.style.setProperty('--preview-width', image.naturalWidth * scale + 'px');
          cell.style.setProperty('--preview-height', image.naturalHeight * scale + 'px');
          updateFrame();
        }} /> : <LoaderCircle className="is-spinning" size={20} />}
        {source && <figcaption title={'Move from ' + source}>From {source.split('/').at(-1)}</figcaption>}
      </figure>;
    })}
  </div>, host);
}
