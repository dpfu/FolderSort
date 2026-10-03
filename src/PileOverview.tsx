import * as React from 'react';
import { ArrowDownUp, ArrowLeft, ArrowRight, Check, CheckCheck, ChevronLeft, ChevronRight, Image as ImageIcon, LayoutGrid, Layers3, Minus, Plus, Search, Shuffle, SlidersHorizontal, X, ZoomIn } from 'lucide-react';
import { getImageBlob, imageIsOnBoard, type LibraryCategory, type LibraryImage } from './libraryStore';
import type { PileOrder } from './imageAnalysis';
import { type ImageThumbnailCache, useThumbnails } from './imageThumbnails';
import { PileOrderOptions } from './PileOrderOptions';
import { pileGeometry, pileJitter, visiblePileRange, type PileLayout } from './pileLayout';
import './pile-overview.css';

type Props = {
  open: boolean;
  images: LibraryImage[];
  categories: LibraryCategory[];
  thumbnails: ImageThumbnailCache;
  order: PileOrder;
  reversed: boolean;
  preparing: boolean;
  busy: boolean;
  status: string;
  error: string;
  indexAction?: React.ReactNode;
  onOrder: (order: PileOrder) => void;
  onReverse: () => void;
  onShuffle: () => void;
  onClose: () => void;
  onAdd: (ids: string[]) => void;
  onInteracting: (active: boolean) => void;
};

const OverviewImage = React.memo(function OverviewImage({ image, index, x, y, size, layout, selected, category, url, failed, focused, onMark, onPreview, onNavigate, onFocus }: {
  image: LibraryImage; index: number; x: number; y: number; size: number; layout: PileLayout;
  selected: boolean; category?: string; url?: string; failed: boolean; focused: boolean;
  onMark: (id: string, range: boolean) => void; onPreview: (id: string) => void;
  onNavigate: (index: number, key: string) => void; onFocus: (id: string) => void;
}) {
  const board = imageIsOnBoard(image), name = image.path.split('/').at(-1)!;
  const jitter = layout === 'mess' ? pileJitter(image.id) : { x: 0, y: 0, angle: 0 };
  return <div className={`pile-overview__tile${selected ? ' is-marked' : ''}${board ? ' is-on-board' : ''}`} data-overview-image={image.id}
    style={{ left: x + jitter.x, top: y + jitter.y, width: size, height: size, '--image-angle': `${jitter.angle}deg` } as React.CSSProperties}>
    <button className="pile-overview__image" type="button" role={board ? undefined : 'checkbox'} aria-checked={board ? undefined : selected}
      aria-label={board ? `View ${name}, on board` : `Mark ${name}`} title={`${image.path}${category ? ` · ${category}` : ''}${board ? ' · On board' : ''}`}
      tabIndex={focused ? 0 : -1} data-image-focus={image.id}
      onFocus={() => onFocus(image.id)} onClick={event => { if (board) onPreview(image.id); else if (event.detail < 2) onMark(image.id, event.shiftKey); }}
      onDoubleClick={() => onPreview(image.id)} onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
          event.preventDefault(); onNavigate(index, event.key);
        } else if (event.key === 'Enter') { event.preventDefault(); onPreview(image.id); }
      }}>
      {url ? <img src={url} alt="" draggable={false} decoding="async" onLoad={event => {
        const image = event.currentTarget, ratio = image.naturalWidth / image.naturalHeight;
        image.parentElement!.style.setProperty('--photo-width', `${ratio < 1 ? ratio * 100 : 100}%`);
        image.parentElement!.style.setProperty('--photo-height', `${ratio > 1 ? 100 / ratio : 100}%`);
      }} /> : <span className="pile-overview__placeholder"><ImageIcon size={24} /><small>{failed ? 'Preview unavailable' : name}</small></span>}
      <span className="pile-overview__mark" aria-hidden="true">{board ? <Layers3 size={13} /> : selected ? <Check size={15} strokeWidth={3} /> : <Plus size={14} />}</span>
      {category && <span className="pile-overview__category" title={category}>{category.split('/').at(-1)}</span>}
    </button>
    <button className="pile-overview__inspect" type="button" tabIndex={focused ? 0 : -1} aria-label={`View ${name}`} title="View image"
      onClick={() => onPreview(image.id)}><ZoomIn size={15} /></button>
    <span className="pile-overview__filename" aria-hidden="true">{board ? 'On board · ' : ''}{name}</span>
  </div>;
});

