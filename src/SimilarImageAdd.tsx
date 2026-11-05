import * as React from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, Plus, X } from 'lucide-react';
import { useStableCallback } from './useStableCallback';
import type { ImageThumbnailCache } from './imageThumbnails';
import type { SimilarMatch } from './imageAnalysis';
import type { LibraryImage } from './libraryStore';
import type { BoardBounds } from './pileLayout';
import type { BoardMove } from './useImageIntake';
import { placeInPlaceBatch, readIntakeView } from './imageIntakeLayout';
import BoardImagePreviews from './BoardImagePreviews';
import { capturePreviewFrameExit } from './previewFrame';
import { imageOnScopeBoard } from './stashBoard';
import { similarityCopy } from './similarityCopy';
import './board-suggestions.css';

export type SimilarityMethod = 'clip' | 'color';
type Point = { x: number; y: number };
type Props = {
  referenceId: string; scopeId: string | null;
  queryKey: string; action: 'move' | 'add'; destination: string; categoryNames: Map<string, string>;
  includeOtherStashes: boolean; onIncludeOtherStashes: (include: boolean) => void;
  thumbnailCache?: ImageThumbnailCache;
  clipEnabled: boolean; contentRevision: number;
  method: SimilarityMethod; disabled: boolean; images: Map<string, LibraryImage>; urls: Map<string, string>;
  board: React.RefObject<HTMLDivElement>; pane: React.RefObject<HTMLDivElement>;
  positions: ReadonlyMap<string, Point>; groups: BoardBounds[]; zoom: number;
  portal: HTMLElement | null; onPreview: (method: SimilarityMethod, count: number) => Promise<SimilarMatch[]>;
  onAdd: (method: SimilarityMethod, matches: SimilarMatch[], moves: BoardMove[]) => Promise<boolean>;
  onMethod: (method: SimilarityMethod) => void; onThumbnails: (ids: string[]) => void;
};

