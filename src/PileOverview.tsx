import * as React from 'react';
import { ArrowDownUp, ArrowLeft, Check, CheckCheck, Image as ImageIcon, LayoutGrid, Layers3, Search, Shuffle, Square, SlidersHorizontal, X, ZoomIn } from 'lucide-react';
import { imageIsOnBoard, type LibraryCategory, type LibraryImage } from './libraryStore';
import type { PileOrder } from './imageAnalysis';
import { type ImageThumbnailCache, useThumbnails } from './imageThumbnails';
import { PileOrderOptions } from './PileOrderOptions';
import { pileGeometry, pileJitter, visiblePileRange, type PileLayout } from './pileLayout';
import { categoryColor } from './categoryTree';
import { StashPickerContent } from './StashPicker';
import { imageOnScopeBoard } from './stashBoard';
import './pile-overview.css';
import ImageViewer from './ImageViewer';
import MenuBar from './MenuBar';
import UndoControl, { type UndoView } from './UndoControl';
import { ActionButton } from './UiActions';
import ActionMenu from './ActionMenu';
import './overview-shell.css';

type Props = {
  projectName: string;
  workspaceScope?: string | null;
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
  undo?: UndoView;
  onOrder: (order: PileOrder) => void;
  onReverse: () => void;
  onShuffle: () => void;
  onClose: () => void;
  onAdd: (ids: string[]) => void;
  onInteracting: (active: boolean) => void;
  categoryRequest?: { id: string; revision: number };
  categoryNotice: string;
  onAssign: (ids: string[], categoryId: string | null, name?: string) => Promise<void>;
  onCreateStash: (ids: string[], name: string) => Promise<LibraryCategory>;
};

const OverviewImage = React.memo(function OverviewImage({ image, index, x, y, size, layout, selected, category, url, failed, focused, board, onMark, onPreview, onNavigate, onFocus }: {
  image: LibraryImage; index: number; x: number; y: number; size: number; layout: PileLayout;
  selected: boolean; board: boolean; category?: string; url?: string; failed: boolean; focused: boolean;
  onMark: (id: string, range: boolean) => void; onPreview: (id: string) => void;
  onNavigate: (index: number, key: string) => void; onFocus: (id: string) => void;
}) {
  const name = image.path.split('/').at(-1)!;
  const jitter = layout === 'mess' ? pileJitter(image.id) : { x: 0, y: 0, angle: 0 };
  return <div className={`pile-overview__tile${selected ? ' is-marked' : ''}${board ? ' is-on-board' : ''}`} data-overview-image={image.id}
    style={{ left: x + jitter.x, top: y + jitter.y, width: size, height: size, '--image-angle': `${jitter.angle}deg`, '--category-color': category ? categoryColor(category) : undefined } as React.CSSProperties}>
    <button className={`pile-overview__image${category ? ' is-categorized' : ''}`} type="button" role="checkbox" aria-checked={selected}
      aria-label={`Select ${name}`} title={`${image.path}${category ? ` · ${category}` : ''}${board ? ' · On board' : ''}`}
      tabIndex={focused ? 0 : -1} data-image-focus={image.id}
      onFocus={() => onFocus(image.id)} onClick={event => { if (event.detail < 2) onMark(image.id, event.shiftKey); }}
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
      <span className="pile-overview__mark" aria-hidden="true">{selected ? <Check size={15} strokeWidth={3} /> : board ? <Layers3 size={13} /> : <Square size={14} />}</span>
      {category && <span className="pile-overview__category" title={category}>{category.split('/').at(-1)}</span>}
    </button>
    <button className="pile-overview__inspect" type="button" tabIndex={focused ? 0 : -1} aria-label={`View ${name}`} title="View image"
      onClick={() => onPreview(image.id)}><ZoomIn size={15} /></button>
    <span className="pile-overview__filename" aria-hidden="true">{board ? 'On board · ' : ''}{name}</span>
  </div>;
});