function OverviewPreview({ image, marked, category, index, total, onMark, onMove, onClose }: {
  image: LibraryImage; marked: boolean; category?: string; index: number; total: number;
  onMark: () => void; onMove: (direction: number) => void; onClose: () => void;
}) {
  const [url, setUrl] = React.useState('');
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let active = true, objectUrl = '';
    setUrl(''); setFailed(false);
    void getImageBlob(image.id).then(blob => {
      if (!active) return;
      if (!blob) { setFailed(true); return; }
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image.id]);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const previewRef = React.useRef<HTMLElement>(null);
  React.useLayoutEffect(() => {
    const root = previewRef.current!;
    const siblings = [...root.parentElement!.children].filter(element => element !== root) as HTMLElement[];
    const previous = siblings.map(element => ({ element, inert: element.inert, hidden: element.getAttribute('aria-hidden') }));
    siblings.forEach(element => { element.inert = true; element.setAttribute('aria-hidden', 'true'); });
    closeRef.current?.focus();
    return () => { previous.forEach(({ element, inert, hidden }) => { element.inert = inert; if (hidden === null) element.removeAttribute('aria-hidden'); else element.setAttribute('aria-hidden', hidden); }); };
  }, []);
  return <section ref={previewRef} className="pile-overview__preview" role="dialog" aria-modal="true" aria-label={`Preview ${image.path}`}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); onMove(event.key === 'ArrowLeft' ? -1 : 1); }
      if (event.key === ' ' && event.target === event.currentTarget) { event.preventDefault(); onMark(); }
    }}>
    <header><div><strong>{image.path.split('/').at(-1)}</strong><small>{category || 'Unassigned'}{imageIsOnBoard(image) ? ' · On board' : ''}</small></div>
      <button ref={closeRef} type="button" aria-label="Close preview" onClick={onClose}><X size={21} /></button></header>
    <div className="pile-overview__preview-image">{url && !failed ? <img src={url} alt={image.path} onError={() => setFailed(true)} /> : <p>{failed ? 'This image cannot be previewed in this browser.' : 'Loading original…'}</p>}</div>
    <footer><div className="pile-overview__preview-nav"><button type="button" disabled={index <= 0} aria-label="Previous image" onClick={() => onMove(-1)}><ChevronLeft size={22} /></button><span>{index + 1} / {total}</span><button type="button" disabled={index >= total - 1} aria-label="Next image" onClick={() => onMove(1)}><ChevronRight size={22} /></button></div>
      <button type="button" className="pile-overview__primary" disabled={imageIsOnBoard(image)} aria-pressed={marked} onClick={onMark}>{imageIsOnBoard(image) ? <Layers3 size={17} /> : <Check size={18} />}{imageIsOnBoard(image) ? 'Already on board' : marked ? 'Marked for board' : 'Mark for board'}</button></footer>
  </section>;
}

