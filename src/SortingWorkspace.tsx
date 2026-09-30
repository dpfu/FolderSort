import * as React from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Eye, FolderPlus, Layers3, Minus, Plus, Shuffle, Trash2, X } from 'lucide-react';
import { Board } from './Board';
import { DraggableCard } from './DraggableCard';
import { categoryDepth, imageInCategoryBranch } from './categoryTree';
import { getImageBlob, imageIsOnBoard, type LibraryCategory, type LibraryImage } from './libraryStore';
import type { CardData } from './types';
import './workspace.css';

type Point = { x: number; y: number };
type BoardMove = { id: string; x: number; y: number };

type Props = {
  projectName: string;
  images: LibraryImage[];
  categories: LibraryCategory[];
  busy: boolean;
  message: string;
  error: string;
  onBack: () => void;
  onOpenImage: (image: LibraryImage) => void;
  onAssign: (image: LibraryImage, categoryId: string | null) => void;
  onCreateCategory: (name: string) => Promise<void>;
  onPlaceOnBoard: (moves: BoardMove[]) => void;
  onReturnToPile: (ids: string[]) => void;
};

const WORLD_WIDTH = 2200;
const CARD_WIDTH = 172;
const TRAY_CARD_WIDTH = 112;
const TRAY_STEP = 68;
const TRAY_OVERSCAN = 320;
const MAX_CACHED_IMAGE_URLS = 64;

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function smallHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = (hash * 31 + value.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

function contains(rect: DOMRect | undefined, point: Point): boolean {
  return !!rect && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function asCard(image: LibraryImage, url: string | undefined, category: string | undefined, point: Point, z: number): CardData {
  return {
    id: image.id, kind: 'image', createdAt: image.addedAt, src: url,
    meta: { name: image.path.split('/').at(-1) || image.path, notes: '', aspectRatio: 1, tags: category ? [category] : [] },
    x: point.x, y: point.y, z,
  };
}

export default function SortingWorkspace({
  projectName, images, categories, busy, message, error, onBack, onOpenImage, onAssign,
  onCreateCategory, onPlaceOnBoard, onReturnToPile,
}: Props) {
  const workspaceRef = React.useRef<HTMLElement>(null);
  const boardRef = React.useRef<HTMLDivElement>(null);
  const boardPaneRef = React.useRef<HTMLDivElement>(null);
  const trayRef = React.useRef<HTMLDivElement>(null);
  const trayScrollRef = React.useRef<HTMLDivElement>(null);
  const ghostRef = React.useRef<HTMLDivElement>(null);
  const dragPointRef = React.useRef<Point | null>(null);
  const mountedRef = React.useRef(true);
  const urlsRef = React.useRef<Map<string, string>>(new Map());
  const pendingUrlsRef = React.useRef<Set<string>>(new Set());
  const visibleIdsRef = React.useRef<Set<string>>(new Set());
  const urlUpdateFrameRef = React.useRef<number | null>(null);
  const [objectUrls, setObjectUrls] = React.useState<Map<string, string>>(new Map());
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [trayOrder, setTrayOrder] = React.useState<string[]>([]);
  const [trayPositions, setTrayPositions] = React.useState<Map<string, Point>>(new Map());
  const [trayViewport, setTrayViewport] = React.useState({ left: 0, width: Math.max(320, window.innerWidth - 282) });
  const [pileNav, setPileNav] = React.useState({ left: false, right: false });
  const [zOrder, setZOrder] = React.useState<Map<string, number>>(new Map());
  const [dragging, setDragging] = React.useState<{ id: string } | null>(null);
  const [hoverCategoryId, setHoverCategoryId] = React.useState<string | null>(null);
  const [dealtIds, setDealtIds] = React.useState<string[]>([]);
  const [zoom, setZoom] = React.useState(1);
  const [drawSize, setDrawSize] = React.useState(3);
  const [treeOpen, setTreeOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [createParent, setCreateParent] = React.useState<LibraryCategory | null>(null);
  const [newCategory, setNewCategory] = React.useState('');
  const [createError, setCreateError] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  const boardImages = images.filter(imageIsOnBoard);
  const trayImages = images.filter((image) => !imageIsOnBoard(image));
  const boardIds = boardImages.map((image) => image.id).join(',');
  const trayIds = trayImages.map((image) => image.id).join(',');
  const selectedImage = images.find((image) => image.id === selectedId);
  const categoryById = new Map(categories.map((category) => [category.id, category.name]));
  const imageById = new Map(images.map((image) => [image.id, image]));
  const codedOnBoard = boardImages.filter((image) => !!image.categoryId);
  const boardRows = Math.ceil(boardImages.length / 8);
  const worldHeight = Math.max(1600, boardRows * 210 + 400,
    ...boardImages.map((image) => (image.boardY ?? 0) + 250));
  const worldSize = React.useMemo(() => ({ width: WORLD_WIDTH, height: worldHeight }), [worldHeight]);
  const initialCenter = React.useMemo(() => ({
    x: Math.min(760, Math.max(195, (window.innerWidth - (window.innerWidth > 700 ? 280 : 0)) / 2)),
    y: Math.min(480, Math.max(280, (window.innerHeight - 210) / 2)),
  }), []);

  React.useEffect(() => {
    const ids = new Set(trayImages.map((image) => image.id));
    setTrayOrder((current) => {
      const kept = current.filter((id) => ids.has(id));
      const known = new Set(kept);
      const added = shuffled(trayImages.map((image) => image.id).filter((id) => !known.has(id)));
      return kept.length === current.length && !added.length ? current : [...kept, ...added];
    });
  }, [trayIds]);

  React.useEffect(() => {
    const urls = urlsRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (urlUpdateFrameRef.current !== null) cancelAnimationFrame(urlUpdateFrameRef.current);
      urlUpdateFrameRef.current = null;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
      pendingUrlsRef.current.clear();
    };
  }, []);

  const traySequence = trayOrder.length ? trayOrder.map((id) => imageById.get(id)).filter((image): image is LibraryImage => !!image && !imageIsOnBoard(image)) : trayImages;
  // The pile can contain thousands of images, but only a small part of its
  // horizontal canvas is visible. Keep moved, selected, and dragged cards mounted.
  const visibleTrayCards: CardData[] = [];
  const viewportLeft = trayViewport.left - TRAY_OVERSCAN;
  const viewportRight = trayViewport.left + trayViewport.width + TRAY_OVERSCAN;
  for (let index = 0; index < traySequence.length; index++) {
    const image = traySequence[index];
    const hash = smallHash(image.id);
    const point = trayPositions.get(image.id) || { x: 26 + index * TRAY_STEP, y: 15 + hash % 36 };
    if (traySequence.length > 60 && point.x + TRAY_CARD_WIDTH < viewportLeft && image.id !== selectedId && image.id !== dragging?.id) continue;
    if (traySequence.length > 60 && point.x > viewportRight && image.id !== selectedId && image.id !== dragging?.id) continue;
    visibleTrayCards.push(asCard(image, objectUrls.get(image.id), image.categoryId ? categoryById.get(image.categoryId) : undefined,
      point, zOrder.get(image.id) || index + 1));
  }
  const visibleTrayIds = visibleTrayCards.map((card) => card.id).join(',');
  visibleIdsRef.current = new Set([...boardImages.map((image) => image.id), ...visibleTrayCards.map((card) => card.id)]);

  React.useEffect(() => {
    const scheduleUrlUpdate = () => {
      if (urlUpdateFrameRef.current !== null) return;
      urlUpdateFrameRef.current = requestAnimationFrame(() => {
        urlUpdateFrameRef.current = null;
        const urls = urlsRef.current;
        for (const [id, url] of urls) {
          if (urls.size <= MAX_CACHED_IMAGE_URLS) break;
          if (visibleIdsRef.current.has(id)) continue;
          URL.revokeObjectURL(url);
          urls.delete(id);
        }
        if (mountedRef.current) setObjectUrls(new Map(urls));
      });
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const id = (entry.target as HTMLElement).dataset.testid?.slice('card-'.length);
        if (!id || urlsRef.current.has(id) || pendingUrlsRef.current.has(id)) continue;
        pendingUrlsRef.current.add(id);
        void getImageBlob(id).then((blob) => {
          pendingUrlsRef.current.delete(id);
          if (!blob || !mountedRef.current || !visibleIdsRef.current.has(id) || urlsRef.current.has(id)) return;
          const url = URL.createObjectURL(blob);
          urlsRef.current.set(id, url);
          scheduleUrlUpdate();
        }).catch(() => pendingUrlsRef.current.delete(id));
      }
    }, { rootMargin: '300px' });
    workspaceRef.current?.querySelectorAll<HTMLElement>('[data-testid^="card-"]').forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [boardIds, visibleTrayIds]);

  React.useEffect(() => {
    if (selectedId && !images.some((image) => image.id === selectedId)) setSelectedId(null);
  }, [images, selectedId]);

  React.useEffect(() => {
    const workspace = workspaceRef.current;
    const preventWorkspaceSelection = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
    };
    workspace?.addEventListener('selectstart', preventWorkspaceSelection);
    return () => workspace?.removeEventListener('selectstart', preventWorkspaceSelection);
  }, []);

  React.useEffect(() => {
    const scroll = trayScrollRef.current;
    if (!scroll) return;
    let frame: number | null = null;
    const updateNav = () => {
      const next = { left: scroll.scrollLeft > 2, right: scroll.scrollLeft + scroll.clientWidth < scroll.scrollWidth - 2 };
      setPileNav((current) => current.left === next.left && current.right === next.right ? current : next);
      setTrayViewport((current) => current.left === scroll.scrollLeft && current.width === scroll.clientWidth
        ? current : { left: scroll.scrollLeft, width: scroll.clientWidth });
    };
    const scheduleUpdate = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; updateNav(); });
    };
    const wheelAcrossPile = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const before = scroll.scrollLeft;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 32
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? scroll.clientWidth : 1;
      scroll.scrollLeft += event.deltaY * unit;
      if (scroll.scrollLeft !== before) event.preventDefault();
    };
    const resize = new ResizeObserver(scheduleUpdate);
    resize.observe(scroll);
    scroll.addEventListener('scroll', scheduleUpdate, { passive: true });
    scroll.addEventListener('wheel', wheelAcrossPile, { passive: false });
    updateNav();
    return () => {
      resize.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      scroll.removeEventListener('scroll', scheduleUpdate);
      scroll.removeEventListener('wheel', wheelAcrossPile);
    };
  }, [trayIds]);

  const boardCards = boardImages.map((image, index) => asCard(image, objectUrls.get(image.id),
    image.categoryId ? categoryById.get(image.categoryId) : undefined,
    { x: image.boardX ?? 110 + index % 8 * 205, y: image.boardY ?? 130 + Math.floor(index / 8) * 215 },
    zOrder.get(image.id) || index + 1));

  const categoryAt = (point: Point): string | null => {
    const element = document.elementFromPoint(point.x, point.y);
    return element?.closest<HTMLElement>('[data-category-drop-id]')?.dataset.categoryDropId || null;
  };
  const boardPointAt = (point: Point): Point | null => {
    if (!contains(boardPaneRef.current?.getBoundingClientRect(), point)) return null;
    const canvas = boardRef.current?.querySelector<HTMLElement>('[data-testid="board-canvas"]');
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return null;
    return { x: Math.max(0, Math.round((point.x - rect.left) / zoom - CARD_WIDTH / 2)),
      y: Math.max(0, Math.round((point.y - rect.top) / zoom - CARD_WIDTH / 2)) };
  };
  const onDragStart = (id: string, point: Point) => {
    dragPointRef.current = point;
    setDragging({ id });
  };
  const onDragMove = (id: string, point: Point) => {
    void id;
    dragPointRef.current = point;
    if (ghostRef.current) {
      ghostRef.current.style.left = `${point.x}px`;
      ghostRef.current.style.top = `${point.y}px`;
    }
    setHoverCategoryId(categoryAt(point));
  };
  const onDragEnd = () => { dragPointRef.current = null; setDragging(null); setHoverCategoryId(null); };
  const bringToFront = (id: string) => setZOrder((current) => new Map(current).set(id, Math.max(0, ...current.values()) + images.length + 1));
  const placeAt = (id: string, point: Point) => {
    let candidate = { ...point };
    for (let attempt = 0; attempt < 30; attempt++) {
      if (!boardCards.some((card) => Math.abs(card.x - candidate.x) < 162 && Math.abs(card.y - candidate.y) < 162)) break;
      candidate = { ...candidate, y: candidate.y + 192 };
    }
    setDealtIds((current) => [...current, id]);
    onPlaceOnBoard([{ id, x: candidate.x, y: candidate.y }]);
    window.setTimeout(() => setDealtIds((current) => current.filter((item) => item !== id)), 800);
  };
  const drawAt = (point: Point) => {
    const chosen = shuffled(trayImages).slice(0, drawSize);
    if (!chosen.length) return;
    const occupied = boardCards.map((card) => ({ x: card.x, y: card.y }));
    const moves = chosen.map((image, index) => {
      let candidate = { x: Math.max(0, point.x + (index % 3) * 192 - 192), y: Math.max(0, point.y + Math.floor(index / 3) * 192) };
      for (let attempt = 0; attempt < 30; attempt++) {
        if (!occupied.some((other) => Math.abs(other.x - candidate.x) < 162 && Math.abs(other.y - candidate.y) < 162)) break;
        candidate = { ...candidate, y: candidate.y + 192 };
      }
      occupied.push(candidate);
      return { id: image.id, x: candidate.x, y: candidate.y };
    });
    setDealtIds(moves.map((move) => move.id));
    onPlaceOnBoard(moves);
    window.setTimeout(() => setDealtIds([]), 800);
  };

  const onBoardMoveEnd = (id: string, x: number, y: number, _dropPoint?: Point, screenPoint?: Point): boolean => {
    if (!screenPoint) { onPlaceOnBoard([{ id, x: Math.max(0, x), y: Math.max(0, y) }]); return true; }
    const categoryId = categoryAt(screenPoint);
    if (categoryId) { const image = imageById.get(id); if (image) onAssign(image, categoryId); return false; }
    if (contains(trayRef.current?.getBoundingClientRect(), screenPoint)) { onReturnToPile([id]); return true; }
    if (contains(boardPaneRef.current?.getBoundingClientRect(), screenPoint)) {
      onPlaceOnBoard([{ id, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) }]);
      return true;
    }
    return false;
  };
  const onTrayMoveEnd = (id: string, x: number, y: number, _dropPoint?: Point, screenPoint?: Point): boolean => {
    if (!screenPoint) return false;
    const categoryId = categoryAt(screenPoint);
    if (categoryId) { const image = imageById.get(id); if (image) onAssign(image, categoryId); return false; }
    const boardPoint = boardPointAt(screenPoint);
    if (boardPoint) { placeAt(id, boardPoint); return true; }
    if (contains(trayRef.current?.getBoundingClientRect(), screenPoint)) {
      setTrayPositions((current) => new Map(current).set(id, { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.min(68, Math.round(y))) }));
      return true;
    }
    return false;
  };

  const plusPoints = [
    { x: Math.max(25, initialCenter.x - 200), y: Math.max(90, initialCenter.y - 110) },
    { x: initialCenter.x + 160, y: initialCenter.y + 35 },
    { x: Math.max(25, initialCenter.x - 110), y: initialCenter.y + 190 },
  ].filter((point) => !boardCards.some((card) =>
    point.x < card.x + CARD_WIDTH + 16 && point.x + 80 > card.x - 16 &&
    point.y < card.y + CARD_WIDTH + 16 && point.y + 80 > card.y - 16));
  const visibleCategories = categories.filter((category) => !categories.some((parent) =>
    collapsed.has(parent.id) && category.name.startsWith(`${parent.name}/`)));
  const overlayImage = dragging ? imageById.get(dragging.id) : undefined;

  return <main ref={workspaceRef} className="sorting-workspace" aria-label="Sorting workspace"
    onLoadCapture={(event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || !image.classList.contains('cardPreview__img')) return;
      const card = image.closest<HTMLElement>('.card');
      if (!card || !image.naturalWidth || !image.naturalHeight) return;
      const scale = Math.min(card.clientWidth / image.naturalWidth, card.clientHeight / image.naturalHeight);
      card.style.setProperty('--image-fit-width', `${image.naturalWidth * scale}px`);
      card.style.setProperty('--image-fit-height', `${image.naturalHeight * scale}px`);
    }}>
    <h1 className="sorting-workspace__visually-hidden">Sort images</h1>
    <div className="sorting-workspace__board" ref={boardPaneRef} role="region" aria-label="Sorting board area">
      <Board mode="sort" sortConfig={{ type: 'open', zoomEnabled: true }} cards={boardCards}
        baseCardWidth={CARD_WIDTH} cardLayoutMode="as-is" showSortSelection showCategoryLabels
        dealtCardIds={dealtIds} allowExternalDrag
        boardOverlay={plusPoints.map((point, index) => <button key={index} type="button" className="sorting-workspace__plus"
          style={{ left: point.x, top: point.y }} aria-label={`Add ${drawSize} random images here`}
          disabled={!trayImages.length || busy} onClick={() => drawAt(point)}><Plus size={26} /></button>)}
        selectedCardIds={selectedImage && imageIsOnBoard(selectedImage) ? [selectedId!] : []}
        viewScale={zoom} viewCenter={initialCenter} worldSize={worldSize} panEnabled
        boardRef={boardRef} dragEnabled onFilesAdded={() => {}}
        onBringToFront={bringToFront} onSelectCard={(id) => setSelectedId(id)}
        onClearSelection={() => setSelectedId(null)}
        onOpenPreview={(id) => { const image = imageById.get(id); if (image) onOpenImage(image); }}
        onMoveEnd={onBoardMoveEnd} onDragScreenStart={onDragStart}
        onDragScreenMove={onDragMove} onDragScreenEnd={onDragEnd} />
      {boardImages.length === 0 && <div className="sorting-workspace__board-hint">Click a + to draw images, or drag them up from the pile.</div>}
      <button className="sorting-workspace__close" type="button" aria-label="Back to project" title={`Back to ${projectName}`} onClick={onBack}><X size={22} /></button>
      <div className="sorting-workspace__board-actions" aria-label="Board actions">
        <button type="button" disabled={!codedOnBoard.length || busy} title="Return coded images to the pile; keep their categories" onClick={() => onReturnToPile(codedOnBoard.map((image) => image.id))}><Layers3 size={15} /> Clear coded <span>{codedOnBoard.length}</span></button>
        <button type="button" disabled={!boardImages.length || busy} title="Return all board images to the pile; keep their categories" onClick={() => onReturnToPile(boardImages.map((image) => image.id))}><Trash2 size={15} /> Clear board</button>
      </div>
      <div className="sorting-workspace__zoom" role="group" aria-label="Board zoom">
        <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(.45, Math.round((value - .15) * 100) / 100))}><Minus size={17} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2, Math.round((value + .15) * 100) / 100))}><Plus size={17} /></button>
      </div>
      <button className="sorting-workspace__tree-toggle" type="button" aria-label="Show categories" onClick={() => setTreeOpen(true)}>Categories <ChevronRight size={16} /></button>
    </div>

    <section className="sorting-workspace__tray" ref={trayRef} aria-label="Image pile">
      <div className="sorting-workspace__tray-head">
        <div><strong>Image pile</strong><span>{trayImages.length} of {images.length} images</span></div>
        <div className="sorting-workspace__tray-tools">
          <div className="sorting-workspace__draw-size" role="group" aria-label="Images per draw">
            {[1, 3, 5].map((size) => <button key={size} type="button" aria-label={`Draw ${size} ${size === 1 ? 'image' : 'images'}`} aria-pressed={drawSize === size} className={drawSize === size ? 'is-active' : ''} onClick={() => setDrawSize(size)}>{size}</button>)}
          </div>
          <button type="button" className="sorting-workspace__shuffle" disabled={trayImages.length < 2} onClick={() => { setTrayPositions(new Map()); setTrayOrder(shuffled(traySequence.map((image) => image.id))); }}><Shuffle size={16} /> Shuffle pile</button>
        </div>
      </div>
      <div className="sorting-workspace__tray-scroll" ref={trayScrollRef} tabIndex={0} aria-label="Scroll image pile">
        <div className="sorting-workspace__tray-canvas" style={{ width: Math.max(650, traySequence.length * TRAY_STEP + 140) }}>
          {visibleTrayCards.map((card) => <DraggableCard key={card.id} card={card} cardW={TRAY_CARD_WIDTH} cardH={TRAY_CARD_WIDTH}
            mode="sort" isSelected={selectedId === card.id} dragEnabled onBringToFront={bringToFront}
            onMoveEnd={onTrayMoveEnd} onDragScreenStart={onDragStart} onDragScreenMove={onDragMove} onDragScreenEnd={onDragEnd}
            onSelectCard={(id) => setSelectedId(id)} onKeyboardMove={(id, direction) => { if (direction === 'up') placeAt(id, { x: initialCenter.x, y: initialCenter.y }); }}
            onOpenPreview={(id) => { const image = imageById.get(id); if (image) onOpenImage(image); }}
            categoryLabel={card.meta.tags[0]} />)}
        </div>
      </div>
      {pileNav.left && <button className="sorting-workspace__pile-nav sorting-workspace__pile-nav--left" type="button" aria-label="Scroll pile left"
        onClick={() => trayScrollRef.current?.scrollBy({ left: -trayScrollRef.current.clientWidth * .8, behavior: 'smooth' })}><ChevronLeft size={22} /></button>}
      {pileNav.right && <button className="sorting-workspace__pile-nav sorting-workspace__pile-nav--right" type="button" aria-label="Scroll pile right"
        onClick={() => trayScrollRef.current?.scrollBy({ left: trayScrollRef.current.clientWidth * .8, behavior: 'smooth' })}><ChevronRight size={22} /></button>}
      {trayImages.length === 0 && <p className="sorting-workspace__tray-empty">All images are on the board. Return a card here or clear the board to start again.</p>}
    </section>

    <aside className={`sorting-workspace__tree${treeOpen ? ' sorting-workspace__tree--open' : ''}`} aria-label="Categories">
      <div className="sorting-workspace__tree-head"><div><strong>Categories</strong><span>{categories.length} codes and subcodes</span></div>
        <button type="button" aria-label="Add category" title="Add category" onClick={() => { setCreateParent(null); setNewCategory(''); setCreateError(''); }}><FolderPlus size={19} /></button>
        <button className="sorting-workspace__tree-close" type="button" aria-label="Close categories" onClick={() => setTreeOpen(false)}><X size={18} /></button>
      </div>
      <form className="sorting-workspace__tree-create" onSubmit={(event) => {
        event.preventDefault(); if (!newCategory.trim()) return;
        setCreating(true); setCreateError('');
        void onCreateCategory(createParent ? `${createParent.name}/${newCategory}` : newCategory)
          .then(() => { setNewCategory(''); setCreateParent(null); })
          .catch((cause) => setCreateError(cause instanceof Error ? cause.message : String(cause)))
          .finally(() => setCreating(false));
      }}>
        {createParent && <span>Inside {createParent.name} <button type="button" aria-label="Create top-level category instead" onClick={() => setCreateParent(null)}><X size={12} /></button></span>}
        <div><input aria-label="New category name" placeholder="New category" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} />
          <button type="submit" aria-label="Create category" disabled={creating || !newCategory.trim()}><Plus size={18} /></button></div>
        {createError && <small role="alert">{createError}</small>}
      </form>
      <div className="sorting-workspace__tree-list">
        {categories.length === 0 && <p>Create a category, then drag an image onto it.</p>}
        {visibleCategories.map((category) => {
          const children = categories.some((child) => child.name.startsWith(`${category.name}/`) && categoryDepth(child.name) === categoryDepth(category.name) + 1);
          const count = images.filter((image) => imageInCategoryBranch(image, category.id, categoryById)).length;
          return <div key={category.id} className={`sorting-workspace__tree-row${hoverCategoryId === category.id ? ' is-drop-target' : ''}`}
            style={{ paddingLeft: 3 + Math.min(5, categoryDepth(category.name)) * 13 }} data-category-drop-id={category.id}>
            {children ? <button type="button" aria-label={`${collapsed.has(category.id) ? 'Expand' : 'Collapse'} ${category.name}`} onClick={() => setCollapsed((current) => {
              const next = new Set(current); if (next.has(category.id)) next.delete(category.id); else next.add(category.id); return next;
            })}>{collapsed.has(category.id) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</button> : <span className="sorting-workspace__tree-spacer" />}
            <button type="button" className="sorting-workspace__tree-label" aria-label={selectedImage ? `Assign ${selectedImage.path} to ${category.name}` : category.name}
              title={category.name} onClick={() => { if (selectedImage) onAssign(selectedImage, category.id); }}><span>{category.name.split('/').at(-1)}</span><small>{count}</small></button>
            <button type="button" aria-label={`Add subcategory to ${category.name}`} title="Add subcategory" onClick={() => { setCreateParent(category); setNewCategory(''); setCreateError(''); }}><Plus size={14} /></button>
          </div>;
        })}
      </div>
      <p className="sorting-workspace__tree-help">Drag a card here to assign a category. It stays on the board or in the pile.</p>
    </aside>

    {selectedImage && <section className="sorting-workspace__inspector" aria-label={`Sort ${selectedImage.path}`}>
      <div className="sorting-workspace__inspector-head"><strong title={selectedImage.path}>{selectedImage.path.split('/').at(-1)}</strong><button type="button" aria-label="Close selection" onClick={() => setSelectedId(null)}><X size={17} /></button></div>
      <label className="sorting-workspace__category-select">Category
        <select aria-label={`Category for ${selectedImage.path}`} disabled={busy} value={selectedImage.categoryId || ''} onChange={(event) => onAssign(selectedImage, event.target.value || null)}>
          <option value="">Unassigned</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>
      <div className="sorting-workspace__inspector-actions">
        <button type="button" onClick={() => imageIsOnBoard(selectedImage)
          ? onReturnToPile([selectedImage.id]) : placeAt(selectedImage.id, { x: initialCenter.x, y: initialCenter.y })}>
          {imageIsOnBoard(selectedImage) ? 'Return to pile' : 'Add to board'}</button>
        <button type="button" onClick={() => onOpenImage(selectedImage)}><Eye size={15} /> View image</button>
      </div>
    </section>}

    {dragging && overlayImage && <div ref={ghostRef} className="sorting-workspace__drag-ghost" style={{ left: dragPointRef.current?.x, top: dragPointRef.current?.y }} aria-hidden="true">
      {objectUrls.get(overlayImage.id) ? <img src={objectUrls.get(overlayImage.id)} alt="" /> : <span>{overlayImage.path.split('/').at(-1)}</span>}
    </div>}
    {(error || message || busy) && <div className={`sorting-workspace__notice${error ? ' sorting-workspace__notice--error' : ''}`} role={error ? 'alert' : 'status'}>{error || (busy ? 'Saving…' : message)}</div>}
  </main>;
}