/** Search and layout are a temporary draft. Acceptance saves that exact draft. */
export default function SimilarImageAdd(props: Props) {
  const { scopeId, method, clipEnabled, contentRevision, queryKey, action, destination, categoryNames,
    includeOtherStashes, onIncludeOtherStashes, disabled, images, urls, thumbnailCache, board, pane, positions, groups, zoom, portal } = props;
  const latest = React.useRef(props); latest.current = props;
  const button = React.useRef<HTMLButtonElement>(null), panel = React.useRef<HTMLDivElement>(null), previews = React.useRef<HTMLDivElement>(null);
  const [canvasHost, setCanvasHost] = React.useState<HTMLElement | null>(null);
  const [open, setOpen] = React.useState(false), [loading, setLoading] = React.useState(false), [adding, setAdding] = React.useState(false);
  const [count, setCount] = React.useState(3), [choice, setChoice] = React.useState(method);
  const [matches, setMatches] = React.useState<SimilarMatch[]>([]), [moves, setMoves] = React.useState<BoardMove[]>([]);
  const [notice, setNotice] = React.useState('');
  const openRef = React.useRef(false), alive = React.useRef(true), request = React.useRef(0), committing = React.useRef(false);
  const cache = React.useRef(new Map<string, Promise<SimilarMatch[]>>());
  const id = React.useId();
  const layoutKey = [...positions].map(([key, point]) => key + ':' + point.x + ':' + point.y).join('|')
    + groups.map(group => [group.x, group.y, group.width, group.height].join(':')).join('|');
  const allowed = (image: LibraryImage | undefined) => !!image && !imageOnScopeBoard(image, scopeId)
    && (scopeId === null ? image.categoryId === null && image.rootOnBoard === false : image.categoryId === null || includeOtherStashes);
  const visibleMatches = matches.filter(match => allowed(images.get(match.id)));
  const visibleIds = new Set(visibleMatches.map(match => match.id));
  const visibleMoves = moves.filter(move => visibleIds.has(move.id));
  const verb = action === 'move' ? 'Move' : 'Add';

  React.useLayoutEffect(() => { setCanvasHost(board.current?.querySelector<HTMLElement>('[data-testid="board-canvas"]') || null); }, [board]);
  React.useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; request.current++; latest.current.onThumbnails([]); };
  }, []);
  const close = useStableCallback((restoreFocus = false) => {
    request.current++; openRef.current = false; setOpen(false); setLoading(false); setMatches([]); setMoves([]); latest.current.onThumbnails([]);
    if (restoreFocus) requestAnimationFrame(() => button.current?.focus({ preventScroll: true }));
  });
  const load = useStableCallback(async (next: SimilarityMethod, amount: number) => {
    if (next === 'clip' && !latest.current.clipEnabled) return;
    const token = ++request.current;
    setChoice(next); setNotice(''); setMatches([]); setMoves([]); setLoading(true); latest.current.onThumbnails([]);
    const cacheKey = next + ':' + amount;
    let pending = cache.current.get(cacheKey);
    if (!pending) { pending = latest.current.onPreview(next, amount); cache.current.set(cacheKey, pending); }
    try {
      const result = await pending;
      if (!alive.current || !openRef.current || request.current !== token) return;
      const current = latest.current;
      const view = readIntakeView(current.board.current, current.pane.current, current.zoom, (current.scopeId === null ? 64 : 0) + (current.action === 'move' ? 100 : 68));
      if (!view) return;
      const plan = placeInPlaceBatch(result.map(match => match.id), view, current.positions.get(current.referenceId));
      setMatches(result); setMoves(plan); current.onThumbnails(result.map(match => match.id));
      if (!result.length) { cache.current.delete(cacheKey); setNotice('No images available in this search.'); }
    } catch (cause) {
      cache.current.delete(cacheKey);
      if (alive.current && request.current === token) setNotice(cause instanceof Error ? cause.message : 'Could not find matches. Try again.');
    } finally { if (alive.current && request.current === token) setLoading(false); }
  });
  const show = (focusControls: boolean) => {
    if (disabled || openRef.current) return;
    openRef.current = true; setOpen(true); void load(method, count);
    if (focusControls) requestAnimationFrame(() => panel.current?.querySelector('select')?.focus({ preventScroll: true }));
  };
  const accept = async () => {
    if (disabled || loading || committing.current || !visibleMatches.length || visibleMoves.length !== visibleMatches.length) return;
    const finishFrame = capturePreviewFrameExit(previews.current);
    committing.current = true; setAdding(true);
    try {
      const saved = await latest.current.onAdd(choice, visibleMatches, visibleMoves);
      if (saved) finishFrame();
      if (alive.current) { if (saved) close(true); else setNotice('The board changed. Preview the suggestions again before adding them.'); }
    } catch (cause) { if (alive.current) setNotice(cause instanceof Error ? cause.message : 'Could not add these images. Try again.'); }
    finally { committing.current = false; if (alive.current) setAdding(false); }
  };

  React.useEffect(() => { cache.current.clear(); if (openRef.current && !committing.current) void load(choice, count); }, [queryKey]);
  React.useEffect(() => {
    for (const key of cache.current.keys()) if (key.startsWith('clip:')) cache.current.delete(key);
    // Finished indexing must not replace an already visible, accepted-in-place draft.
    if (openRef.current && choice === 'clip' && !matches.length && !loading) void load(choice, count);
  }, [contentRevision]);
  React.useEffect(() => { if (openRef.current && method !== choice) void load(method, count); }, [method]);
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
      const reference = button.current?.closest('.card')?.getBoundingClientRect();
      if (!bounds || !control || !reference) return;
      const cells = Array.from(previews.current?.querySelectorAll<HTMLElement>('[data-suggestion-preview]') || []).map(cell => cell.getBoundingClientRect());
      const left = cells.length ? Math.min(...cells.map(cell => cell.left)) : reference.left;
      const right = cells.length ? Math.max(...cells.map(cell => cell.right)) : reference.right;
      const frame = previews.current?.querySelector('.board-preview-frame')?.getBoundingClientRect();
      const bottom = frame?.bottom ?? reference.bottom;
      const intake = pane.current?.querySelector('.staging-intake')?.getBoundingClientRect();
      const limit = (intake?.top || bounds.bottom) - 12;
      control.style.left = Math.max(bounds.left + 12, Math.min(bounds.right - control.offsetWidth - 12, (left + right - control.offsetWidth) / 2)) + 'px';
      control.style.top = Math.max(bounds.top + 8, Math.min(limit - control.offsetHeight, bottom + 8)) + 'px';
    };
    place(); const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current); if (pane.current) observer.observe(pane.current);
    const frame = previews.current?.querySelector('.board-preview-frame'); if (frame) observer.observe(frame);
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, moves, zoom, notice, loading, includeOtherStashes]);

  return <>
    <button ref={button} type="button" className="similar-image-add" aria-label="Show related image suggestions"
      title="Preview related images beside this image" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); show(event.detail === 0); }}>
      <Plus size={20} aria-hidden="true" />
    </button>
    {open && <BoardImagePreviews host={canvasHost} previewRef={previews} moves={visibleMoves} images={images} urls={urls}
      thumbnails={thumbnailCache} categoryNames={categoryNames} label="Previewed suggestions" />}
    {open && portal && createPortal(<section ref={panel} id={id} role="region" aria-label="Similar image suggestions" className="board-suggestions"
      aria-busy={loading || adding} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <div className="board-suggestions__controls">
        <select aria-label="Suggestion method" value={choice} disabled={disabled || adding} title={similarityCopy[choice].explanation}
          onChange={event => { const next = event.currentTarget.value as SimilarityMethod; latest.current.onMethod(next); void load(next, count); }}>
          {clipEnabled && <option value="clip">Subject</option>}<option value="color">Color</option>
        </select>
        <select aria-label="Number of suggestions" value={count} title="Number of suggestions" disabled={disabled || adding}
          onChange={event => { const amount = Number(event.currentTarget.value); setCount(amount); void load(choice, amount); }}>
          {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
        </select>
        <button type="button" className="board-suggestions__accept" disabled={disabled || loading || adding || !visibleMoves.length} onClick={() => void accept()}>
          {loading || adding ? <LoaderCircle size={16} className="is-spinning" /> : <Plus size={17} />}{loading ? 'Finding…' : visibleMoves.length === 1 ? verb + ' this' : visibleMoves.length ? verb + ' these ' + visibleMoves.length : 'No suggestions'}
        </button>
        <button type="button" className="board-suggestions__close" aria-label="Close similar image suggestions" title="Dismiss suggestions" disabled={adding} onClick={() => close(true)}><X size={16} /></button>
      </div>
      {action === 'move' && <label className="board-suggestions__scope"><input type="checkbox" checked={includeOtherStashes} disabled={adding || disabled}
        onChange={event => onIncludeOtherStashes(event.target.checked)} />Include other folders
        {includeOtherStashes && <span title={'Matches move from their current folders into ' + destination}>Moves to {destination}</span>}
      </label>}
      {(loading || notice) && <p role="status" className="board-suggestions__notice">{loading ? 'Finding related images…' : notice}
        {!loading && <button type="button" disabled={disabled} onClick={() => { cache.current.clear(); void load(choice, count); }}>Try again</button>}
      </p>}
    </section>, portal)}
  </>;
}
