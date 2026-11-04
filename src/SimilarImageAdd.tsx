import * as React from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, Plus, X } from 'lucide-react';
import { useStableCallback } from './useStableCallback';
import { useThumbnailUrls } from './useThumbnailUrls';
import type { ImageThumbnailCache } from './imageThumbnails';
import type { SimilarMatch } from './imageAnalysis';
import type { LibraryImage } from './libraryStore';
import type { BoardBounds } from './pileLayout';
import type { BoardMove } from './useImageIntake';
import { placeSuggestionGroup } from './similarityLayout';
import { fitBoardView } from './stashView';
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
  onFrame: (view: { x: number; y: number; zoom: number }) => void;
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
      const current = latest.current, bounds = current.pane.current?.getBoundingClientRect();
      const canvas = current.board.current?.querySelector('[data-testid="board-canvas"]')?.getBoundingClientRect();
      if (!bounds || !canvas) return;
      const plan = placeSuggestionGroup(result.map(match => match.id), current.referenceId, current.positions, current.groups,
        Math.max(2, Math.min(amount + 1, Math.floor((bounds.width - 48) / 192))));
      setMatches(result); setMoves(plan); current.onThumbnails(result.map(match => match.id));
      if (!result.length) { cache.current.delete(cacheKey); setNotice('No images available in this search.'); return; }
      const reference = current.positions.get(current.referenceId);
      const items = [...(reference ? [reference] : []), ...plan].map(point => ({ ...point, width: 172, height: 172 }));
      const bottomSpace = (current.scopeId === null ? 64 : 0) + (current.action === 'move' ? 100 : 68);
      const fits = items.every(item => canvas.left + item.x * current.zoom >= bounds.left + 16
        && canvas.left + (item.x + 172) * current.zoom <= bounds.right - 16
        && canvas.top + item.y * current.zoom >= bounds.top + 16
        && canvas.top + (item.y + 172) * current.zoom <= bounds.bottom - bottomSpace - 24);
      // Only opening/changing the preview may frame it. Accepting never does.
      if (!fits) current.onFrame(fitBoardView(items, bounds.width, bounds.height, bottomSpace));
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
    committing.current = true; setAdding(true);
    try {
      const saved = await latest.current.onAdd(choice, visibleMatches, visibleMoves);
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
  useThumbnailUrls(thumbnailCache, visibleMoves.map(move => move.id));
  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = pane.current?.getBoundingClientRect(), control = panel.current;
      const reference = button.current?.closest('.card')?.getBoundingClientRect();
      if (!bounds || !control || !reference) return;
      const cells = Array.from(previews.current?.querySelectorAll<HTMLElement>('[data-suggestion-preview]') || []).map(cell => cell.getBoundingClientRect());
      const left = cells.length ? Math.min(...cells.map(cell => cell.left)) : reference.left;
      const right = cells.length ? Math.max(...cells.map(cell => cell.right)) : reference.right;
      const bottom = Math.max(reference.bottom, ...cells.map(cell => cell.bottom));
      const intake = pane.current?.querySelector('.staging-intake')?.getBoundingClientRect();
      const limit = (intake?.top || bounds.bottom) - 12;
      control.style.left = Math.max(bounds.left + 12, Math.min(bounds.right - control.offsetWidth - 12, (left + right - control.offsetWidth) / 2)) + 'px';
      control.style.top = Math.max(bounds.top + 8, Math.min(limit - control.offsetHeight, bottom + 12)) + 'px';
    };
    place(); const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current); if (pane.current) observer.observe(pane.current);
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, moves, zoom, notice, loading, includeOtherStashes]);

  return <>
    <button ref={button} type="button" className="similar-image-add" aria-label="Show related image suggestions"
      title="Preview related images beside this image" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); show(event.detail === 0); }}>
      <Plus size={20} aria-hidden="true" />
    </button>
    {open && canvasHost && createPortal(<div ref={previews} className="board-suggestions__previews" role="group" aria-label="Previewed suggestions">
      {visibleMoves.map(move => {
        const image = images.get(move.id), source = categoryNames.get(image?.categoryId || '');
        return <figure key={move.id} className="board-suggestion" data-suggestion-preview={move.id} data-testid={'suggestion-' + move.id}
          style={{ left: move.x, top: move.y }} aria-label={'Suggestion: ' + image?.path} title={image?.path}
          onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
          {urls.get(move.id) ? <img src={urls.get(move.id)} alt={image?.path || 'Suggested image'} draggable={false} onLoad={event => {
            const image = event.currentTarget, cell = image.parentElement;
            if (!cell || !image.naturalWidth || !image.naturalHeight) return;
            const scale = Math.min(172 / image.naturalWidth, 172 / image.naturalHeight);
            cell.style.setProperty('--preview-width', image.naturalWidth * scale + 'px');
            cell.style.setProperty('--preview-height', image.naturalHeight * scale + 'px');
          }} /> : <LoaderCircle className="is-spinning" size={20} />}
          {source && <figcaption title={'Move from ' + source}>From {source.split('/').at(-1)}</figcaption>}
        </figure>;
      })}
    </div>, canvasHost)}
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
