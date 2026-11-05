import * as React from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, LoaderCircle, Plus, X } from 'lucide-react';
import { useStableCallback } from './useStableCallback';
import type { ImageThumbnailCache } from './imageThumbnails';
import type { SimilarMatch } from './imageAnalysis';
import type { LibraryImage } from './libraryStore';
import type { BoardBounds } from './pileLayout';
import type { BoardMove } from './useImageIntake';
import { nextSuggestionOrigin, placeAnchoredBatch } from './imageIntakeLayout';
import BoardImagePreviews from './BoardImagePreviews';
import { capturePreviewFrameExit } from './previewFrame';
import { imageOnScopeBoard } from './stashBoard';
import { similarityCopy } from './similarityCopy';
import './board-suggestions.css';

export type SimilarityMethod = 'clip' | 'color';
type PreviewMethod = SimilarityMethod | 'text';
type Point = { x: number; y: number };
type Props = {
  referenceId: string; scopeId: string | null;
  queryKey: string; batches: Map<string, BoardMove[][]>;
  thumbnailCache?: ImageThumbnailCache;
  clipEnabled: boolean; contentRevision: number;
  method: SimilarityMethod; disabled: boolean; images: Map<string, LibraryImage>; urls: Map<string, string>;
  board: React.RefObject<HTMLDivElement>; pane: React.RefObject<HTMLDivElement>;
  positions: ReadonlyMap<string, Point>; groups: BoardBounds[]; zoom: number;
  portal: HTMLElement | null; onPreview: (method: SimilarityMethod, count: number) => Promise<SimilarMatch[]>;
  onSearch: (query: string, count: number) => Promise<SimilarMatch[]>;
  onAdd: (matches: SimilarMatch[], moves: BoardMove[]) => Promise<boolean>;
  onMethod: (method: SimilarityMethod) => void; onThumbnails: (ids: string[]) => void;
};

