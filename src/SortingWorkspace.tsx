import * as React from 'react';
import { ArrowDownUp, CheckCheck, ChevronLeft, ChevronRight, Eye, Layers3, Maximize2, Minus, MousePointer2, Pause, Play, Plus, ScanSearch, Shuffle, Trash2, X } from 'lucide-react';
import { Board } from './Board';
import { DraggableCard } from './DraggableCard';
import { categoryColor, imageInCategoryBranch } from './categoryTree';
import { imageIsOnBoard, type CategoryAssignment, type LibraryCategory, type LibraryImage } from './libraryStore';
import CategoryPanel from './CategoryPanel';
import { orderByMetadata, type PileOrder, type SimilarMatch } from './imageAnalysis';
import { useImageAnalysis } from './useImageAnalysis';
import { useContentAnalysis } from './useContentAnalysis';
import { useThumbnailCache, useThumbnails } from './imageThumbnails';
import PileOverview from './PileOverview';
import { PileOrderOptions } from './PileOrderOptions';
import { arrangeBoardBatch } from './pileLayout';
import type { CameraView } from './camera';
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
  onAssign: (assignments: CategoryAssignment[]) => Promise<void>;
  onCreateCategory: (name: string) => Promise<LibraryCategory>;
  onPlaceOnBoard: (moves: BoardMove[]) => void;
  onReturnToPile: (ids: string[]) => void;
};