export default function PileOverview({ workspaceScope, open, images, categories, thumbnails, order, reversed, preparing, busy, status, error, indexAction, undo, onOrder, onReverse, onShuffle, onClose, onAdd, onInteracting, categoryRequest, categoryNotice, onAssign, onCreateStash }: Props) {
  const rootRef = React.useRef<HTMLElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const backRef = React.useRef<HTMLButtonElement>(null);
  const [layout, setLayout] = React.useState<PileLayout>('mess');
  const [size, setSize] = React.useState(() => window.innerWidth < 700 ? 128 : 160);
  const [scope, setScope] = React.useState<'pile' | 'all' | 'board'>('pile');
  const [category, setCategory] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [categoriesOpen, setCategoriesOpen] = React.useState(false);
  const [assignmentIds, setAssignmentIds] = React.useState<string[] | null>(null);
  const assignOpener = React.useRef<HTMLElement | null>(null);
  const categoriesRef = React.useRef<HTMLElement>(null);
  const query = React.useDeferredValue(search.trim().toLocaleLowerCase());
  const [marked, setMarked] = React.useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = React.useState<string | null>(null);
  const [previewIds, setPreviewIds] = React.useState<string[]>([]);
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const [viewport, setViewport] = React.useState({ top: 0, width: window.innerWidth, height: Math.max(200, window.innerHeight - 240) });
  const anchorRef = React.useRef<string | null>(null);
  const focusPending = React.useRef<string | null>(null);
  const sizeAnchor = React.useRef<{ id: string; offset: number; bottom?: boolean } | null>(null);
  const viewRef = React.useRef(viewport);
  viewRef.current = viewport;
  const categoryById = React.useMemo(() => new Map(categories.map(item => [item.id, item.name])), [categories]);
  const onBoard = React.useCallback((image: LibraryImage) => workspaceScope === undefined ? imageIsOnBoard(image) : imageOnScopeBoard(image, workspaceScope), [workspaceScope]);
  React.useEffect(() => { setScope('pile'); setCategory('all'); setSearch(''); setMarked(new Set()); }, [workspaceScope]);
  const filtered = React.useMemo(() => images.filter(image => {
    if (scope === 'pile' && (onBoard(image) || workspaceScope !== undefined && image.categoryId !== workspaceScope) || scope === 'board' && !onBoard(image)) return false;
    const code = image.categoryId ? categoryById.get(image.categoryId) || '' : '';
    if (category === 'unassigned' && image.categoryId || category === 'coded' && !image.categoryId) return false;
    if (!['all', 'unassigned', 'coded'].includes(category)) {
      const branch = categoryById.get(category);
      if (!branch || code !== branch && !code.startsWith(`${branch}/`)) return false;
    }
    return !query || image.path.toLocaleLowerCase().includes(query) || code.toLocaleLowerCase().includes(query);
  }), [images, scope, category, query, categoryById, onBoard, workspaceScope]);
  const geometry = React.useMemo(() => pileGeometry(viewport.width, size, layout, filtered.length), [viewport.width, size, layout, filtered.length]);
  const geometryRef = React.useRef(geometry), filteredRef = React.useRef(filtered);
  geometryRef.current = geometry; filteredRef.current = filtered;
  const indices = React.useMemo(() => new Map(filtered.map((image, index) => [image.id, index])), [filtered]);
  const eligible = filtered;
  const selected = React.useMemo(() => images.filter(image => marked.has(image.id)), [images, marked]);
  const outsideCount = selected.filter(image => !indices.has(image.id)).length;
  const addable = React.useMemo(() => selected.filter(image => !onBoard(image)), [selected, onBoard]);
  const assignmentSelection = assignmentIds ? images.filter(image => assignmentIds.includes(image.id)) : selected;
  const range = visiblePileRange(filtered.length, geometry, viewport.top, viewport.height);
  const visibleIndices = Array.from({ length: range.end - range.first }, (_, index) => index + range.first);
  const focusedIndex = focusedId ? indices.get(focusedId) : undefined;
  if (focusedIndex !== undefined && (focusedIndex < range.first || focusedIndex >= range.end)) visibleIndices.push(focusedIndex);
  // Load the actual viewport first; overscan can follow while the user explores.
  const middle = (viewport.top + viewport.height / 2 - geometry.padding) / geometry.rowHeight * geometry.columns;
  const wanted = open ? previewId ? [previewId] : [...visibleIndices].sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle)).map(index => filtered[index].id) : [];
  useThumbnails(thumbnails, wanted, open);

  React.useEffect(() => { if (!open) { setPreviewId(null); setCategoriesOpen(false); } }, [open]);
  React.useEffect(() => {
    if (!categoryRequest) return;
    setCategory(categoryRequest.id); setScope('all'); setSearch('');
  }, [categoryRequest]);
  React.useLayoutEffect(() => {
    if (!categoriesOpen || !categoriesRef.current) return;
    const panel = categoriesRef.current;
    const siblings = [...panel.parentElement!.children].filter(element => element !== panel && !element.classList.contains('pile-overview__categories-backdrop')) as HTMLElement[];
    const previous = siblings.map(element => ({ element, inert: element.inert, hidden: element.getAttribute('aria-hidden') }));
    siblings.forEach(element => { element.inert = true; element.setAttribute('aria-hidden', 'true'); });
    panel.querySelector<HTMLElement>('button[aria-label="Close stash chooser"]')?.focus();
    return () => {
      previous.forEach(({ element, inert, hidden }) => { element.inert = inert; if (hidden === null) element.removeAttribute('aria-hidden'); else element.setAttribute('aria-hidden', hidden); });
      const opener = assignOpener.current;
      if (opener?.isConnected && !(opener instanceof HTMLButtonElement && opener.disabled)) opener.focus({ preventScroll: true });
      else (rootRef.current?.querySelector<HTMLElement>('[data-image-focus]') || scrollRef.current)?.focus({ preventScroll: true });
    };
  }, [categoriesOpen]);

  React.useEffect(() => {
    const available = new Set(images.map(image => image.id));
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
      if (anchor.bottom) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      else if (index !== undefined) scrollRef.current.scrollTop = geometry.padding + Math.floor(index / geometry.columns) * geometry.rowHeight + anchor.offset;
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
    if (!image) return;
    const last = anchorRef.current ? indices.get(anchorRef.current) : undefined, index = indices.get(id);
    setMarked(current => {
      const next = new Set(current);
      if (range && index !== undefined && last !== undefined) {
        for (const image of filtered.slice(Math.min(last, index), Math.max(last, index) + 1)) next.add(image.id);
      } else if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    anchorRef.current = id; setFocusedId(id);
  }, [images, filtered, indices]);
  const preview = React.useCallback((id: string) => { setPreviewIds(filtered.map(image => image.id)); setPreviewId(id); }, [filtered]);
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
    if (filtered[index]) sizeAnchor.current = { id: filtered[index].id, bottom: !!scrollRef.current && scrollRef.current.scrollHeight - scrollRef.current.scrollTop - scrollRef.current.clientHeight < 4, offset: Math.max(0, viewport.top - geometry.padding - Math.floor(index / geometry.columns) * geometry.rowHeight) };
    setSize(Math.max(88, Math.min(280, nextSize))); setLayout(nextLayout);
  };
  const selectAll = () => setMarked(current => new Set([...current, ...eligible.map(image => image.id)]));
  const add = () => { if (addable.length && !busy) { onAdd(addable.map(image => image.id)); setMarked(new Set()); } };
  const chooseCategory = (ids?: string[]) => { assignOpener.current = document.activeElement as HTMLElement; setAssignmentIds(ids || null); setCategoriesOpen(true); };
  const imageById = React.useMemo(() => new Map(images.map(image => [image.id, image])), [images]);
  const previewImages = previewIds.flatMap(id => imageById.get(id) || []);
  const previewImage = previewId ? imageById.get(previewId) : undefined;
  const previewIndex = previewImage ? previewImages.findIndex(image => image.id === previewImage.id) : -1;
  const closePreview = () => {
    if (previewImage) { focusPending.current = previewImage.id; setFocusedId(previewImage.id); }
    setPreviewId(null);
  };
  if (!open) return null;
  const firstVisible = Math.min(filtered.length, Math.max(0, Math.floor((viewport.top - geometry.padding) / geometry.rowHeight)) * geometry.columns + 1);
  const lastVisible = Math.min(filtered.length, Math.ceil((viewport.top + viewport.height - geometry.padding) / geometry.rowHeight) * geometry.columns);
  const scrollMax = Math.max(0, geometry.height - viewport.height);

  return <section className={`pile-overview overview-shell${filtersOpen ? ' pile-overview--filters-open' : ''}`} ref={rootRef} role="dialog" aria-modal="true" aria-label="Explore image pile" onKeyDown={event => {
    if (previewImage) return;
    if (event.key === 'Escape') { event.preventDefault(); if (categoriesOpen) setCategoriesOpen(false); else onClose(); }
    if (!categoriesOpen && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); selectAll(); }
    if (!categoriesOpen && (event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); add(); }
    if (event.key === 'Tab') {
      if (previewImage) return;
      const surface = categoriesOpen ? categoriesRef.current! : rootRef.current!;
      const controls = [...surface.querySelectorAll<HTMLElement>('button:not(:disabled), summary, input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(element => {
        if (element.tabIndex < 0) return false;
        const rect = element.getBoundingClientRect();
        return !element.closest('[inert], details:not([open]) .action-menu__panel') && rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
      });
      if (event.shiftKey && event.target === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && event.target === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }
  }}>
    <MenuBar label="Image browser menu bar" leading={<button ref={backRef} className="action-button" type="button" aria-label="Back to sorting board" onClick={onClose}><ArrowLeft size={20} /></button>}
      context={<div className="workspace-selection" title={outsideCount ? `${outsideCount} selected outside this view` : undefined} role="status" aria-live="polite"><strong>{marked.size ? `${marked.size} selected` : `${filtered.length.toLocaleString()} images`}</strong>{outsideCount > 0 && <span className="srOnly">{outsideCount} outside this view</span>}</div>}>
      {marked.size > 0 && <><ActionButton icon="close" label="Deselect images" onClick={() => setMarked(new Set())} /><ActionButton icon="moveToStash" label="Move selected images to stash" disabled={busy} onClick={() => chooseCategory()} /><ActionButton icon="add" label="Add selected to board" disabled={!addable.length || busy} onClick={add} /></>}
      <UndoControl action={undo} />
      <ActionMenu label="Image browser options">
        <button type="button" className="action-menu__item" data-close-menu onClick={() => setFiltersOpen(value => !value)}><SlidersHorizontal size={18} /><span>{filtersOpen ? 'Hide filters' : 'Filter and order'}</span></button>
        <button type="button" className="action-menu__item" data-close-menu onClick={selectAll} disabled={!eligible.length}><CheckCheck size={18} /><span>Select all</span></button>
        <button type="button" className="action-menu__item" data-close-menu onClick={() => changeDensity(size, layout === 'mess' ? 'grid' : 'mess')}>{layout === 'mess' ? <LayoutGrid size={18} /> : <Layers3 size={18} />}<span>{layout === 'mess' ? 'Grid layout' : 'Mess layout'}</span></button>
        <label className="overview-shell__size">Image size<input type="range" aria-label="Overview image size" min={88} max={280} step={8} value={size} onChange={event => changeDensity(Number(event.target.value))} /></label>
        {(error || status || categoryNotice) && <p role={error ? 'alert' : 'status'}>{error || status || categoryNotice}{indexAction}</p>}
      </ActionMenu>
    </MenuBar>
    <div className="pile-overview__controls">
      <div className="pile-overview__filters">
        <label className="pile-overview__search"><Search size={17} /><input type="search" aria-label="Find images" placeholder="Find a filename or stash…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')}><X size={15} /></button>}</label>
        <select aria-label="Overview stash filter" value={category} onChange={event => setCategory(event.target.value)}><option value="all">All stashes</option><option value="unassigned">Unsorted</option><option value="coded">In stashes</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
        <select aria-label="Overview image scope" value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="pile">In the pile</option><option value="all">All images</option><option value="board">On the board</option></select>
      </div>
      <div className="pile-overview__tools">
        <label className="pile-overview__order">Order <select aria-label="Overview order" value={order} onChange={event => onOrder(event.target.value as PileOrder)}><PileOrderOptions /></select></label>
        <button type="button" className="pile-overview__icon" aria-label="Reverse overview order" title="Reverse order" disabled={order === 'random' || preparing} aria-pressed={reversed} onClick={onReverse}><ArrowDownUp size={17} /></button>
        <button type="button" className="pile-overview__shuffle" aria-label="Shuffle overview" disabled={images.length < 2} onClick={() => { scrollRef.current?.scrollTo({ top: 0 }); onShuffle(); }}><Shuffle size={17} /><span>Shuffle</span></button>

      </div>
    </div>
    <div className="pile-overview__scroll" ref={scrollRef} role="region" aria-label="Image overview" tabIndex={0}>
      <div className={`pile-overview__canvas pile-overview__canvas--${layout}`} style={{ height: geometry.height }}>
        {visibleIndices.map(index => {
          const image = filtered[index];
          return <OverviewImage key={image.id} image={image} index={index} size={size} layout={layout}
            x={geometry.padding + index % geometry.columns * geometry.columnWidth + (geometry.columnWidth - size) / 2}
            y={geometry.padding + Math.floor(index / geometry.columns) * geometry.rowHeight}
            selected={marked.has(image.id)} board={onBoard(image)} focused={focusedId ? focusedId === image.id : index === 0}
            category={image.categoryId ? categoryById.get(image.categoryId) : undefined} url={thumbnails.urls.get(image.id)} failed={thumbnails.failed.has(image.id)}
            onMark={mark} onPreview={preview} onNavigate={navigate} onFocus={focus} />;
        })}
      </div>
      {filtered.length === 0 && <div className="pile-overview__empty"><Layers3 size={34} /><h3>{scope === 'pile' && !query && category === 'all' ? 'The pile is empty' : 'No matching images'}</h3><p>{scope === 'pile' && !query && category === 'all' ? 'Explore the images already on your board.' : 'Try another filename, stash, or view.'}</p><button type="button" onClick={() => { setSearch(''); setCategory('all'); setScope('all'); }}>Show all images</button></div>}
    </div>
    <footer className="overview-shell__position">{filtered.length > 0 && <><span>{firstVisible.toLocaleString()}–{lastVisible.toLocaleString()} / {filtered.length.toLocaleString()}</span><input type="range" aria-label="Browse image collection" min={0} max={1000} value={scrollMax ? Math.min(1000, Math.round(viewport.top / scrollMax * 1000)) : 0} disabled={!scrollMax} onChange={event => scrollRef.current?.scrollTo({ top: Number(event.target.value) / 1000 * scrollMax })} /></>}</footer>
    {categoriesOpen && <><button className="pile-overview__categories-backdrop" type="button" tabIndex={-1} aria-label="Dismiss stash chooser" onClick={() => setCategoriesOpen(false)} />
      <aside className="pile-overview__categories" ref={categoriesRef} role="dialog" aria-modal="true" aria-label="Move to stash">
        <StashPickerContent images={images} categories={categories} selected={assignmentSelection} busy={busy} onClose={() => setCategoriesOpen(false)}
          onChoose={async id => { const ids = assignmentSelection.map(image => image.id); await onAssign(ids, id); const assigned = new Set(ids); setMarked(current => new Set([...current].filter(value => !assigned.has(value)))); }}
          onCreate={async name => { await onCreateStash(assignmentSelection.map(image => image.id), name); }} />
      </aside></>}
    {previewImage && <ImageViewer image={previewImage} images={images} categories={categories} index={previewIndex} total={previewImages.length} busy={busy} undo={undo}
      label={`Preview ${previewImage.path}`} closeLabel="Close preview"
      selection={{ marked: marked.has(previewImage.id), onMark: () => mark(previewImage.id, false) }}
      onAssign={id => onAssign([previewImage.id], id)} onCreateAndAssign={async name => { await onCreateStash([previewImage.id], name); }}
      onClose={closePreview} onMove={direction => { const image = previewImages[previewIndex + direction]; if (image) setPreviewId(image.id); }} />}

  </section>;
}
