import * as React from 'react';
import { ArrowDownUp, ChevronLeft, ChevronRight, Expand, FolderInput, LocateFixed, Minimize2, PanelLeftClose, PanelLeftOpen, Plus, Search, Shuffle, SlidersHorizontal, X } from 'lucide-react';
import { BatchCountPicker } from './BoardStarter';
import { DraggableCard, type DraggableCardProps } from './DraggableCard';
import { browserGeometry, filterBrowserImages, readImageBrowserView, type BrowserFilter } from './imageBrowserView';
import { useThumbnails, type ImageThumbnailCache } from './imageThumbnails';
import type { LibraryCategory, LibraryImage } from './libraryStore';
import { PileOrderOptions } from './PileOrderOptions';
import type { PileOrder } from './imageAnalysis';
import { visiblePileRange } from './pileLayout';
import type { CardData } from './types';
import { useStableCallback } from './useStableCallback';
import './image-browser.css';

type Point = { x: number; y: number };
type Props = {
  scopeId: string | null; destinationName: string; projectId: string; images: LibraryImage[]; categories: LibraryCategory[]; thumbnails: ImageThumbnailCache;
  importedImageIds?: string[];
  onBoardIds: ReadonlySet<string>; selectedIds: ReadonlySet<string>; draggingId?: string; multiSelect: boolean;
  busy: boolean; preparing: boolean; clipEnabled: boolean; order: PileOrder; reversed: boolean; status: string;
  expanded: boolean; onExpanded: (expanded: boolean) => void; regionRef: React.RefObject<HTMLElement>;
  onPanel: (view: { width: number; collapsed: boolean; expanded: boolean }) => void;
  onOrder: (order: PileOrder) => void; onReverse: () => void; onShuffle: () => void;
  onSelect: NonNullable<DraggableCardProps['onSelectCard']>;
  onSelectAll: (ids: string[]) => void;
  onDeselect: () => void;
  onAdd: (ids: string[], origin?: DOMRect) => void;
  onShow: (ids: string[]) => void;
  starterActive?: boolean;
  onFilterChange: () => void;
  randomBatch?: { count: number; onCount: (count: number) => void; onAdd: (ids: string[], origin: DOMRect) => void };
  onOpen: (image: LibraryImage, ids: string[]) => void;
  onDragStart: NonNullable<DraggableCardProps['onDragScreenStart']>;
  onDragMove: NonNullable<DraggableCardProps['onDragScreenMove']>;
  onDragEnd: NonNullable<DraggableCardProps['onDragScreenEnd']>;
  onDrop: DraggableCardProps['onMoveEnd']; onBringToFront: (id: string) => void;
  onInteracting: (active: boolean) => void;
};