/** Search and layout are a temporary draft. Acceptance saves that exact draft. */
export default function SimilarImageAdd(props: Props) {
  const { scopeId, method, clipEnabled, contentRevision, queryKey, batches,
    disabled, images, urls, thumbnailCache, board, pane, positions, groups, zoom, portal } = props;
  const latest = React.useRef(props); latest.current = props;
  const button = React.useRef<HTMLButtonElement>(null), panel = React.useRef<HTMLDivElement>(null), previews = React.useRef<HTMLDivElement>(null);
  const [canvasHost, setCanvasHost] = React.useState<HTMLElement | null>(null);
  const [open, setOpen] = React.useState(false), [loading, setLoading] = React.useState(false), [adding, setAdding] = React.useState(false);
  const [count, setCount] = React.useState(3), [choice, setChoice] = React.useState<PreviewMethod>(method);
  const [query, setQuery] = React.useState('');
  const queryRef = React.useRef(''), searchInput = React.useRef<HTMLInputElement>(null);
  const searchTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const [matches, setMatches] = React.useState<SimilarMatch[]>([]), [moves, setMoves] = React.useState<BoardMove[]>([]);
  const [notice, setNotice] = React.useState('');
  const [draftAnnouncement, setDraftAnnouncement] = React.useState(''), [draggingDraft, setDraggingDraft] = React.useState(false);
  const origin = React.useRef<Point>(), draftMatches = React.useRef<SimilarMatch[]>([]);
  const dockOffset = React.useRef<Point>({ x: 0, y: 0 });
  const draftDrag = React.useRef<{ pointerId: number; point: Point; origin: Point }>();
  const openRef = React.useRef(false), alive = React.useRef(true), request = React.useRef(0), committing = React.useRef(false);
  const cache = React.useRef(new Map<string, Promise<SimilarMatch[]>>());
  const id = React.useId();
  const layoutKey = [...positions].map(([key, point]) => key + ':' + point.x + ':' + point.y).join('|')
    + groups.map(group => [group.x, group.y, group.width, group.height].join(':')).join('|');
  const allowed = (image: LibraryImage | undefined) => !!image && !imageOnScopeBoard(image, scopeId)
    && image.categoryId === null && (scopeId !== null || image.rootOnBoard === false);
  const visibleMatches = matches.filter(match => allowed(images.get(match.id)));
  const visibleIds = new Set(visibleMatches.map(match => match.id));
  const visibleMoves = moves.filter(move => visibleIds.has(move.id));
  const batchKey = `${scopeId || 'root'}:${props.referenceId}`;
  const choiceCopy = choice === 'text' ? { method: 'Text search', explanation: 'Finds images matching your words using CLIP text and image embeddings.' } : similarityCopy[choice];

  React.useLayoutEffect(() => { setCanvasHost(board.current?.querySelector<HTMLElement>('[data-testid="board-canvas"]') || null); }, [board]);
  React.useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; request.current++; clearTimeout(searchTimer.current); latest.current.onThumbnails([]); };
  }, []);
  const close = useStableCallback((restoreFocus = false) => {
    request.current++; openRef.current = false; draftDrag.current = undefined; draftMatches.current = [];
    clearTimeout(searchTimer.current);
    setOpen(false); setLoading(false); setDraggingDraft(false); setMatches([]); setMoves([]); latest.current.onThumbnails([]);
    if (restoreFocus) requestAnimationFrame(() => button.current?.focus({ preventScroll: true }));
  });
  const load = useStableCallback(async (next: PreviewMethod, amount: number) => {
    clearTimeout(searchTimer.current);
    if ((next === 'clip' || next === 'text') && !latest.current.clipEnabled) return;
    const token = ++request.current;
    setChoice(next); setNotice(''); setDraftAnnouncement(''); setLoading(true);
    const text = queryRef.current.trim();
    if (next === 'text' && !text) {
      draftMatches.current = []; setMatches([]); setMoves([]); latest.current.onThumbnails([]); setLoading(false); return;
    }
    const cacheKey = next === 'text' ? `text:${text}` : next;
    let pending = cache.current.get(cacheKey);
    // Freeze one ranked cohort per method so quantity changes keep the same images in the same slots.
    if (!pending) {
      pending = next === 'text' ? latest.current.onSearch(text, 12) : latest.current.onPreview(next, 12);
      cache.current.set(cacheKey, pending);
      if (cache.current.size > 24) cache.current.delete(cache.current.keys().next().value!);
    }
    try {
      const result = (await pending).slice(0, amount);
      if (!alive.current || !openRef.current || request.current !== token) return;
      const current = latest.current;
      if (!origin.current) return;
      const plan = placeAnchoredBatch(result.map(match => match.id), origin.current);
      draftMatches.current = result;
      setMatches(result); setMoves(plan); current.onThumbnails(result.map(match => match.id));
      if (!result.length) { cache.current.delete(cacheKey); setNotice('No images available in this search.'); }
    } catch (cause) {
      cache.current.delete(cacheKey);
      if (alive.current && request.current === token) {
        draftMatches.current = []; setMatches([]); setMoves([]); latest.current.onThumbnails([]);
        setNotice(cause instanceof Error ? cause.message : 'Could not find matches. Try again.');
      }
    } finally { if (alive.current && request.current === token) setLoading(false); }
  });
  const show = (focusControls: boolean) => {
    if (disabled || openRef.current) return;
    const reference = positions.get(props.referenceId);
    if (!reference) return;
    origin.current = nextSuggestionOrigin(reference, batches.get(batchKey) || [], move => {
      const image = images.get(move.id);
      return !!image && imageOnScopeBoard(image, scopeId) && image.boardX === move.x && image.boardY === move.y;
    });
    dockOffset.current = { x: 0, y: 0 };
    setDraftAnnouncement('');
    openRef.current = true; setOpen(true); void load(method, count);
    if (focusControls) requestAnimationFrame(() => panel.current?.querySelector('select')?.focus({ preventScroll: true }));
  };
  const accept = async () => {
    if (disabled || loading || committing.current || !visibleMatches.length || visibleMoves.length !== visibleMatches.length) return;
    const finishFrame = capturePreviewFrameExit(previews.current);
    committing.current = true; setAdding(true);
    try {
      const saved = await latest.current.onAdd(visibleMatches, visibleMoves);
      if (saved) { batches.set(batchKey, [...(batches.get(batchKey) || []), visibleMoves.map(move => ({ ...move }))]); finishFrame(); }
      if (alive.current) { if (saved) close(true); else setNotice('The board changed. Preview the suggestions again before adding them.'); }
    } catch (cause) { if (alive.current) setNotice(cause instanceof Error ? cause.message : 'Could not add these images. Try again.'); }
    finally { committing.current = false; if (alive.current) setAdding(false); }
  };

  React.useEffect(() => { cache.current.clear(); if (openRef.current && !committing.current) void load(choice, count); }, [queryKey]);
  React.useEffect(() => {
    if (openRef.current && matches.length) return;
    cache.current.clear();
    // Finished indexing must not replace an already visible, accepted-in-place draft.
    if (openRef.current && (choice === 'clip' || choice === 'text') && !matches.length && !loading) void load(choice, count);
  }, [contentRevision]);
  React.useEffect(() => { if (openRef.current && method !== choice) void load(method, count); }, [method]);
  React.useEffect(() => { if (!clipEnabled && openRef.current && (choice === 'clip' || choice === 'text')) void load('color', count); }, [clipEnabled]);
  React.useEffect(() => { if (openRef.current && !committing.current) close(); }, [layoutKey]);
  React.useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !committing.current) { event.preventDefault(); event.stopPropagation(); close(true); }
    };
    const outsideBoard = (event: PointerEvent) => {
      if (event.target instanceof Node && !pane.current?.contains(event.target) && !panel.current?.contains(event.target) && !committing.current) close();
    };
    document.addEventListener('keydown', escape, true); document.addEventListener('pointerdown', outsideBoard, true);
    return () => { document.removeEventListener('keydown', escape, true); document.removeEventListener('pointerdown', outsideBoard, true); };
  }, [open, close]);
  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = pane.current?.getBoundingClientRect(), control = panel.current;
      const canvas = board.current?.querySelector<HTMLElement>('[data-testid="board-canvas"]'), canvasBounds = canvas?.getBoundingClientRect();
      if (!bounds || !control || !canvas || !canvasBounds || !origin.current) return;
      const scale = canvasBounds.width / canvas.offsetWidth;
      const frame = previews.current?.querySelector('.board-preview-frame')?.getBoundingClientRect();
      const left = (frame?.left ?? canvasBounds.left + origin.current.x * scale - 6) + dockOffset.current.x;
      const top = (frame?.top ?? canvasBounds.top + origin.current.y * scale) + dockOffset.current.y;
      const intake = pane.current?.querySelector('.staging-intake')?.getBoundingClientRect();
      const limit = (intake?.top || bounds.bottom) - 12;
      control.style.maxWidth = Math.max(0, bounds.width - 16) + 'px';
      control.style.left = Math.max(bounds.left + 8, Math.min(bounds.right - control.offsetWidth - 8, left)) + 'px';
      control.style.top = Math.max(bounds.top + 8, Math.min(limit - control.offsetHeight, top - control.offsetHeight - 12)) + 'px';
    };
    place(); const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current); if (pane.current) observer.observe(pane.current);
    const frame = previews.current?.querySelector('.board-preview-frame'); if (frame) observer.observe(frame);
    const camera = new MutationObserver(place), canvas = board.current?.querySelector('[data-testid="board-canvas"]');
    if (canvas) camera.observe(canvas, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    return () => { observer.disconnect(); camera.disconnect(); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, moves, zoom, notice, loading]);

  const moveDraft = (point: Point) => {
    origin.current = { x: Math.max(0, point.x), y: Math.max(0, point.y) };
    setMoves(placeAnchoredBatch(draftMatches.current.map(match => match.id), origin.current));
  };
  const pointerPoint = (event: React.PointerEvent): Point | undefined => {
    const canvas = board.current?.querySelector<HTMLElement>('[data-testid="board-canvas"]'), bounds = canvas?.getBoundingClientRect();
    if (!canvas || !bounds) return;
    const scale = bounds.width / canvas.offsetWidth;
    return { x: (event.clientX - bounds.left) / scale, y: (event.clientY - bounds.top) / scale };
  };
  const endDraftDrag = (event: React.PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const drag = draftDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    draftDrag.current = undefined; setDraggingDraft(false);
    if (cancelled) moveDraft(drag.origin);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDraftAnnouncement(cancelled ? 'Suggestion move cancelled.' : 'Suggestions moved. Add to place them here.');
  };

  return <>
    <button ref={button} type="button" className="similar-image-add" aria-label="Show related image suggestions"
      title="Preview related images beside this image" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); show(event.detail === 0); }}>
      <Plus size={20} aria-hidden="true" />
    </button>
    {open && <BoardImagePreviews host={canvasHost} previewRef={previews} moves={visibleMoves} images={images} urls={urls}
      thumbnails={thumbnailCache} label="Previewed suggestions" />}
    {open && portal && createPortal(<section ref={panel} id={id} role="region" aria-label="Similar image suggestions" className={'board-suggestions' + (draggingDraft ? ' is-moving' : '')}
      aria-busy={loading || adding} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <div className="board-suggestions__controls">
        <button type="button" className="board-suggestions__grip" aria-label="Move suggestions" title="Drag suggestions · Arrow keys to move, Shift for larger steps"
          disabled={disabled || loading || adding || !visibleMoves.length}
          onPointerDown={event => {
            if (event.button !== 0 || !origin.current) return;
            const point = pointerPoint(event); if (!point) return;
            const control = panel.current?.getBoundingClientRect(), frame = previews.current?.querySelector('.board-preview-frame')?.getBoundingClientRect();
            if (control && frame) dockOffset.current = { x: control.left - frame.left, y: control.top - (frame.top - control.height - 12) };
            event.preventDefault(); event.stopPropagation();
            draftDrag.current = { pointerId: event.pointerId, point, origin: { ...origin.current } }; setDraggingDraft(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            const drag = draftDrag.current, point = pointerPoint(event);
            if (drag?.pointerId === event.pointerId && point) moveDraft({ x: drag.origin.x + point.x - drag.point.x, y: drag.origin.y + point.y - drag.point.y });
          }}
          onPointerUp={event => endDraftDrag(event)} onPointerCancel={event => endDraftDrag(event, true)} onLostPointerCapture={event => endDraftDrag(event, true)}
          onKeyDown={event => {
            const delta = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key];
            if (!delta || !origin.current) return;
            event.preventDefault(); const step = event.shiftKey ? 30 : 10;
            moveDraft({ x: origin.current.x + delta[0] * step, y: origin.current.y + delta[1] * step });
            setDraftAnnouncement('Suggestions moved. Add to place them here.');
          }}><GripVertical size={15} aria-hidden="true" /></button>
        <select aria-label="Suggestion method" value={choice} disabled={disabled || adding} title={choiceCopy.explanation}
          onChange={event => {
            const next = event.currentTarget.value as PreviewMethod;
            if (next !== 'text') latest.current.onMethod(next);
            void load(next, count);
            if (next === 'text') requestAnimationFrame(() => searchInput.current?.focus({ preventScroll: true }));
          }}>
          {clipEnabled && <><option value="clip">Subject</option><option value="text">Text search</option></>}<option value="color">Color</option>
        </select>
        {choice === 'text' && <input ref={searchInput} type="search" aria-label="Search images by subject" placeholder="e.g. handshakes" value={query} maxLength={300} disabled={disabled || adding}
          onChange={event => {
            const value = event.currentTarget.value; queryRef.current = value; setQuery(value); request.current++;
            draftMatches.current = []; setMatches([]); setMoves([]); latest.current.onThumbnails([]); setNotice('');
            clearTimeout(searchTimer.current); setLoading(!!value.trim());
            searchTimer.current = setTimeout(() => { if (openRef.current) void load('text', count); }, 350);
          }}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (!event.nativeEvent.isComposing) void load('text', count); } }} />}
        <select aria-label="Number of suggestions" value={count} title="Number of suggestions" disabled={disabled || adding}
          onChange={event => { const amount = Number(event.currentTarget.value); setCount(amount); void load(choice, amount); }}>
          {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
        </select>
        <button type="button" className="board-suggestions__accept" disabled={disabled || loading || adding || !visibleMoves.length} onClick={() => void accept()}>
          {loading || adding ? <LoaderCircle size={16} className="is-spinning" /> : <Plus size={17} />}{loading ? 'Finding…' : visibleMoves.length ? 'Add ' + visibleMoves.length : 'No suggestions'}
        </button>
        <button type="button" className="board-suggestions__close" aria-label="Close similar image suggestions" title="Dismiss suggestions" disabled={adding} onClick={() => close(true)}><X size={16} /></button>
      </div>
      {!!draftAnnouncement && !loading && !notice && <span className="sorting-workspace__visually-hidden" role="status">{draftAnnouncement}</span>}
      {choice === 'text' && !query.trim() && <p className="board-suggestions__notice">Describe images to preview. Searches the waiting images.</p>}
      {(loading || notice) && <p role="status" className="board-suggestions__notice">{loading ? 'Finding images…' : notice}
        {!loading && <button type="button" disabled={disabled} onClick={() => { cache.current.clear(); void load(choice, count); }}>Try again</button>}
      </p>}
    </section>, portal)}
  </>;
}
