import * as React from 'react';
import { createPortal } from 'react-dom';
import { FolderInput, LoaderCircle, Palette, Plus, ScanSearch, Sparkles, X } from 'lucide-react';
import { useThumbnailUrls } from './useThumbnailUrls';
import type { ImageThumbnailCache } from './imageThumbnails';
import type { SimilarMatch } from './imageAnalysis';
import type { LibraryImage } from './libraryStore';

export type SimilarityMethod = 'clip' | 'color';
const labels = { clip: 'content', color: 'color' };

/** One small board affordance; its popover stays readable at any board zoom. */
export default function SimilarImageAdd({ method, clipEnabled, contentRevision, queryKey, action, destination, categoryNames, includeOtherStashes, onIncludeOtherStashes, count = 3, disabled, images, urls, thumbnailCache, portal, onPreview, onAdd, onMethod, onThumbnails }: {
  queryKey: string; action: 'reveal' | 'move' | 'add'; destination: string; categoryNames: Map<string, string>;
  includeOtherStashes: boolean; onIncludeOtherStashes: (include: boolean) => void;
  thumbnailCache?: ImageThumbnailCache;
  count?: number; clipEnabled: boolean; contentRevision: number;
  method: SimilarityMethod; disabled: boolean; images: Map<string, LibraryImage>; urls: Map<string, string>;
  portal: HTMLElement | null; onPreview: (method: SimilarityMethod) => Promise<SimilarMatch[]>;
  onAdd: (method: SimilarityMethod, matches: SimilarMatch[]) => Promise<void>;
  onMethod: (method: SimilarityMethod) => void; onThumbnails: (ids: string[]) => void;
}) {
  const button = React.useRef<HTMLButtonElement>(null), panel = React.useRef<HTMLDivElement>(null);
  const callbacks = React.useRef({ onPreview, onAdd, onMethod, onThumbnails, method });
  callbacks.current = { onPreview, onAdd, onMethod, onThumbnails, method };
  const cache = React.useRef(new Map<SimilarityMethod, Promise<SimilarMatch[]>>());
  const active = React.useRef(true), request = React.useRef(0), hide = React.useRef<number>();
  const tapToOpen = React.useRef(false), skipFocus = React.useRef(false);
  const touchMode = React.useRef(false);
  const adding = React.useRef<SimilarityMethod | null>(null), addRequest = React.useRef(0);
  const [open, setOpen] = React.useState(false), [loading, setLoading] = React.useState(false);
  const [matches, setMatches] = React.useState<SimilarMatch[]>([]), [notice, setNotice] = React.useState('');
  const [previewMethod, setPreviewMethod] = React.useState(method);
  const [position, setPosition] = React.useState({ left: 12, top: 12 });
  const id = React.useId();
  const verb = action === 'reveal' ? 'Find' : action === 'add' ? 'Add' : 'Move';
  const ActionIcon = action === 'reveal' ? ScanSearch : action === 'add' ? Plus : FolderInput;
  React.useEffect(() => { active.current = true; return () => { active.current = false; window.clearTimeout(hide.current); callbacks.current.onThumbnails([]); }; }, []);

  const load = async (choice: SimilarityMethod) => {
    if (choice === 'clip' && !clipEnabled) return [];
    const token = ++request.current;
    setPreviewMethod(choice); setNotice(''); setMatches([]);
    setLoading(true);
    let pending = cache.current.get(choice);
    if (!pending) { pending = callbacks.current.onPreview(choice); cache.current.set(choice, pending); }
    try {
      const result = await pending;
      if (active.current && token === request.current) {
        setMatches(result); callbacks.current.onThumbnails(result.map(match => match.id));
        setNotice(result.length ? '' : choice === 'clip' ? 'No indexed matches in this search yet.' : 'No matches in this search.');
      }
      // An empty partial index can gain matches on the next visit.
      if (!result.length) cache.current.delete(choice);
      return result;
    } catch (cause) {
      cache.current.delete(choice);
      if (active.current && token === request.current) setNotice(cause instanceof Error ? cause.message : 'Could not find matches. Try again.');
      throw cause;
    } finally { if (active.current && token === request.current) setLoading(false); }
  };
  const reveal = () => { window.clearTimeout(hide.current); setOpen(true); void load(callbacks.current.method).catch(() => {}); };
  const dismiss = () => { if (!touchMode.current) hide.current = window.setTimeout(() => setOpen(false), 160); };
  const add = async (choice: SimilarityMethod) => {
    if (disabled || choice === 'clip' && !clipEnabled || adding.current === choice) return;
    const token = ++addRequest.current;
    adding.current = choice;
    callbacks.current.onMethod(choice);
    try {
      const result = await load(choice);
      if (active.current && token === addRequest.current) { await callbacks.current.onAdd(choice, result); setOpen(false); }
    } catch { /* The preview already explains failure; keep it open for retry. */ }
    finally { if (token === addRequest.current) adding.current = null; }
  };

  React.useEffect(() => {
    cache.current.delete('clip');
    if (open && previewMethod === 'clip') void load('clip').catch(() => {});
  }, [contentRevision]);
  React.useEffect(() => {
    cache.current.clear(); request.current++; addRequest.current++; adding.current = null;
    if (open) void load(callbacks.current.method).catch(() => {});
  }, [queryKey]);

  useThumbnailUrls(thumbnailCache, matches.map(match => match.id));
  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = button.current?.getBoundingClientRect(), popover = panel.current?.getBoundingClientRect();
      if (!anchor || !popover) return;
      const rightFits = anchor.right + popover.width + 20 <= innerWidth;
      const leftFits = anchor.left - popover.width - 20 >= 0;
      const left = rightFits ? anchor.right + 8 : leftFits ? anchor.left - popover.width - 8 : anchor.left;
      // On a phone, place it above/below the + so the next tap remains reachable.
      const top = rightFits || leftFits ? anchor.top - 42 : anchor.top >= popover.height + 20
        ? anchor.top - popover.height - 8 : anchor.bottom + 8;
      const next = { left: Math.max(12, Math.min(innerWidth - popover.width - 12, left)), top: Math.max(12, Math.min(innerHeight - popover.height - 12, top)) };
      setPosition(current => current.left === next.left && current.top === next.top ? current : next);
    };
    place(); const observer = new ResizeObserver(place); if (panel.current) observer.observe(panel.current);
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, method]);
  React.useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !button.current?.contains(event.target) && !panel.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const stopKeys = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); skipFocus.current = true; button.current?.focus({ preventScroll: true }); }
  };

  return <>
    <button ref={button} type="button" className="similar-image-add" aria-label="Find similar to selected image"
      title={action === 'reveal' ? `Find similar images by ${labels[method]}` : `${verb} similar images ${action === 'add' ? 'to' : 'into'} ${destination}`} aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      onPointerDown={event => { event.stopPropagation(); touchMode.current = event.pointerType === 'touch'; tapToOpen.current = touchMode.current && !open; }}
      onMouseEnter={reveal} onMouseLeave={dismiss} onFocus={() => { if (skipFocus.current) skipFocus.current = false; else reveal(); }}
      onKeyDown={stopKeys} onClick={event => { event.stopPropagation(); if (tapToOpen.current) { tapToOpen.current = false; reveal(); } else void add(method); }}>
      {loading ? <LoaderCircle size={17} className="is-spinning" /> : <ActionIcon size={20} />}
    </button>
    {open && portal && createPortal(<div ref={panel} id={id} role="region" aria-label="Similar image suggestions"
      className="similar-image-popover" style={position} onMouseEnter={() => window.clearTimeout(hide.current)} onMouseLeave={dismiss}
      onPointerDown={event => { event.stopPropagation(); touchMode.current = event.pointerType === 'touch'; }} onClick={event => event.stopPropagation()} onKeyDown={stopKeys}
      onBlur={event => { if (!panel.current?.contains(event.relatedTarget as Node) && event.relatedTarget !== button.current) setOpen(false); }}>
      <header><strong>{action === 'reveal' ? 'Find similar images' : `${verb} ${matches.length || count} images to ${destination}`}</strong><button type="button" aria-label="Close similar image suggestions" onClick={() => { setOpen(false); skipFocus.current = true; button.current?.focus({ preventScroll: true }); }}><X size={15} /></button></header>
      <div className="similar-image-popover__previews" aria-label={`${labels[previewMethod]} match previews`} aria-busy={loading}>
        {matches.map(match => <span key={match.id} title={images.get(match.id)?.path}>
          {urls.get(match.id) ? <img src={urls.get(match.id)} alt={images.get(match.id)?.path || 'Similar image'} draggable={false} /> : <LoaderCircle size={17} className="is-spinning" />}
          {action !== 'reveal' && <small title={categoryNames.get(images.get(match.id)?.categoryId || '') || 'Root · Unsorted'}>{categoryNames.get(images.get(match.id)?.categoryId || '')?.split('/').at(-1) || 'Unsorted'}</small>}
        </span>)}
        {!matches.length && <span className="similar-image-popover__empty">{loading ? <><LoaderCircle size={17} className="is-spinning" />Finding matches…</> : notice}</span>}
      </div>
      <small role="status">{matches.length ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'} · ${labels[previewMethod]}` : 'Similar images'}</small>
      {action === 'move' && <label className="similar-image-popover__scope"><input type="checkbox" checked={includeOtherStashes} onChange={event => onIncludeOtherStashes(event.target.checked)} />Include other stashes</label>}
      <div className="similar-image-popover__methods">
        {(['clip', 'color'] as const).filter(choice => clipEnabled || choice !== 'clip').map(choice => <button key={choice} type="button" disabled={disabled}
          aria-label={`${verb} similar images ${choice === 'clip' ? 'with CLIP' : 'by color'}`}
          onMouseEnter={() => void load(choice).catch(() => {})} onFocus={() => void load(choice).catch(() => {})} onClick={() => void add(choice)}>
          {choice === 'clip' ? <Sparkles size={16} /> : <Palette size={16} />}
          <span>{choice === 'clip' ? `${verb} by content` : `${verb} by color`}</span><ActionIcon size={14} />
        </button>)}
      </div>
    </div>, portal)}
  </>;
}