export default function ImageBrowser(props: Props) {
  const [savedView] = React.useState(() => readImageBrowserView(props.projectId));
  const [importedOnly, setImportedOnly] = React.useState(!!props.importedImageIds?.length);
  const [view, setView] = React.useState(() => ({ ...savedView, ...(props.expanded ? { collapsed: false } : {}),
    ...(importedOnly ? { filter: 'all' as const, stash: 'all', inFolder: false, query: '', scrollTop: 0 } : {}) }));
  const { expanded, onExpanded: setExpanded } = props;
  const [options, setOptions] = React.useState(false);
  const [focusOffset, setFocusOffset] = React.useState(0);
  const [viewport, setViewport] = React.useState({ width: 320, height: 500, top: 0 });
  const viewportRef = React.useRef(viewport); viewportRef.current = viewport;
  const scroll = React.useRef<HTMLDivElement | null>(null);
  const lastScrollTop = React.useRef(view.scrollTop);
  const restoreScroll = React.useRef<number | null>(view.scrollTop);
  const wasCollapsed = React.useRef(view.collapsed);
  const resize = React.useRef<{ pointer: number; x: number; width: number }>();
  const anchor = React.useRef<{ id: string; offset: number }>();
  const pendingFocus = React.useRef<string>();
  const returningScroll = React.useRef<number | null>(null);
  const deferredQuery = React.useDeferredValue(view.query);
  const categoryById = React.useMemo(() => new Map(props.categories.map(stash => [stash.id, stash.name])), [props.categories]);
  const filterView = React.useMemo(() => ({ ...view, query: deferredQuery }), [view.filter, view.stash, view.inFolder, deferredQuery]);
  const importedIds = React.useMemo(() => new Set(props.importedImageIds), [props.importedImageIds]);
  const filtered = React.useMemo(() => filterBrowserImages(importedOnly ? props.images.filter(image => importedIds.has(image.id)) : props.images, props.categories, props.scopeId, filterView), [props.images, props.categories, props.scopeId, filterView, importedOnly, importedIds]);
  const waiting = React.useMemo(() => filtered.filter(image => image.categoryId === null && image.rootOnBoard === false).map(image => image.id), [filtered]);
  const ids = React.useMemo(() => filtered.map(image => image.id), [filtered]);
  const indexById = React.useMemo(() => new Map(ids.map((id, index) => [id, index])), [ids]);
  const unsorted = React.useMemo(() => props.images.filter(image => !image.categoryId).length, [props.images]);
  const directCount = React.useMemo(() => props.images.filter(image => image.categoryId === props.scopeId).length, [props.images, props.scopeId]);
  const unsortedInStash = view.filter === 'unsorted' && view.inFolder && props.scopeId !== null;
  const emptyFolder = !importedOnly && view.inFolder && !directCount && view.filter === 'all' && view.stash === 'all' && !view.query.trim();
  const folderPath = categoryById.get(props.scopeId || '');
  const hasSubStashes = props.categories.some(stash => folderPath ? stash.name.startsWith(`${folderPath}/`) : !stash.name.includes('/'));
  const selected = React.useMemo(() => props.images.filter(image => props.selectedIds.has(image.id)), [props.images, props.selectedIds]);
  const hiddenSelected = selected.filter(image => !indexById.has(image.id)).length;
  const addable = selected.filter(image => !props.onBoardIds.has(image.id));
  const addingUnsorted = !!props.randomBatch && addable.length > 0 && addable.every(image => image.categoryId === null);
  const selectedOnBoard = selected.length > 0 && selected.every(image => props.onBoardIds.has(image.id));
  const matchingGroupSorted = React.useMemo(() => view.filter === 'unsorted' && !filtered.length &&
    filterBrowserImages(props.images, props.categories, props.scopeId, { ...filterView, filter: 'all' }).some(image => !!image.categoryId),
  [view.filter, filtered.length, props.images, props.categories, props.scopeId, filterView]);
  const sequence = React.useMemo(() => {
    if (!view.focus || !filtered.length) return filtered;
    const offset = focusOffset % filtered.length;
    return [...filtered.slice(offset), ...filtered.slice(0, offset)];
  }, [filtered, view.focus, focusOffset]);
  const focused = sequence.slice(0, view.focus);
  const sequenceIndex = React.useMemo(() => new Map(sequence.map((image, index) => [image.id, index])), [sequence]);
  const rest = view.focus ? sequence.slice(view.focus) : sequence;
  const focusSize = Math.min(view.focus === 1 ? 360 : 240, Math.max(72, (viewport.width - 44) / (view.focus === 1 ? 1 : 2)));
  const focusImageHeight = focusSize * .7;
  const focusHeight = focused.length ? 34 + Math.ceil(focused.length / (view.focus === 1 ? 1 : 2)) * (focusImageHeight + 36) + 18 : 0;
  const geometry = React.useMemo(() => browserGeometry(viewport.width, view.size, rest.length), [viewport.width, view.size, rest.length]);
  const geometryRef = React.useRef(geometry); geometryRef.current = geometry;
  const sequenceRef = React.useRef(rest); sequenceRef.current = rest;
  const range = visiblePileRange(rest.length, geometry, Math.max(0, viewport.top - focusHeight), viewport.height);
  const visible = new Set(Array.from({ length: range.end - range.first }, (_, index) => index + range.first));
  if (props.draggingId) { const index = rest.findIndex(image => image.id === props.draggingId); if (index >= 0) visible.add(index); }
  const visibleImages = [...focused, ...[...visible].map(index => rest[index])];
  useThumbnails(props.thumbnails, visibleImages.map(image => image.id), !view.collapsed, false);

  const saveView = useStableCallback(() => {
    // Inspecting an import is temporary. Keep the user's previous filters and
    // scroll position until they explicitly choose a different browsing view.
    const context = importedOnly ? { filter: savedView.filter, stash: savedView.stash, inFolder: savedView.inFolder, query: savedView.query, scrollTop: savedView.scrollTop, collapsed: savedView.collapsed } : {};
    try { localStorage.setItem(`folder-sort-browser:${props.projectId}`, JSON.stringify({ ...view, scrollTop: lastScrollTop.current, ...context, version: 2 })); } catch { /* Browsing works without localStorage. */ }
  });
  React.useEffect(saveView, [view, saveView]);
  React.useEffect(() => {
    window.addEventListener('pagehide', saveView);
    return () => { window.removeEventListener('pagehide', saveView); saveView(); };
  }, [saveView]);
  React.useLayoutEffect(() => props.onPanel({ width: view.width, collapsed: view.collapsed, expanded }), [view.width, view.collapsed, expanded, props.onPanel]);
  React.useEffect(() => { if (view.stash !== 'all' && !props.categories.some(stash => stash.id === view.stash)) setView(current => ({ ...current, stash: 'all' })); }, [props.categories, view.stash]);
  React.useLayoutEffect(() => {
    const element = scroll.current;
    if (!element || view.collapsed) return;
    let frame = 0, idle = 0;
    const update = () => {
      frame = 0;
      const next = { width: element.clientWidth, height: element.clientHeight, top: element.scrollTop };
      if (restoreScroll.current === null && next.width !== viewportRef.current.width && !anchor.current) {
        const old = geometryRef.current, index = Math.max(0, Math.floor((viewportRef.current.top - focusHeight - old.padding) / old.rowHeight)) * old.columns;
        const image = sequenceRef.current[index]; if (image) anchor.current = { id: image.id, offset: (viewportRef.current.top - focusHeight - old.padding) % old.rowHeight };
      }
      setViewport(current => current.width === next.width && current.height === next.height && current.top === next.top ? current : next);
    };
    const onScroll = () => { if (restoreScroll.current === null) lastScrollTop.current = element.scrollTop; props.onInteracting(true); clearTimeout(idle); idle = window.setTimeout(() => { props.onInteracting(false); saveView(); }, 160); if (!frame) frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(update); observer.observe(element); element.addEventListener('scroll', onScroll, { passive: true }); update();
    return () => { observer.disconnect(); element.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); clearTimeout(idle); props.onInteracting(false); };
  }, [view.collapsed, props.onInteracting, focusHeight, saveView]);
  React.useLayoutEffect(() => {
    if (wasCollapsed.current && !view.collapsed) restoreScroll.current = lastScrollTop.current;
    wasCollapsed.current = view.collapsed;
    const element = scroll.current;
    if (restoreScroll.current === null || !element || view.collapsed || element.clientWidth !== viewport.width) return;
    element.scrollTop = restoreScroll.current;
    lastScrollTop.current = element.scrollTop; restoreScroll.current = null;
    setViewport(current => ({ ...current, top: element.scrollTop }));
  }, [view.collapsed, viewport.width, geometry.height, focusHeight]);
  React.useLayoutEffect(() => {
    if (!anchor.current || !scroll.current) return;
    const index = rest.findIndex(image => image.id === anchor.current!.id);
    if (index >= 0) scroll.current.scrollTop = focusHeight + geometry.padding + Math.floor(index / geometry.columns) * geometry.rowHeight + anchor.current.offset;
    anchor.current = undefined;
  }, [geometry, rest, focusHeight]);
  const browseKey = JSON.stringify([view.filter, view.stash, view.inFolder, deferredQuery, props.order, props.reversed, importedOnly]);
  const previousBrowseKey = React.useRef(browseKey);
  React.useLayoutEffect(() => {
    if (previousBrowseKey.current === browseKey) return;
    previousBrowseKey.current = browseKey; restoreScroll.current = returningScroll.current; lastScrollTop.current = returningScroll.current ?? 0;
    scroll.current?.scrollTo({ top: lastScrollTop.current }); returningScroll.current = null; setFocusOffset(0); saveView();
  }, [browseKey, saveView]);
  React.useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const node = props.regionRef.current?.querySelector<HTMLElement>(`[data-testid="browser-card-${CSS.escape(pendingFocus.current)}"]`);
    if (node) { pendingFocus.current = undefined; node.focus({ preventScroll: true }); }
  });
  const changeSize = (size: number) => {
    const index = Math.max(0, Math.floor((viewport.top - focusHeight - geometry.padding) / geometry.rowHeight)) * geometry.columns;
    if (rest[index]) anchor.current = { id: rest[index].id, offset: Math.max(0, (viewport.top - focusHeight - geometry.padding) % geometry.rowHeight) };
    setView(current => ({ ...current, size }));
  };
  const navigate = useStableCallback((id: string, direction: 'left' | 'right' | 'up' | 'down') => {
    const index = sequenceIndex.get(id);
    if (index === undefined) return;
    const focusColumns = view.focus === 1 ? 1 : 2;
    let target = index;
    if (direction === 'left' || direction === 'right') target += direction === 'left' ? -1 : 1;
    else if (index < focused.length) {
      const row = Math.floor(index / focusColumns), column = index % focusColumns;
      if (direction === 'up') { if (row > 0) target = index - focusColumns; }
      else if (row < Math.ceil(focused.length / focusColumns) - 1) target = Math.min(focused.length - 1, index + focusColumns);
      else if (rest.length) target = focused.length + Math.min(column, geometry.columns - 1, rest.length - 1);
    } else {
      const gridIndex = index - focused.length;
      if (direction === 'up' && gridIndex < geometry.columns) {
        if (focused.length) target = Math.min(focused.length - 1, Math.floor((focused.length - 1) / focusColumns) * focusColumns + Math.min(gridIndex, focusColumns - 1));
      } else target += direction === 'up' ? -geometry.columns : geometry.columns;
    }
    target = Math.max(0, Math.min(sequence.length - 1, target));
    const next = sequence[target];
    if (!next) return;
    const inFocus = target < focused.length;
    const top = inFocus ? 36 + Math.floor(target / focusColumns) * (focusImageHeight + 36) : focusHeight + geometry.padding + Math.floor((target - focused.length) / geometry.columns) * geometry.rowHeight;
    if (scroll.current && (top < scroll.current.scrollTop || top + (inFocus ? focusImageHeight : geometry.imageHeight) > scroll.current.scrollTop + scroll.current.clientHeight)) scroll.current.scrollTop = Math.max(0, top - 12);
    pendingFocus.current = next.id; setViewport(current => ({ ...current, top: scroll.current?.scrollTop || 0 }));
  });
  const open = useStableCallback((id: string) => { const image = props.images.find(image => image.id === id); if (image) props.onOpen(image, ids); });
  const card = (image: LibraryImage, point: Point, width: number, height: number) => {
    const name = categoryById.get(image.categoryId || '');
    const data: CardData = { id: image.id, kind: 'image', createdAt: image.addedAt, meta: { name: image.path.split('/').at(-1) || image.path, notes: '', tags: name ? [name] : [] }, ...point, z: (sequenceIndex.get(image.id) || 0) + 1 };
    return <React.Fragment key={image.id}><DraggableCard card={data} thumbnailCache={props.thumbnails} cardW={width} cardH={height} appearance="browser" testIdPrefix="browser-card"
      instantPosition mode="sort" dragEnabled={!props.busy} isSelected={props.selectedIds.has(image.id)} selectionOnly={props.multiSelect}
      onSelectCard={props.onSelect} onBringToFront={props.onBringToFront} onMoveEnd={props.onDrop}
      onDragScreenStart={props.onDragStart} onDragScreenMove={props.onDragMove} onDragScreenEnd={props.onDragEnd}
      onOpenPreview={open} onKeyboardMove={navigate} categoryLabel={name?.split('/').at(-1)} categoryTitle={name} locationLabel="Image browser" />
      {props.onBoardIds.has(image.id) && <span className="image-browser__on-board" style={{ left: point.x + width - 4, top: point.y + 5 }}>On board</span>}</React.Fragment>;
  };
  const changeFilters = (patch: Partial<typeof view>) => { props.onFilterChange(); setImportedOnly(false); setView(current => ({ ...current, ...patch })); };
  const filter = (next: BrowserFilter) => changeFilters({ filter: next, ...(next === 'unsorted' ? { stash: 'all' } : {}) });
  const leaveImport = () => {
    props.onDeselect(); setImportedOnly(false); returningScroll.current = savedView.scrollTop;
    setView(current => ({ ...current, filter: savedView.filter, stash: savedView.stash, inFolder: savedView.inFolder, query: savedView.query }));
  };
  const continueUnsorted = () => {
    props.onDeselect(); changeFilters({ filter: 'unsorted', stash: 'all', query: '', inFolder: false });
    requestAnimationFrame(() => scroll.current?.focus({ preventScroll: true }));
  };
  const showFolderImages = () => {
    props.onDeselect(); changeFilters({ filter: 'all', stash: 'all', query: '', inFolder: true });
    requestAnimationFrame(() => scroll.current?.focus({ preventScroll: true }));
  };
  // Intake moves only missing members, while the comparison selection includes
  // images already here. Keep that full selection for the next Stash action.
  const add = (event: React.MouseEvent<HTMLButtonElement>) => { if (!addable.length) return; props.onAdd(selected.map(image => image.id), event.currentTarget.getBoundingClientRect()); setExpanded(false); };
  return <section ref={props.regionRef} data-thumbnail-size={geometry.imageWidth} className={`image-browser${view.collapsed ? ' is-collapsed' : ''}${expanded ? ' is-expanded' : ''}`} aria-label="Image browser"
    onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && !(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]'))) { event.preventDefault(); props.onSelectAll(ids); } }}>
    <header className="image-browser__header"><strong>Image browser</strong><span>{filtered.length.toLocaleString()} / {props.images.length.toLocaleString()}</span>
      <button type="button" aria-label={expanded ? 'Return to sorting board' : 'Expand image browser'} title={expanded ? 'Return to sorting board' : 'Expand image browser'} onClick={() => { setExpanded(!expanded); setView(current => ({ ...current, collapsed: false })); }}>{expanded ? <Minimize2 size={17} /> : <Expand size={17} />}</button>
      <button type="button" aria-label={view.collapsed ? 'Show image browser' : 'Collapse image browser'} title={view.collapsed ? 'Show image browser' : 'Collapse image browser'} onClick={() => { setExpanded(false); setView(current => ({ ...current, collapsed: !current.collapsed })); }}>{view.collapsed ? <PanelLeftOpen className="image-browser__dock-icon" size={18} /> : <PanelLeftClose className="image-browser__dock-icon" size={18} />}</button></header>
    {!view.collapsed && <>
      <div className="image-browser__controls"><div className="image-browser__status" role="group" aria-label="Image assignment filter">
        {(['all', 'unsorted', 'sorted'] as const).map(name => <button key={name} type="button" aria-pressed={view.filter === name} onClick={() => filter(name)}>{name === 'all' ? 'All' : name === 'unsorted' ? 'Unsorted' : 'Sorted'} <span>{(name === 'all' ? props.images.length : name === 'unsorted' ? unsorted : props.images.length - unsorted).toLocaleString()}</span></button>)}
      </div><div className="image-browser__order"><label>Order<select aria-label="Image browser order" value={props.order} disabled={props.preparing} onChange={event => props.onOrder(event.target.value as PileOrder)}><PileOrderOptions clipEnabled={props.clipEnabled} /></select></label>{props.order === 'random' ? <button type="button" aria-label="Shuffle images" title="Shuffle images" onClick={props.onShuffle}><Shuffle size={16} /></button> : <button type="button" aria-label="Reverse image order" title="Reverse image order" disabled={props.preparing} aria-pressed={props.reversed} onClick={props.onReverse}><ArrowDownUp size={16} /></button>}</div>
      <button type="button" className="image-browser__filter-toggle" aria-label="Filters & view" title="Filters & view" aria-expanded={options} onClick={() => setOptions(value => !value)}><SlidersHorizontal size={16} />Filters{(view.stash !== 'all' || view.inFolder || view.query.trim()) && <span className="image-browser__filter-dot" aria-label="Filters active" />}</button>
      {options && <div className="image-browser__options"><label className="image-browser__search"><Search size={16} /><input type="search" aria-label="Find images" placeholder="Filename or stash" value={view.query} onChange={event => changeFilters({ query: event.target.value })} /></label>
        <label>Stash<select aria-label="Filter images by stash" disabled={view.filter === 'unsorted'} value={view.stash} onChange={event => changeFilters({ stash: event.target.value })}><option value="all">Any stash</option>{props.categories.map(stash => <option key={stash.id} value={stash.id}>{stash.name}</option>)}</select></label>
        <label className="image-browser__check"><input type="checkbox" checked={view.inFolder} onChange={event => changeFilters({ inFolder: event.target.checked })} />In this folder only</label>
        <label>Thumbnail size<input type="range" aria-label="Browser thumbnail size" min={72} max={200} step={8} value={view.size} onChange={event => changeSize(Number(event.target.value))} /></label>
        <label>Focus images<select aria-label="Focus images" value={view.focus} onChange={event => { setFocusOffset(0); setView(current => ({ ...current, focus: Number(event.target.value) })); scroll.current?.scrollTo({ top: 0 }); }}><option value={0}>Off · continuous overview</option>{[1, 2, 3].map(count => <option key={count} value={count}>{count}</option>)}</select></label>
        <button type="button" onClick={() => changeFilters({ filter: 'all', stash: 'all', inFolder: false, query: '' })}>Clear filters</button>
      </div>}
      {(importedOnly || !options && (view.query.trim() || view.stash !== 'all' || view.inFolder)) && <div className="image-browser__applied" aria-label="Active image filters">
        {importedOnly && <button type="button" aria-label="Clear imported images filter" title="Return to previous filters" onClick={leaveImport}><span>Imported {filtered.length.toLocaleString()}</span><X size={13} /></button>}
        {!options && view.query.trim() && <button type="button" aria-label={`Clear search: ${view.query.trim()}`} title={`Clear search: ${view.query.trim()}`} onClick={() => changeFilters({ query: '' })}><Search size={13} /><span>{view.query.trim()}</span><X size={13} /></button>}
        {!options && view.stash !== 'all' && <button type="button" aria-label="Clear stash filter" title="Clear stash filter" onClick={() => changeFilters({ stash: 'all' })}><span>{categoryById.get(view.stash)}</span><X size={13} /></button>}
        {!options && view.inFolder && <button type="button" aria-label="Clear current folder filter" title="Clear current folder filter" onClick={() => changeFilters({ inFolder: false })}><span>This folder</span><X size={13} /></button>}
      </div>}</div>
      <div className="image-browser__scroll" ref={scroll} role="region" aria-label="Browse project images" tabIndex={0}>
        <div className="image-browser__canvas" style={{ height: geometry.height + focusHeight }}>
          {!!focused.length && <><div className="image-browser__focus-heading"><strong>Next up</strong><button type="button" aria-label="Show next focus images" onClick={() => { setFocusOffset(value => value + view.focus); scroll.current?.scrollTo({ top: 0 }); }}><ChevronRight size={17} /></button></div>{focused.map((image, index) => card(image, { x: 12 + index % (view.focus === 1 ? 1 : 2) * (focusSize + 12), y: 36 + Math.floor(index / (view.focus === 1 ? 1 : 2)) * (focusImageHeight + 36) }, focusSize, focusImageHeight))}</>}
          {[...visible].map(index => card(rest[index], { x: geometry.padding + index % geometry.columns * geometry.columnWidth, y: focusHeight + geometry.padding + Math.floor(index / geometry.columns) * geometry.rowHeight }, geometry.imageWidth, geometry.imageHeight))}
          {!filtered.length && <div className="image-browser__empty" role="status"><strong>{emptyFolder ? !props.scopeId ? 'All images sorted' : hasSubStashes ? 'No direct images in this folder' : 'This folder is empty' : unsortedInStash ? `No unsorted images in ${props.destinationName}` : view.filter === 'unsorted' && !unsorted ? 'All images sorted' : matchingGroupSorted ? 'Matching images sorted' : 'No images match'}</strong>
            {unsortedInStash && directCount > 0 && <button type="button" onClick={showFolderImages}>Show this stash’s images</button>}
            {view.filter === 'unsorted' && unsorted > 0 ? <><span>{unsorted.toLocaleString()} unsorted {unsorted === 1 ? 'image' : 'images'} {unsortedInStash ? 'elsewhere' : unsorted === 1 ? 'remains' : 'remain'} in the project.</span><button type="button" onClick={continueUnsorted}>Continue with unsorted</button></>
              : <button type="button" onClick={() => { props.onDeselect(); changeFilters({ filter: 'all', stash: 'all', query: '', inFolder: false }); }}>Show all images</button>}
          </div>}
        </div>
      </div>
      {(!props.starterActive || selected.length > 0) && <footer className="image-browser__footer"><div className="image-browser__selection" role="status" aria-live="polite">{selected.length ? <span>{selected.length.toLocaleString()} selected{hiddenSelected ? selectedOnBoard ? ' on board' : ` · ${hiddenSelected} hidden` : ''}</span> : props.randomBatch ? <span>{waiting.length.toLocaleString()} waiting</span> : props.status ? <span>{props.status}</span> : null}</div>
        {!selected.length && !props.randomBatch ? <div className="image-browser__idle-space" aria-hidden="true" /> : <div className={!selected.length && props.randomBatch ? 'image-browser__random' : undefined}>{!selected.length && props.randomBatch ? <>
          <button type="button" className="image-browser__add" title={`Add a random batch from ${waiting.length.toLocaleString()} waiting images`} disabled={props.busy || deferredQuery !== view.query || !waiting.length} onClick={event => props.randomBatch!.onAdd(waiting, event.currentTarget.getBoundingClientRect())}><Shuffle size={16} />Add random</button>
          {waiting.length > 0 && <BatchCountPicker compact count={props.randomBatch.count} available={waiting.length} onChange={props.randomBatch.onCount} />}
        </> : selected.length && !addable.length ? <button type="button" className="image-browser__add" disabled={props.busy} onClick={() => props.onShow(selected.map(image => image.id))}><LocateFixed size={18} />Show on board</button>
          : <button type="button" className="image-browser__add" title={addingUnsorted ? 'Add selected images to the board' : `Move selected images into ${props.destinationName}`} aria-label={addingUnsorted ? 'Add to board' : 'Move here'} disabled={props.busy || !addable.length} onClick={add}>{addingUnsorted ? <Plus size={18} /> : <FolderInput size={18} />}{addingUnsorted ? 'Add to board' : <>Move here <span className="image-browser__destination">{props.destinationName}</span></>}</button>}</div>}
      </footer>}
    </>}
    {!expanded && !view.collapsed && <div className="image-browser__resize" role="separator" tabIndex={0} aria-label="Resize image browser" aria-orientation="vertical" aria-valuemin={260} aria-valuemax={560} aria-valuenow={view.width}
      onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); setView(current => ({ ...current, width: event.key === 'Home' ? 260 : event.key === 'End' ? 560 : Math.max(260, Math.min(560, current.width + (event.key === 'ArrowLeft' ? -16 : 16))) })); }}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); resize.current = { pointer: event.pointerId, x: event.clientX, width: view.width }; props.onInteracting(true); }}
      onPointerMove={event => { const active = resize.current; if (active?.pointer !== event.pointerId) return; setView(current => ({ ...current, width: Math.max(260, Math.min(560, active.width + event.clientX - active.x)) })); }}
      onPointerUp={() => { resize.current = undefined; props.onInteracting(false); }} onPointerCancel={() => { resize.current = undefined; props.onInteracting(false); }} onLostPointerCapture={() => { resize.current = undefined; props.onInteracting(false); }} />}
    {view.collapsed && <button type="button" className="image-browser__reopen" aria-label="Show image browser" onClick={() => setView(current => ({ ...current, collapsed: false }))}><ChevronLeft size={17} /><span>{props.images.length.toLocaleString()}</span></button>}
  </section>;
}