export default function PileOverview({ open, images, categories, thumbnails, order, reversed, preparing, busy, status, error, indexAction, onOrder, onReverse, onShuffle, onClose, onAdd, onInteracting }: Props) {
  const rootRef = React.useRef<HTMLElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const backRef = React.useRef<HTMLButtonElement>(null);
  const [layout, setLayout] = React.useState<PileLayout>('mess');
  const [size, setSize] = React.useState(() => window.innerWidth < 700 ? 128 : 160);
  const [scope, setScope] = React.useState<'pile' | 'all' | 'board'>('pile');
  const [category, setCategory] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const query = React.useDeferredValue(search.trim().toLocaleLowerCase());
  const [marked, setMarked] = React.useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = React.useState<string | null>(null);
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const [viewport, setViewport] = React.useState({ top: 0, width: window.innerWidth, height: Math.max(200, window.innerHeight - 240) });
  const anchorRef = React.useRef<string | null>(null);
  const focusPending = React.useRef<string | null>(null);
  const sizeAnchor = React.useRef<{ id: string; offset: number } | null>(null);
  const viewRef = React.useRef(viewport);
  viewRef.current = viewport;
  const categoryById = React.useMemo(() => new Map(categories.map(item => [item.id, item.name])), [categories]);
  const filtered = React.useMemo(() => images.filter(image => {
    if (scope === 'pile' && imageIsOnBoard(image) || scope === 'board' && !imageIsOnBoard(image)) return false;
    const code = image.categoryId ? categoryById.get(image.categoryId) || '' : '';
    if (category === 'unassigned' && image.categoryId || category === 'coded' && !image.categoryId) return false;
    if (!['all', 'unassigned', 'coded'].includes(category)) {
      const branch = categoryById.get(category);
      if (!branch || code !== branch && !code.startsWith(`${branch}/`)) return false;
    }
    return !query || image.path.toLocaleLowerCase().includes(query) || code.toLocaleLowerCase().includes(query);
  }), [images, scope, category, query, categoryById]);
  const geometry = React.useMemo(() => pileGeometry(viewport.width, size, layout, filtered.length), [viewport.width, size, layout, filtered.length]);
  const geometryRef = React.useRef(geometry), filteredRef = React.useRef(filtered);
  geometryRef.current = geometry; filteredRef.current = filtered;
  const indices = React.useMemo(() => new Map(filtered.map((image, index) => [image.id, index])), [filtered]);
  const eligible = React.useMemo(() => filtered.filter(image => !imageIsOnBoard(image)), [filtered]);
  const selected = React.useMemo(() => images.filter(image => marked.has(image.id) && !imageIsOnBoard(image)), [images, marked]);
  const selectedVisible = selected.filter(image => indices.has(image.id)).length;
  const range = visiblePileRange(filtered.length, geometry, viewport.top, viewport.height);
  const visibleIndices = Array.from({ length: range.end - range.first }, (_, index) => index + range.first);
  const focusedIndex = focusedId ? indices.get(focusedId) : undefined;
  if (focusedIndex !== undefined && (focusedIndex < range.first || focusedIndex >= range.end)) visibleIndices.push(focusedIndex);
  // Load the actual viewport first; overscan can follow while the user explores.
  const middle = (viewport.top + viewport.height / 2 - geometry.padding) / geometry.rowHeight * geometry.columns;
  const wanted = open ? previewId ? [previewId] : [...visibleIndices].sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle)).map(index => filtered[index].id) : [];
  useThumbnails(thumbnails, wanted, open);

  React.useEffect(() => { if (!open) setPreviewId(null); }, [open]);

  React.useEffect(() => {
    const available = new Set(images.filter(image => !imageIsOnBoard(image)).map(image => image.id));
    setMarked(current => {
      if ([...current].every(id => available.has(id))) return current;
      return new Set([...current].filter(id => available.has(id)));
    });
  }, [images]);

  React.useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const root = rootRef.current!;
    const siblings = [...root.parentElement!.children].filter(element => element !== root) as HTMLElement[];
    const previous = siblings.map(element => ({ element, inert: element.inert, hidden: element.getAttribute('aria-hidden') }));
    siblings.forEach(element => { element.inert = true; element.setAttribute('aria-hidden', 'true'); });
    backRef.current?.focus({ preventScroll: true });
    return () => {
      previous.forEach(({ element, inert, hidden }) => { element.inert = inert; if (hidden === null) element.removeAttribute('aria-hidden'); else element.setAttribute('aria-hidden', hidden); });
      opener?.focus({ preventScroll: true });
    };
  }, [open]);

  React.useLayoutEffect(() => {
    if (!open || !scrollRef.current) return;
    scrollRef.current.scrollTop = viewRef.current.top;
    const element = scrollRef.current;
    let frame: number | null = null, idle: number | undefined;
    const update = () => {
      frame = null;
      const next = { top: element.scrollTop, width: element.clientWidth, height: element.clientHeight };
      if (next.width !== viewRef.current.width && !sizeAnchor.current) {
        const previous = geometryRef.current;
        const row = Math.max(0, Math.floor((viewRef.current.top - previous.padding) / previous.rowHeight));
        const image = filteredRef.current[row * previous.columns];
        if (image) sizeAnchor.current = { id: image.id, offset: Math.max(0, viewRef.current.top - previous.padding - row * previous.rowHeight) };
      }
      setViewport(current => current.top === next.top && current.width === next.width && current.height === next.height ? current : next);
    };
    const scroll = () => {
      onInteracting(true);
      clearTimeout(idle); idle = window.setTimeout(() => onInteracting(false), 160);
      if (frame === null) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(update);
    observer.observe(element); element.addEventListener('scroll', scroll, { passive: true }); update();
    return () => { observer.disconnect(); element.removeEventListener('scroll', scroll); if (frame !== null) cancelAnimationFrame(frame); clearTimeout(idle); onInteracting(false); };
  }, [open, onInteracting]);

  // Changing density keeps the image at the top in place instead of jumping to
  // a different part of the collection. A new order/filter begins at the top.
  React.useLayoutEffect(() => {
    if (!open || !scrollRef.current) return;
    const anchor = sizeAnchor.current;
    if (anchor) {
      const index = indices.get(anchor.id);
      if (index !== undefined) scrollRef.current.scrollTop = geometry.padding + Math.floor(index / geometry.columns) * geometry.rowHeight + anchor.offset;
      sizeAnchor.current = null;
    }
  }, [open, geometry, indices]);
  React.useLayoutEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scope, category, query, order, reversed]);
  React.useLayoutEffect(() => {
    const id = focusPending.current;
    if (!id || !open) return;
    const element = [...rootRef.current!.querySelectorAll<HTMLElement>('[data-image-focus]')].find(element => element.dataset.imageFocus === id);
    if (element) { focusPending.current = null; element.focus({ preventScroll: true }); }
  });

  const mark = React.useCallback((id: string, range: boolean) => {
    const image = images.find(image => image.id === id);
    if (!image || imageIsOnBoard(image)) return;
    const last = anchorRef.current ? indices.get(anchorRef.current) : undefined, index = indices.get(id);
    setMarked(current => {
      const next = new Set(current);
      if (range && index !== undefined && last !== undefined) {
        for (const image of filtered.slice(Math.min(last, index), Math.max(last, index) + 1)) if (!imageIsOnBoard(image)) next.add(image.id);
      } else if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    anchorRef.current = id; setFocusedId(id);
  }, [images, filtered, indices]);
  const preview = React.useCallback((id: string) => setPreviewId(id), []);
  const focus = React.useCallback((id: string) => setFocusedId(id), []);
  const navigate = React.useCallback((index: number, key: string) => {
    const page = Math.max(1, Math.floor(viewport.height / geometry.rowHeight)) * geometry.columns;
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -geometry.columns, ArrowDown: geometry.columns, PageUp: -page, PageDown: page };
    const nextIndex = Math.max(0, Math.min(filtered.length - 1, key === 'Home' ? 0 : key === 'End' ? filtered.length - 1 : index + offsets[key]));
    const image = filtered[nextIndex];
    if (!image) return;
    const top = geometry.padding + Math.floor(nextIndex / geometry.columns) * geometry.rowHeight;
    const scroll = scrollRef.current!;
    if (top < scroll.scrollTop + 12) scroll.scrollTop = Math.max(0, top - 18);
    else if (top + size + 24 > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = top + size + 42 - scroll.clientHeight;
    focusPending.current = image.id; setFocusedId(image.id);
  }, [filtered, geometry, viewport.height, size]);

  const changeDensity = (nextSize: number, nextLayout = layout) => {
    const index = Math.min(filtered.length - 1, Math.max(0, Math.floor((viewport.top - geometry.padding) / geometry.rowHeight)) * geometry.columns);
    if (filtered[index]) sizeAnchor.current = { id: filtered[index].id, offset: Math.max(0, viewport.top - geometry.padding - Math.floor(index / geometry.columns) * geometry.rowHeight) };
    setSize(Math.max(88, Math.min(280, nextSize))); setLayout(nextLayout);
  };
  const selectAll = () => setMarked(current => new Set([...current, ...eligible.map(image => image.id)]));
  const add = () => { if (selected.length && !busy) onAdd(selected.map(image => image.id)); };
  const previewImage = previewId ? filtered.find(image => image.id === previewId) : undefined;
  const previewIndex = previewImage ? indices.get(previewImage.id)! : -1;
  const closePreview = () => {
    if (previewImage) { focusPending.current = previewImage.id; setFocusedId(previewImage.id); }
    setPreviewId(null);
  };
  if (!open) return null;
  const firstVisible = Math.min(filtered.length, Math.max(0, Math.floor((viewport.top - geometry.padding) / geometry.rowHeight)) * geometry.columns + 1);
  const lastVisible = Math.min(filtered.length, Math.ceil((viewport.top + viewport.height - geometry.padding) / geometry.rowHeight) * geometry.columns);
  const scrollMax = Math.max(0, geometry.height - viewport.height);

  return <section className={`pile-overview${filtersOpen ? ' pile-overview--filters-open' : ''}`} ref={rootRef} role="dialog" aria-modal="true" aria-label="Explore image pile" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); selectAll(); }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); add(); }
    if (event.key === 'Tab') {
      const surface = previewImage ? rootRef.current!.querySelector('.pile-overview__preview')! : rootRef.current!;
      const controls = [...surface.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]')].filter(element => {
        if (element.tabIndex < 0) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
      });
      if (event.shiftKey && event.target === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && event.target === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }
  }}>
    <header className="pile-overview__header">
      <button ref={backRef} className="pile-overview__back" type="button" aria-label="Back to sorting board" onClick={onClose}><ArrowLeft size={20} /><span>Board</span></button>
      <div className="pile-overview__title"><h2>Explore the pile</h2><span>{images.filter(image => !imageIsOnBoard(image)).length.toLocaleString()} in pile · {images.length.toLocaleString()} in project</span></div>
      <button className={`pile-overview__filter-toggle${search || category !== 'all' || scope !== 'pile' ? ' is-filtered' : ''}`} type="button" aria-label={filtersOpen ? 'Hide overview filters' : 'Show overview filters'} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(value => !value)}><SlidersHorizontal size={17} /></button>
      <div className="pile-overview__layout" role="group" aria-label="Overview layout">
        <button type="button" aria-label="Mess layout" aria-pressed={layout === 'mess'} onClick={() => changeDensity(size, 'mess')}><Layers3 size={17} /><span>Mess</span></button>
        <button type="button" aria-label="Grid layout" aria-pressed={layout === 'grid'} onClick={() => changeDensity(size, 'grid')}><LayoutGrid size={17} /><span>Grid</span></button>
      </div>
    </header>
    <div className="pile-overview__controls">
      <div className="pile-overview__filters">
        <label className="pile-overview__search"><Search size={17} /><input type="search" aria-label="Find images" placeholder="Find a filename or category…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')}><X size={15} /></button>}</label>
        <select aria-label="Overview category filter" value={category} onChange={event => setCategory(event.target.value)}><option value="all">All categories</option><option value="unassigned">Unassigned</option><option value="coded">Categorized</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
        <select aria-label="Overview image scope" value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="pile">In the pile</option><option value="all">All images</option><option value="board">On the board</option></select>
      </div>
      <div className="pile-overview__tools">
        <label className="pile-overview__order">Order <select aria-label="Overview order" value={order} onChange={event => onOrder(event.target.value as PileOrder)}><PileOrderOptions /></select></label>
        <button type="button" className="pile-overview__icon" aria-label="Reverse overview order" title="Reverse order" disabled={order === 'random' || preparing} aria-pressed={reversed} onClick={onReverse}><ArrowDownUp size={17} /></button>
        <button type="button" className="pile-overview__shuffle" aria-label="Shuffle overview" disabled={images.length < 2} onClick={() => { scrollRef.current?.scrollTo({ top: 0 }); onShuffle(); }}><Shuffle size={17} /><span>Shuffle</span></button>
        <div className="pile-overview__density"><span>Image size</span><button type="button" aria-label="Smaller overview images" disabled={size <= 88} onClick={() => changeDensity(size - 24)}><Minus size={16} /></button><input type="range" aria-label="Overview image size" min={88} max={280} step={8} value={size} onChange={event => changeDensity(Number(event.target.value))} /><button type="button" aria-label="Larger overview images" disabled={size >= 280} onClick={() => changeDensity(size + 24)}><Plus size={16} /></button></div>
      </div>
    </div>
    <div className="pile-overview__context"><span>Scroll to explore. Click to mark; double-click to view.</span><div><span role="status">{error || status || `${filtered.length.toLocaleString()} ${filtered.length === 1 ? 'image' : 'images'}${query || category !== 'all' ? ' matching' : ''}`}</span>{indexAction}</div></div>
    <div className="pile-overview__scroll" ref={scrollRef} role="region" aria-label="Image overview" tabIndex={0}>
      <div className={`pile-overview__canvas pile-overview__canvas--${layout}`} style={{ height: geometry.height }}>
        {visibleIndices.map(index => {
          const image = filtered[index];
          return <OverviewImage key={image.id} image={image} index={index} size={size} layout={layout}
            x={geometry.padding + index % geometry.columns * geometry.columnWidth + (geometry.columnWidth - size) / 2}
            y={geometry.padding + Math.floor(index / geometry.columns) * geometry.rowHeight}
            selected={marked.has(image.id)} focused={focusedId ? focusedId === image.id : index === 0}
            category={image.categoryId ? categoryById.get(image.categoryId) : undefined} url={thumbnails.urls.get(image.id)} failed={thumbnails.failed.has(image.id)}
            onMark={mark} onPreview={preview} onNavigate={navigate} onFocus={focus} />;
        })}
      </div>
      {filtered.length === 0 && <div className="pile-overview__empty"><Layers3 size={34} /><h3>{scope === 'pile' && !query && category === 'all' ? 'The pile is empty' : 'No matching images'}</h3><p>{scope === 'pile' && !query && category === 'all' ? 'Explore the images already on your board.' : 'Try another filename, category, or view.'}</p><button type="button" onClick={() => { setSearch(''); setCategory('all'); setScope('all'); }}>Show all images</button></div>}
    </div>
    <footer className="pile-overview__footer">
      <div className="pile-overview__selection"><span role="status"><CheckCheck size={17} /><strong>{selected.length.toLocaleString()} marked</strong>{selected.length > selectedVisible && <small>{selected.length - selectedVisible} outside this view</small>}</span>
        <div><button type="button" disabled={!eligible.length || eligible.every(image => marked.has(image.id))} onClick={selectAll}>Mark all{query || category !== 'all' ? ' matches' : ''}</button><button type="button" disabled={!selected.length} onClick={() => setMarked(new Set())}>Clear</button></div></div>
      {filtered.length > 0 && <div className="pile-overview__position"><span>{firstVisible.toLocaleString()}–{lastVisible.toLocaleString()} / {filtered.length.toLocaleString()}</span><input type="range" aria-label="Browse image collection" min={0} max={1000} value={scrollMax ? Math.min(1000, Math.round(viewport.top / scrollMax * 1000)) : 0} disabled={!scrollMax} onChange={event => scrollRef.current?.scrollTo({ top: Number(event.target.value) / 1000 * scrollMax })} /></div>}
      <button type="button" className="pile-overview__primary" disabled={!selected.length || busy} onClick={add}><span>Add {selected.length || ''}{selected.length ? ' to board' : 'marked to board'}</span><ArrowRight size={18} /></button>
    </footer>
    {previewImage && <OverviewPreview image={previewImage} marked={marked.has(previewImage.id)} category={previewImage.categoryId ? categoryById.get(previewImage.categoryId) : undefined} index={previewIndex} total={filtered.length}
      onClose={closePreview} onMark={() => mark(previewImage.id, false)} onMove={direction => { const image = filtered[previewIndex + direction]; if (image) setPreviewId(image.id); }} />}
  </section>;
}