const WORLD_WIDTH = 2200;
const CARD_WIDTH = 172;
const TRAY_CARD_WIDTH = 112;
const TRAY_STEP = 68;
const TRAY_OVERSCAN = 320;

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
  const dragAnchorRef = React.useRef<Point>({ x: .5, y: .5 });
  const mountedRef = React.useRef(true);
  const thumbnails = useThumbnailCache();
  const objectUrls = thumbnails.urls;
  const [overviewOpen, setOverviewOpen] = React.useState(false);
  const [boardWindow, setBoardWindow] = React.useState({ left: -280, top: -280, right: window.innerWidth + 280, bottom: window.innerHeight + 280 });
  const updateBoardWindow = React.useCallback((view: CameraView) => {
    const next = {
      left: Math.floor((view.centerX - view.viewportW / view.scale / 2 - 280) / 128) * 128,
      top: Math.floor((view.centerY - view.viewportH / view.scale / 2 - 280) / 128) * 128,
      right: Math.ceil((view.centerX + view.viewportW / view.scale / 2 + 280) / 128) * 128,
      bottom: Math.ceil((view.centerY + view.viewportH / view.scale / 2 + 280) / 128) * 128,
    };
    setBoardWindow(current => Object.keys(next).every(key => current[key as keyof typeof next] === next[key as keyof typeof next]) ? current : next);
  }, []);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [multiSelect, setMultiSelect] = React.useState(false);
  const [focusedCategoryId, setFocusedCategoryId] = React.useState<string | null>(null);
  const [categoryNotice, setCategoryNotice] = React.useState('');
  const [undoAssignments, setUndoAssignments] = React.useState<CategoryAssignment[]>([]);
  const assignmentLock = React.useRef(false);
  const [overviewCategory, setOverviewCategory] = React.useState<{ id: string; revision: number }>();
  const [trayOrder, setTrayOrder] = React.useState<string[]>([]);
  const [trayPositions, setTrayPositions] = React.useState<Map<string, Point>>(new Map());
  const [trayViewport, setTrayViewport] = React.useState({ left: 0, width: Math.max(320, window.innerWidth - 282) });
  const [pileNav, setPileNav] = React.useState({ left: false, right: false });
  const [zOrder, setZOrder] = React.useState<Map<string, number>>(new Map());
  const [dragging, setDragging] = React.useState<{ id: string; anchor: Point } | null>(null);
  const [hoverCategoryId, setHoverCategoryId] = React.useState<string | null>(null);
  const [dealtIds, setDealtIds] = React.useState<string[]>([]);
  const [zoom, setZoom] = React.useState(1);
  const [drawSize, setDrawSize] = React.useState(3);
  const [treeOpen, setTreeOpen] = React.useState(false);
  const [pileOrder, setPileOrder] = React.useState<PileOrder>('random');
  const [reverseOrder, setReverseOrder] = React.useState(false);
  const [similarityIds, setSimilarityIds] = React.useState<string[]>([]);
  const [contentIds, setContentIds] = React.useState<string[]>([]);
  const [similarityMethod, setSimilarityMethod] = React.useState<'visual' | 'clip'>('visual');
  const [preparingOrder, setPreparingOrder] = React.useState(false);
  const [matching, setMatching] = React.useState(false);
  const [analysisNotice, setAnalysisNotice] = React.useState('');
  const imagesRef = React.useRef(images);
  imagesRef.current = images;
  const { metadata, progress: analysisProgress, ensure: ensureAnalysis, client: analysisClient, hashes } = useImageAnalysis(images);
  const { progress: clipProgress, revision: clipRevision, start: startClip, pause: pauseClip,
    deactivate: deactivateClip, retrySkipped: retrySkippedClip, ensureReferences: ensureClipReferences, order: orderContent, similar: similarContent, setInteracting: clipInteraction } = useContentAnalysis(images);

  const boardImages = React.useMemo(() => images.filter(imageIsOnBoard), [images]);
  const trayImages = React.useMemo(() => images.filter((image) => !imageIsOnBoard(image)), [images]);
  const trayIds = trayImages.map((image) => image.id).join(',');
  const allIds = images.map((image) => image.id).join(',');
  const selectedImages = React.useMemo(() => images.filter(image => selectedIds.has(image.id)), [images, selectedIds]);
  const categoryById = React.useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  const imageById = React.useMemo(() => new Map(images.map((image) => [image.id, image])), [images]);
  const imageColors = React.useMemo(() => new Map(images.flatMap(image => {
    const name = image.categoryId ? categoryById.get(image.categoryId) : undefined;
    return name ? [[image.id, categoryColor(name)] as [string, string]] : [];
  })), [images, categoryById]);
  const categoryFocusIds = React.useMemo(() => focusedCategoryId ? new Set(images.filter(image => focusedCategoryId === 'unassigned' ? !image.categoryId : imageInCategoryBranch(image, focusedCategoryId, categoryById)).map(image => image.id)) : undefined, [images, focusedCategoryId, categoryById]);
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
    const ids = new Set(images.map((image) => image.id));
    setTrayOrder((current) => {
      const kept = current.filter((id) => ids.has(id));
      const known = new Set(kept);
      const added = shuffled(images.map((image) => image.id).filter((id) => !known.has(id)));
      return kept.length === current.length && !added.length ? current : [...kept, ...added];
    });
  }, [allIds]);

  React.useEffect(() => {
    if (!['similarity', 'modified', 'resolution', 'aspect'].includes(pileOrder)) { setPreparingOrder(false); return; }
    let active = true;
    setPreparingOrder(true);
    setAnalysisNotice('');
    void (async () => {
      await ensureAnalysis(pileOrder === 'modified' ? 'dates' : 'visual');
      if (!active) return;
      if (pileOrder === 'similarity') {
        const ids = await analysisClient().order(hashes(imagesRef.current));
        if (active) setSimilarityIds(ids);
      }
    })().catch((cause) => {
      if (active) setAnalysisNotice(cause instanceof Error ? cause.message : 'Could not prepare image order.');
    }).finally(() => { if (active) setPreparingOrder(false); });
    return () => { active = false; };
  }, [pileOrder, allIds, ensureAnalysis, analysisClient, hashes]);

  React.useEffect(() => {
    if (similarityMethod === 'clip') void startClip().catch(() => {});
    else deactivateClip();
  }, [similarityMethod, allIds, startClip, deactivateClip]);

  React.useEffect(() => {
    if (pileOrder !== 'semantic') return;
    let active = true;
    // Update order after a completed/paused batch, never underneath a drag on
    // every newly indexed image. Unindexed images remain accessible at the end.
    void orderContent(imagesRef.current.map((image) => image.id)).then((ids) => {
      if (active) setContentIds(ids);
    }).catch((cause) => { if (active && !(cause instanceof DOMException && cause.name === 'AbortError')) setAnalysisNotice(cause instanceof Error ? cause.message : 'Could not order by content.'); });
    return () => { active = false; };
  }, [pileOrder, allIds, clipRevision, orderContent]);

  React.useEffect(() => {
    if (!analysisNotice) return;
    const timer = window.setTimeout(() => setAnalysisNotice(''), 7000);
    return () => window.clearTimeout(timer);
  }, [analysisNotice]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const orderedImages = React.useMemo(() => {
    if (pileOrder !== 'random' && pileOrder !== 'similarity' && pileOrder !== 'semantic') return orderByMetadata(images, pileOrder, metadata, reverseOrder);
    const ids = pileOrder === 'semantic' ? contentIds : pileOrder === 'similarity' ? similarityIds : trayOrder;
    const byId = new Map(images.map((image) => [image.id, image]));
    const ordered = ids.flatMap((id) => { const image = byId.get(id); byId.delete(id); return image ? [image] : []; });
    const result = [...ordered, ...byId.values()];
    return reverseOrder ? result.reverse() : result;
  }, [images, pileOrder, metadata, reverseOrder, similarityIds, contentIds, trayOrder]);
  const traySequence = React.useMemo(() => orderedImages.filter(image => !imageIsOnBoard(image)), [orderedImages]);
  const boardCards = React.useMemo(() => boardImages.map((image, index) => asCard(image, undefined,
    image.categoryId ? categoryById.get(image.categoryId) : undefined,
    { x: image.boardX ?? 110 + index % 8 * 205, y: image.boardY ?? 130 + Math.floor(index / 8) * 215 },
    zOrder.get(image.id) || index + 1)), [boardImages, categoryById, zOrder]);
  const visibleBoardCards = boardCards.filter(card => card.id === selectedId || card.id === dragging?.id ||
    card.x + CARD_WIDTH >= boardWindow.left && card.x <= boardWindow.right && card.y + CARD_WIDTH >= boardWindow.top && card.y <= boardWindow.bottom)
    .map(card => ({ ...card, src: objectUrls.get(card.id) }));
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
  useThumbnails(thumbnails, [...visibleBoardCards.map(card => card.id), ...visibleTrayCards.map(card => card.id)], !overviewOpen);

  React.useEffect(() => {
    if (selectedId && !images.some((image) => image.id === selectedId)) setSelectedId(null);
    const available = new Set(images.map(image => image.id));
    setSelectedIds(current => [...current].every(id => available.has(id)) ? current : new Set([...current].filter(id => available.has(id))));
  }, [images, selectedId]);

  const clearSelection = () => { setSelectedIds(new Set()); setSelectedId(null); };
  const closeCategories = () => {
    setTreeOpen(false);
    if (window.innerWidth <= 700) window.requestAnimationFrame(() => workspaceRef.current?.querySelector<HTMLElement>('[aria-label="Choose category for selected images"], [aria-label="Show categories"]')?.focus({ preventScroll: true }));
  };
  const selectImage = (id: string, options?: { toggle?: boolean }) => {
    setSelectedId(id);
    setSelectedIds(current => {
      if (!options?.toggle && !multiSelect) return new Set([id]);
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const dragSelection = (id: string) => selectedIds.has(id) ? [...selectedIds] : [id];

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

  const categoryAt = (point: Point): string | null => {
    const element = document.elementFromPoint(point.x, point.y);
    return element?.closest<HTMLElement>('[data-category-drop-id]')?.dataset.categoryDropId || null;
  };
  const boardPointAt = (point: Point, anchor: Point = { x: .5, y: .5 }): Point | null => {
    if (!contains(boardPaneRef.current?.getBoundingClientRect(), point)) return null;
    const canvas = boardRef.current?.querySelector<HTMLElement>('[data-testid="board-canvas"]');
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return null;
    return { x: Math.max(0, Math.round((point.x - rect.left) / zoom - CARD_WIDTH * anchor.x)),
      y: Math.max(0, Math.round((point.y - rect.top) / zoom - CARD_WIDTH * anchor.y)) };
  };
  const visibleBoardCenter = (): Point => {
    const rect = boardPaneRef.current?.getBoundingClientRect();
    const point = rect && boardPointAt({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    return point || { x: initialCenter.x - CARD_WIDTH / 2, y: initialCenter.y - CARD_WIDTH / 2 };
  };
  const dragPreviewSize = (id: string, point: Point): number => {
    if (contains(boardPaneRef.current?.getBoundingClientRect(), point)) return CARD_WIDTH * zoom;
    if (contains(trayRef.current?.getBoundingClientRect(), point)) return TRAY_CARD_WIDTH;
    const image = imageById.get(id);
    return image && imageIsOnBoard(image) ? CARD_WIDTH * zoom : TRAY_CARD_WIDTH;
  };
  const onDragStart = (id: string, point: Point, anchor: Point) => {
    clipInteraction(true);
    dragPointRef.current = point;
    dragAnchorRef.current = anchor;
    setDragging({ id, anchor });
  };
  const onDragMove = (id: string, point: Point) => {
    dragPointRef.current = point;
    if (ghostRef.current) {
      const size = dragPreviewSize(id, point);
      ghostRef.current.style.left = `${point.x}px`;
      ghostRef.current.style.top = `${point.y}px`;
      ghostRef.current.style.width = `${size}px`;
      ghostRef.current.style.height = `${size}px`;
    }
    setHoverCategoryId(categoryAt(point));
  };
  const onDragEnd = () => { clipInteraction(false); dragPointRef.current = null; setDragging(null); setHoverCategoryId(null); };
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
  const dealImages = (chosen: LibraryImage[], point: Point) => {
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
  const drawAt = (point: Point) => dealImages(
    (pileOrder === 'random' ? shuffled(trayImages) : traySequence).slice(0, drawSize), point);

  const changePileOrder = (order: PileOrder) => {
    setPileOrder(order); setReverseOrder(false); setTrayPositions(new Map()); setAnalysisNotice('');
    if (order === 'semantic') setSimilarityMethod('clip');
    if (order === 'similarity') setSimilarityMethod('visual');
    trayScrollRef.current?.scrollTo({ left: 0 });
  };
  const reversePileOrder = () => { setReverseOrder(value => !value); setTrayPositions(new Map()); trayScrollRef.current?.scrollTo({ left: 0 }); };
  const shufflePile = () => { changePileOrder('random'); setTrayOrder(shuffled(images.map(image => image.id))); };
  const addMarkedToBoard = (ids: string[]) => {
    const eligible = ids.filter(id => { const image = imageById.get(id); return image && !imageIsOnBoard(image); });
    if (!eligible.length) return;
    const pane = boardPaneRef.current?.getBoundingClientRect();
    const center = visibleBoardCenter();
    const width = pane ? pane.width / zoom : 600;
    const height = pane ? pane.height / zoom : 600;
    const columns = Math.max(1, Math.min(10, Math.max(Math.floor((width - 40) / 192), Math.ceil(eligible.length / 400))));
    const rows = Math.ceil(eligible.length / columns);
    const origin = {
      x: Math.max(16, Math.min(WORLD_WIDTH - columns * 192, center.x + CARD_WIDTH / 2 - columns * 192 / 2)),
      y: Math.max(16, center.y + CARD_WIDTH / 2 - Math.min(rows * 192, height - 160) / 2),
    };
    const moves = arrangeBoardBatch(eligible, boardCards, origin, columns);
    clearSelection(); setDealtIds(moves.slice(0, 24).map(move => move.id));
    onPlaceOnBoard(moves); setOverviewOpen(false);
    setAnalysisNotice(`Added ${eligible.length.toLocaleString()} ${eligible.length === 1 ? 'image' : 'images'} to the board.`);
    window.setTimeout(() => setDealtIds([]), 800);
  };

  const assignCategory = async (ids: string[], categoryId: string | null, name?: string) => {
    if (assignmentLock.current || busy || !ids.length) return;
    const latest = new Map(imagesRef.current.map(image => [image.id, image]));
    const selected = [...new Set(ids)].flatMap(id => { const image = latest.get(id); return image ? [image] : []; });
    if (!selected.length) return;
    const newBoardIds = categoryId ? selected.filter(image => !imageIsOnBoard(image)).map(image => image.id) : [];
    const pane = boardPaneRef.current?.getBoundingClientRect();
    const columns = Math.max(1, Math.min(10, Math.max(Math.floor(((pane?.width || 600) / zoom - 40) / 192), Math.ceil(newBoardIds.length / 400))));
    const center = visibleBoardCenter();
    const moves = new Map(arrangeBoardBatch(newBoardIds, boardCards, newBoardIds.length === 1 ? center : {
      x: Math.max(16, Math.min(WORLD_WIDTH - columns * 192, center.x + CARD_WIDTH / 2 - columns * 192 / 2)),
      y: Math.max(16, center.y - 96),
    }, columns).map(move => [move.id, move]));
    const changes = selected.map(image => ({ id: image.id, categoryId, ...(moves.has(image.id) ? { boardPosition: moves.get(image.id)! } : {}) }));
    if (changes.every(change => latest.get(change.id)?.categoryId === categoryId && !change.boardPosition)) {
      setCategoryNotice(categoryId ? `Already assigned to ${name || categoryById.get(categoryId)}.` : 'Already unassigned.');
      return;
    }
    assignmentLock.current = true;
    try {
      await onAssign(changes);
      setUndoAssignments(selected.map(image => ({ id: image.id, categoryId: image.categoryId })));
      setCategoryNotice(`${selected.length === 1 ? 'Image' : `${selected.length.toLocaleString()} images`} ${categoryId ? `assigned to ${name || categoryById.get(categoryId) || 'category'}` : 'now unassigned'}.${newBoardIds.length ? ' Added to board.' : ''}`);
      if (multiSelect) clearSelection();
      if (window.innerWidth <= 700) closeCategories();
    } finally { assignmentLock.current = false; }
  };
  const undoCategory = () => {
    if (!undoAssignments.length || assignmentLock.current || busy) return;
    assignmentLock.current = true;
    void onAssign(undoAssignments).then(() => { setUndoAssignments([]); setCategoryNotice('Category assignment undone.'); })
      .catch(() => {}).finally(() => { assignmentLock.current = false; });
  };
  const assignDropped = (id: string, categoryId: string) => {
    void assignCategory(dragSelection(id), categoryId === 'unassigned' ? null : categoryId).catch(() => {});
  };
  const changeSimilarityMethod = (method: 'visual' | 'clip') => {
    setSimilarityMethod(method);
    if (pileOrder === 'similarity' || pileOrder === 'semantic') changePileOrder(method === 'clip' ? 'semantic' : 'similarity');
  };
  const addSimilar = async (referenceId?: string) => {
    if (matching) return;
    setMatching(true); setAnalysisNotice('');
    try {
      if (similarityMethod === 'visual') await ensureAnalysis();
      if (!mountedRef.current) return;
      const current = imagesRef.current;
      const references = current.filter((image) => imageIsOnBoard(image) && (!referenceId || image.id === referenceId));
      const candidates = current.filter((image) => !imageIsOnBoard(image));
      let matches: SimilarMatch[];
      if (similarityMethod === 'clip') {
        const referenceIds = await ensureClipReferences(references.map((image) => image.id));
        if (!referenceIds.length) { setAnalysisNotice('No readable reference image on the board.'); return; }
        matches = await similarContent(candidates.map((image) => image.id), referenceIds, drawSize);
      } else {
        if (!hashes(references).length) { setAnalysisNotice('No readable reference image on the board.'); return; }
        matches = await analysisClient().similar(hashes(candidates), hashes(references), drawSize);
      }
      if (!mountedRef.current) return;
      // Recheck placement after the async search: dragging can continue during it.
      const byId = new Map(imagesRef.current.map((image) => [image.id, image]));
      const eligible = matches.filter((match) => {
        const image = byId.get(match.id), reference = byId.get(match.referenceId);
        return image && !imageIsOnBoard(image) && reference && imageIsOnBoard(reference);
      });
      if (!eligible.length) { setAnalysisNotice(similarityMethod === 'clip' ? 'No indexed images left in the pile. Resume CLIP to analyze more images.' : 'No close visual matches left in the pile.'); return; }
      const center = visibleBoardCenter();
      const pane = boardPaneRef.current?.getBoundingClientRect();
      const canvas = boardRef.current?.querySelector<HTMLElement>('[data-testid="board-canvas"]')?.getBoundingClientRect();
      const viewport = pane && canvas ? {
        left: Math.max(0, (pane.left - canvas.left) / zoom), right: (pane.right - canvas.left) / zoom,
        top: Math.max(0, (pane.top - canvas.top) / zoom), bottom: (pane.bottom - canvas.top) / zoom,
      } : { left: 0, right: WORLD_WIDTH, top: 0, bottom: worldHeight };
      const positions = new Map(imagesRef.current.filter(imageIsOnBoard).map((image, index) => [image.id,
        { x: image.boardX ?? 110 + index % 8 * 205, y: image.boardY ?? 130 + Math.floor(index / 8) * 215 }]));
      const occupied = [...positions.values()];
      const moves = eligible.map((match: SimilarMatch, index) => {
        const origin = positions.get(match.referenceId)!;
        // Search around the reference first, so related images remain together.
        const offsets = [{ x: 192, y: 0 }, { x: -192, y: 0 }, { x: 0, y: 192 }, { x: 0, y: -192 },
          { x: 192, y: 192 }, { x: -192, y: 192 }];
        let point = {
          x: Math.max(viewport.left + 12, Math.min(viewport.right - CARD_WIDTH - 12, center.x + index * 28)),
          y: Math.max(viewport.top + 12, Math.min(viewport.bottom - CARD_WIDTH - 12, center.y + index * 28)),
        };
        for (let ring = 1; ring <= 5; ring++) {
          const free = offsets.map((offset) => ({ x: origin.x + offset.x * ring, y: origin.y + offset.y * ring }))
            .find((candidate) => candidate.x >= viewport.left + 12 && candidate.x + CARD_WIDTH <= viewport.right - 12 &&
              candidate.y >= viewport.top + 12 && candidate.y + CARD_WIDTH <= viewport.bottom - 12 &&
              !occupied.some((other) => Math.abs(other.x - candidate.x) < 172 && Math.abs(other.y - candidate.y) < 172));
          if (free) { point = free; break; }
        }
        occupied.push(point);
        return { id: match.id, ...point };
      });
      setDealtIds(moves.map((move) => move.id));
      onPlaceOnBoard(moves);
      setAnalysisNotice(`Added ${moves.length} similar ${moves.length === 1 ? 'image' : 'images'}.${similarityMethod === 'clip' && clipProgress.done < images.length ? ' CLIP searched the images indexed so far.' : ''}`);
      window.setTimeout(() => setDealtIds([]), 800);
    } catch (cause) {
      if (mountedRef.current) setAnalysisNotice(cause instanceof Error ? cause.message : 'Could not find similar images.');
    } finally { if (mountedRef.current) setMatching(false); }
  };

  const onBoardMoveEnd = (id: string, x: number, y: number, _dropPoint?: Point, screenPoint?: Point): boolean => {
    if (!screenPoint) { onPlaceOnBoard([{ id, x: Math.max(0, x), y: Math.max(0, y) }]); return true; }
    const categoryId = categoryAt(screenPoint);
    if (categoryId) { assignDropped(id, categoryId); return false; }
    if (contains(trayRef.current?.getBoundingClientRect(), screenPoint)) { onReturnToPile([id]); return true; }
    if (contains(boardPaneRef.current?.getBoundingClientRect(), screenPoint)) {
      const point = boardPointAt(screenPoint, dragAnchorRef.current);
      if (!point) return false;
      onPlaceOnBoard([{ id, ...point }]);
      return true;
    }
    return false;
  };
  const onTrayMoveEnd = (id: string, x: number, y: number, _dropPoint?: Point, screenPoint?: Point): boolean => {
    if (!screenPoint) return false;
    const categoryId = categoryAt(screenPoint);
    if (categoryId) { assignDropped(id, categoryId); return false; }
    const boardPoint = boardPointAt(screenPoint, dragAnchorRef.current);
    if (boardPoint) { onPlaceOnBoard([{ id, ...boardPoint }]); return true; }
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
  const overlayImage = dragging ? imageById.get(dragging.id) : undefined;
  const overlayPoint = dragPointRef.current;
  const overlaySize = dragging && overlayPoint ? dragPreviewSize(dragging.id, overlayPoint) : 0;
  const drawCountDescription = `${drawSize === 1 ? '1' : `up to ${drawSize}`} ${pileOrder === 'random' ? 'random ' : ''}${drawSize === 1 ? 'image' : 'images'}`;
  const analysisStatus = analysisProgress.running ? `Analyzing images… ${analysisProgress.done} / ${analysisProgress.total}` :
    preparingOrder ? 'Preparing pile order…' : matching ? 'Finding similar images…' : '';

  return <main ref={workspaceRef} className={`sorting-workspace${multiSelect ? ' is-selecting' : ''}`} aria-label="Sorting workspace"
    onKeyDown={event => {
      if (overviewOpen || event.defaultPrevented) return;
      if (event.key === 'Escape' && treeOpen && window.innerWidth <= 700) { event.preventDefault(); closeCategories(); return; }
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Escape') { event.preventDefault(); clearSelection(); setTreeOpen(false); }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && undoAssignments.length && !busy) { event.preventDefault(); undoCategory(); }
    }}
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
      <Board mode="sort" sortConfig={{ type: 'open', zoomEnabled: true }} cards={visibleBoardCards}
        baseCardWidth={CARD_WIDTH} cardLayoutMode="as-is" showSortSelection showCategoryLabels
        dealtCardIds={dealtIds} allowExternalDrag
        boardOverlay={plusPoints.map((point, index) => <button key={index} type="button" className="sorting-workspace__plus"
          style={{ left: point.x, top: point.y }} aria-label={`Add ${drawCountDescription} here`}
          disabled={!trayImages.length || busy || preparingOrder} onClick={() => drawAt(point)}><Plus size={26} /></button>)}
        selectedCardIds={[...selectedIds]} cardCategoryColors={imageColors} categoryFocusIds={categoryFocusIds} selectionOnly={multiSelect}
        viewScale={zoom} viewCenter={initialCenter} worldSize={worldSize} panEnabled onViewChange={updateBoardWindow}
        boardRef={boardRef} dragEnabled onFilesAdded={() => {}}
        onBringToFront={bringToFront} onSelectCard={selectImage}
        onClearSelection={clearSelection} onLassoSelect={(ids, append) => { setSelectedIds(current => new Set(append ? [...current, ...ids] : ids)); setSelectedId(ids.at(-1) || null); }}
        onOpenPreview={(id) => { const image = imageById.get(id); if (image) onOpenImage(image); }}
        onMoveEnd={onBoardMoveEnd} onDragScreenStart={onDragStart}
        onDragScreenMove={onDragMove} onDragScreenEnd={onDragEnd} />
      {boardImages.length === 0 && <div className="sorting-workspace__board-hint">Click + to add {drawCountDescription} from the pile, or drag images here.</div>}
      <button className="sorting-workspace__close" type="button" aria-label="Back to project" title={`Back to ${projectName}`} onClick={onBack}><X size={22} /></button>
      <button className="sorting-workspace__multi-select" type="button" aria-label="Select multiple images" aria-pressed={multiSelect} title="Tap images to build a selection; Shift-click or Shift-drag also selects several" onClick={() => setMultiSelect(value => !value)}>{multiSelect ? <CheckCheck size={19} /> : <MousePointer2 size={19} />}<span>{multiSelect ? 'Selecting' : 'Select'}</span></button>
      <div className="sorting-workspace__board-actions" aria-label="Board actions">
        <div className="sorting-workspace__similarity-tools">
          <select aria-label="Similarity method" title="pHash compares visual structure. CLIP finds related content and subjects; it indexes locally on first use." value={similarityMethod} disabled={matching}
            onChange={(event) => changeSimilarityMethod(event.target.value as 'visual' | 'clip')}>
            <option value="visual">pHash</option><option value="clip">CLIP</option>
          </select>
          <button type="button" aria-label="Add similar to board" disabled={!boardImages.length || !trayImages.length || busy || matching || (similarityMethod === 'visual' && analysisProgress.running)}
            title={`Add up to ${drawSize} ${similarityMethod === 'clip' ? 'closest indexed content matches' : 'close visual matches'} to images on the board; keep their existing categories`} onClick={() => void addSimilar()}><ScanSearch size={15} /> Add similar</button>
        </div>
        <button type="button" disabled={!codedOnBoard.length || busy} title="Return coded images to the pile; keep their categories" onClick={() => onReturnToPile(codedOnBoard.map((image) => image.id))}><Layers3 size={15} /> Clear coded <span>{codedOnBoard.length}</span></button>
        <button type="button" disabled={!boardImages.length || busy} title="Return all board images to the pile; keep their categories" onClick={() => onReturnToPile(boardImages.map((image) => image.id))}><Trash2 size={15} /> Clear board</button>
      </div>
      <div className="sorting-workspace__zoom" role="group" aria-label="Board zoom">
        <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(.45, Math.round((value - .15) * 100) / 100))}><Minus size={17} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2, Math.round((value + .15) * 100) / 100))}><Plus size={17} /></button>
      </div>
      {similarityMethod === 'clip' && <section className="sorting-workspace__content-index" aria-label="CLIP indexing">
        <div>
          <span role="status">{clipProgress.phase === 'loading' ? `Loading CLIP${clipProgress.percent === undefined ? '…' : `… ${clipProgress.percent}%`}` :
            clipProgress.phase === 'error' ? clipProgress.error : `CLIP ${clipProgress.done} / ${clipProgress.total} indexed${clipProgress.phase === 'paused' ? ' · paused' : ''}${clipProgress.failed ? ` · ${clipProgress.failed} skipped` : ''}`}</span>
          {['loading', 'indexing'].includes(clipProgress.phase) && <button type="button" aria-label="Pause CLIP indexing" onClick={pauseClip}><Pause size={12} /> Pause</button>}
          {['paused', 'error'].includes(clipProgress.phase) && <button type="button" aria-label={clipProgress.phase === 'error' ? 'Retry CLIP indexing' : 'Resume CLIP indexing'} onClick={() => void startClip().catch(() => {})}><Play size={12} /> {clipProgress.phase === 'error' ? 'Retry' : 'Resume'}</button>}
          {clipProgress.phase === 'ready' && clipProgress.failed > 0 && <button type="button" aria-label="Retry skipped CLIP images" title="Retry unreadable images, for example after switching browsers" onClick={() => void retrySkippedClip().catch(() => {})}><Play size={12} /> Retry skipped</button>}
        </div>
        <small>{clipProgress.phase === 'loading' || clipProgress.phase === 'idle' ? 'First use: up to ~75 MB download. Images stay in this browser.' :
          clipProgress.phase === 'ready' ? 'Content similarity · cached in this browser' : 'Sort while indexing. Add similar searches indexed images.'}</small>
      </section>}
      <button className="sorting-workspace__tree-toggle" type="button" aria-label="Show categories" onClick={() => setTreeOpen(true)}>Categories <ChevronRight size={16} /></button>
      {selectedImages.length > 0 && <div className="sorting-workspace__selection-bar"><strong>{selectedImages.length.toLocaleString()} selected</strong><span>Choose a category →</span><button type="button" className="sorting-workspace__assign-open" aria-label="Choose category for selected images" onClick={() => setTreeOpen(true)}>Assign category <ChevronRight size={16} /></button><button type="button" aria-label="Deselect images" onClick={clearSelection}><X size={17} /></button></div>}
      {focusedCategoryId && <div className="sorting-workspace__category-focus"><span>{focusedCategoryId === 'unassigned' ? 'Unassigned' : categoryById.get(focusedCategoryId)} · {boardImages.filter(image => categoryFocusIds?.has(image.id)).length} on board</span><button type="button" aria-label="Explore focused category" onClick={() => { setOverviewCategory(current => ({ id: focusedCategoryId, revision: (current?.revision || 0) + 1 })); setOverviewOpen(true); }}>Explore</button><button type="button" aria-label="Show all board categories" onClick={() => setFocusedCategoryId(null)}><X size={14} /></button></div>}
    </div>

    <section className="sorting-workspace__tray" ref={trayRef} aria-label="Image pile">
      <div className="sorting-workspace__tray-head">
        <div><button type="button" className="sorting-workspace__pile-open" aria-label="Explore image pile" title="Explore the whole pile, mark images, and add them to the board" onClick={() => setOverviewOpen(true)}><Maximize2 size={15} /><strong>Explore pile</strong></button><span>{trayImages.length.toLocaleString()} of {images.length.toLocaleString()} images</span></div>
        <div className="sorting-workspace__pile-order">
          <label>Order <select aria-label="Pile order" title={pileOrder === 'modified' ? 'File modified date; images with no saved date appear last' : pileOrder === 'semantic' ? 'Group related subjects with CLIP; unindexed images stay at the end until indexing finishes or pauses' : pileOrder === 'similarity' ? 'Arrange images by visual structure; similar subjects may look different' : 'Choose the order used by the pile and + buttons'} value={pileOrder} onChange={(event) => changePileOrder(event.target.value as PileOrder)}>
            <PileOrderOptions />
          </select></label>
          <button type="button" aria-label="Reverse pile order" title="Reverse pile order; unavailable dates and dimensions stay last" aria-pressed={reverseOrder}
            disabled={pileOrder === 'random' || preparingOrder} onClick={reversePileOrder}><ArrowDownUp size={15} /></button>
        </div>
        <div className="sorting-workspace__tray-tools">
          <div className="sorting-workspace__draw-size" role="group" aria-label="Images per add">
            <span className="sorting-workspace__draw-size-label" aria-hidden="true">Images per +</span>
            {[1, 3, 5].map((size) => <button key={size} type="button" aria-label={`${size} ${size === 1 ? 'image' : 'images'} per add`} title={`Use + or Add similar to add up to ${size} ${size === 1 ? 'image' : 'images'}`} aria-pressed={drawSize === size} className={drawSize === size ? 'is-active' : ''} onClick={() => setDrawSize(size)}>{size}</button>)}
          </div>
          <button type="button" className="sorting-workspace__shuffle" aria-label="Shuffle pile" title="Switch to a new random order" disabled={trayImages.length < 2} onClick={shufflePile}><Shuffle size={16} /> Shuffle pile</button>
        </div>
      </div>
      <div className="sorting-workspace__tray-scroll" ref={trayScrollRef} tabIndex={0} aria-label="Scroll image pile">
        <div className="sorting-workspace__tray-canvas" style={{ width: Math.max(650, traySequence.length * TRAY_STEP + 140) }}>
          {visibleTrayCards.map((card) => <DraggableCard key={card.id} card={card} cardW={TRAY_CARD_WIDTH} cardH={TRAY_CARD_WIDTH}
            mode="sort" isSelected={selectedIds.has(card.id)} selectionOnly={multiSelect} categoryColor={imageColors.get(card.id)} dimmed={!!categoryFocusIds && !categoryFocusIds.has(card.id)} dragEnabled onBringToFront={bringToFront}
            onMoveEnd={onTrayMoveEnd} onDragScreenStart={onDragStart} onDragScreenMove={onDragMove} onDragScreenEnd={onDragEnd}
            onSelectCard={selectImage} onKeyboardMove={(id, direction) => { if (direction === 'up') placeAt(id, { x: initialCenter.x, y: initialCenter.y }); }}
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
      <CategoryPanel images={images} categories={categories} selected={selectedImages} thumbnails={objectUrls} busy={busy}
        hoverId={hoverCategoryId} focusedId={focusedCategoryId} notice={categoryNotice} canUndo={undoAssignments.length > 0}
        onAssign={assignCategory} onCreate={onCreateCategory} onClear={clearSelection} onFocus={id => { setFocusedCategoryId(id); if (window.innerWidth <= 700) closeCategories(); }}
        onUndo={undoCategory} onClose={closeCategories} actions={selectedImages.length ? <>
          <button type="button" disabled={busy} onClick={() => {
            const board = selectedImages.filter(imageIsOnBoard);
            if (board.length) onReturnToPile(board.map(image => image.id));
            else addMarkedToBoard(selectedImages.map(image => image.id));
          }}>{selectedImages.some(imageIsOnBoard) ? 'Return to pile' : 'Add to board'}</button>
          {selectedImages.length === 1 && <button type="button" onClick={() => onOpenImage(selectedImages[0])}><Eye size={14} /> View image</button>}
          {selectedImages.length === 1 && imageIsOnBoard(selectedImages[0]) && <button type="button" aria-label="Add similar to selected image" disabled={!trayImages.length || busy || matching || (similarityMethod === 'visual' && analysisProgress.running)} onClick={() => void addSimilar(selectedImages[0].id)}><ScanSearch size={14} /> Add similar</button>}
        </> : <button type="button" disabled={!boardImages.length} onClick={() => {
          const pane = boardPaneRef.current?.getBoundingClientRect();
          const canvas = boardRef.current?.querySelector<HTMLElement>('[data-testid="board-canvas"]')?.getBoundingClientRect();
          const ids = boardCards.filter(card => pane && canvas &&
            card.x * zoom + canvas.left < pane.right && (card.x + CARD_WIDTH) * zoom + canvas.left > pane.left &&
            card.y * zoom + canvas.top < pane.bottom && (card.y + CARD_WIDTH) * zoom + canvas.top > pane.top).map(card => card.id);
          setSelectedIds(new Set(ids)); setSelectedId(ids.at(-1) || null);
        }}><CheckCheck size={14} /> Select visible images</button>} />
    </aside>

    {dragging && overlayImage && overlayPoint && <div ref={ghostRef} className="sorting-workspace__drag-ghost" style={{
      left: overlayPoint.x, top: overlayPoint.y, width: overlaySize, height: overlaySize,
      transform: `translate(-${dragging.anchor.x * 100}%, -${dragging.anchor.y * 100}%)`,
    }} aria-hidden="true">
      {objectUrls.get(overlayImage.id) ? <img src={objectUrls.get(overlayImage.id)} alt="" /> : <span>{overlayImage.path.split('/').at(-1)}</span>}
      {dragSelection(overlayImage.id).length > 1 && <span className="sorting-workspace__drag-count">Assign {dragSelection(overlayImage.id).length} images</span>}
    </div>}
    {(error || busy || analysisStatus || analysisNotice || message) && <div className={`sorting-workspace__notice${error ? ' sorting-workspace__notice--error' : ''}`} role={error ? 'alert' : 'status'}>{error || (busy ? 'Saving…' : analysisStatus || analysisNotice || message)}</div>}
    {!analysisProgress.running && !preparingOrder && analysisProgress.failed > 0 && pileOrder !== 'random' && <span className="sorting-workspace__analysis-note">{analysisProgress.failed} {analysisProgress.failed === 1 ? 'image' : 'images'} could not be analyzed.</span>}
    <PileOverview open={overviewOpen} images={orderedImages} categories={categories} thumbnails={thumbnails}
      order={pileOrder} reversed={reverseOrder} preparing={preparingOrder} busy={busy} error={error}
      status={analysisStatus || (similarityMethod === 'clip' ? clipProgress.phase === 'loading' ? `Loading CLIP${clipProgress.percent === undefined ? '…' : ` · ${clipProgress.percent}%`} · first download ~75 MB` : ['indexing', 'paused'].includes(clipProgress.phase) ? `CLIP · ${clipProgress.done} / ${clipProgress.total} indexed${clipProgress.phase === 'paused' ? ' · paused' : ''}` : clipProgress.phase === 'error' ? clipProgress.error || '' : '' : '')}
      indexAction={similarityMethod === 'clip' && (['loading', 'indexing'].includes(clipProgress.phase)
        ? <button type="button" aria-label="Pause CLIP indexing" onClick={pauseClip}><Pause size={12} />Pause</button>
        : ['paused', 'error'].includes(clipProgress.phase) ? <button type="button" aria-label={clipProgress.phase === 'error' ? 'Retry CLIP indexing' : 'Resume CLIP indexing'} onClick={() => void startClip().catch(() => {})}><Play size={12} />{clipProgress.phase === 'error' ? 'Retry' : 'Resume'}</button> : null)}
      onOrder={changePileOrder} onReverse={reversePileOrder} onShuffle={shufflePile} onInteracting={clipInteraction}
      onClose={() => setOverviewOpen(false)} onAdd={addMarkedToBoard}
      categoryRequest={overviewCategory} categoryNotice={categoryNotice} canUndo={undoAssignments.length > 0}
      onAssign={assignCategory} onCreateCategory={onCreateCategory} onUndo={undoCategory} />
  </main>;
}
