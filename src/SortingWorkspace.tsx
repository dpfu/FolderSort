import { useThumbnailUrls } from './useThumbnailUrls';
import { readStashView } from './stashView';
import * as React from 'react';
import { useStableCallback } from './useStableCallback';
import { flushSync } from 'react-dom';
import { ChevronLeft, ChevronRight, Layers3, Pause, Play, ScanSearch, Check } from 'lucide-react';
import { Board } from './Board';
import WorkspaceBar from './WorkspaceBar';
import ExportActions from './ExportActions';
import type { UndoView } from './UndoControl';
import SimilarImageAdd, { type SimilarityMethod } from './SimilarImageAdd';
import { download, safeFilename } from './download';
import type { BoardExportScope } from './boardExport';
import { DraggableCard } from './DraggableCard';
import { categoryColor } from './categoryTree';
import { imageIsOnBoard, type CategoryAssignment, type LibraryCategory, type LibraryImage } from './libraryStore';
import StashPicker from './StashPicker';
import StashBoardLayer from './StashBoardLayer';
import { planStashAssignments } from './stashPlacement';
import { stashBoardLayout, imageOnScopeBoard, inGroupingTarget, STASH_HOLD_MS, STASH_HOLD_SLOP, parentPath } from './stashBoard';

import { readBoardPreferences, type BoardPoint, type CategoryBoardGroup } from './categoryBoard';
import { orderByMetadata, type PileOrder, type SimilarMatch } from './imageAnalysis';
import { useImageAnalysis } from './useImageAnalysis';
import { useContentIndex } from './ContentIndex';
import ContentIndexStatus from './ContentIndexStatus';
import { type ImageThumbnailCache, useThumbnails } from './imageThumbnails';
import PileOverview from './PileOverview';
import { arrangeBoardBatch, arrangeVisibleBatch, visibleStripIndices } from './pileLayout';
import { DEFAULT_PILE_SIZE, pileSizeGeometry, readPileSize } from './pileSizing';
import PileDock from './PileDock';
import type { CameraView } from './camera';
import type { CardData } from './types';
import './workspace.css';
import './stash-board.css';

type Point = { x: number; y: number };
type BoardMove = { id: string; x: number; y: number; boardScope?: string | null };

type Props = {
  projectId: string;
  projectName: string;
  clipEnabled: boolean;
  onSettings: () => void;
  images: LibraryImage[];
  categories: LibraryCategory[];
  busy: boolean;
  saving: boolean;
  thumbnailCache: ImageThumbnailCache;
  message: string;
  progress: string;
  error: string;
  canExportFolder: boolean;
  onExport: (format: 'zip' | 'folder') => void;
  onBack: () => void;
  onOpenImage: (image: LibraryImage, context: { ids: string[]; parentId: string | null }) => void;
  onBackup: (format: 'zip' | 'folder') => void;
  initialBrowser?: boolean;
  onAssign: (assignments: CategoryAssignment[]) => Promise<void>;
  undo?: UndoView;
  onCreateStash: (ids: string[], parentId: string | null, name?: string) => Promise<LibraryCategory>;
  onRenameStash: (id: string, name: string) => Promise<void>;
  onPrepareStash: (id: string, width: number) => Promise<void>;
  onPlaceOnBoard: (moves: BoardMove[]) => void;
  onReturnToPile: (ids: string[]) => void;
};

const WORLD_WIDTH = 2200;
const CARD_WIDTH = 172;
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
  projectId, projectName, clipEnabled, onSettings, images, categories, busy, saving, thumbnailCache, message, progress, error, onBack, onOpenImage, onAssign,
  onCreateStash, onRenameStash, onPrepareStash, onPlaceOnBoard: saveBoardMoves, onReturnToPile, canExportFolder, onExport, onBackup, initialBrowser, undo,
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
  const [preferences, setPreferences] = React.useState(() => readBoardPreferences(projectId));
  const [pileSize, setPileSize] = React.useState(() => readPileSize(projectId));
  const [workspaceSize, setWorkspaceSize] = React.useState({ width: window.innerWidth, height: window.innerHeight });
  const pileGeometry = pileSizeGeometry(workspaceSize.width, workspaceSize.height - 56, pileSize);
  const pileCollapsed = React.useRef(!!pileSize.collapsed); pileCollapsed.current = !!pileSize.collapsed;
  const pileScrollLeft = React.useRef(0);
  const pileResize = React.useRef<{ pointerId: number; y: number; height: number; next: number; previousHeight?: number; frame?: number }>();
  const [resizingPile, setResizingPile] = React.useState(false);
  const previousPileStep = React.useRef(pileGeometry.step);
  const trayId = React.useId();
  const viewStorageKey = `folder-sort-stash-view:${projectId}`;
  const [stashView] = React.useState(() => readStashView(projectId));
  const [scopeId, setScopeId] = React.useState<string | null>(() => categories.some(stash => stash.id === stashView.active) ? stashView.active : null);
  const scopeRef = React.useRef(scopeId); scopeRef.current = scopeId;
  const cameras = React.useRef<Record<string, { x: number; y: number; zoom: number }>>(stashView.cameras);
  const cameraSaveTimer = React.useRef<number>();
  const [editingStashId, setEditingStashId] = React.useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = React.useState(false);
  const [groupPreview, setGroupPreview] = React.useState<{ targetId: string; ready: boolean; serial: number; position: Point } | null>(null);
  const hold = React.useRef<{ targetId: string; point: Point; ready: boolean; timer: number; serial: number }>();
  const groupSerial = React.useRef(0);
  const persistCamera = React.useCallback(() => {
    try { localStorage.setItem(viewStorageKey, JSON.stringify({ active: scopeRef.current, cameras: cameras.current })); } catch { /* Sorting works without localStorage. */ }
  }, [viewStorageKey]);
  const onPlaceOnBoard = (moves: BoardMove[]) => saveBoardMoves(moves.map(move => ({ ...move, boardScope: scopeId })));
  const [boardViewportWidth, setBoardViewportWidth] = React.useState(Math.max(320, window.innerWidth));
  const [cameraCenter, setCameraCenter] = React.useState<Point>();
  const [pulseCategoryId, setPulseCategoryId] = React.useState<string | null>(null);
  const pulseTimer = React.useRef<number>();
  const [dragInPile, setDragInPile] = React.useState(false);
  const [takeOutHover, setTakeOutHover] = React.useState(false);
  const navigationLock = React.useRef(false);
  const thumbnails = thumbnailCache;
  const objectUrls = thumbnails.urls;
  const [overviewOpen, setOverviewOpen] = React.useState(!!initialBrowser);
  const imageExport = React.useRef<AbortController>();
  const [exportStatus, setExportStatus] = React.useState('');
  const [exportNotice, setExportNotice] = React.useState('');
  const [exportError, setExportError] = React.useState('');
  const exportNoticeTimer = React.useRef<number>();
  React.useEffect(() => () => { imageExport.current?.abort(); window.clearTimeout(exportNoticeTimer.current); }, []);
  const [boardWindow, setBoardWindow] = React.useState({ left: -280, top: -280, right: window.innerWidth + 280, bottom: window.innerHeight + 280 });
  const updateBoardWindow = React.useCallback((view: CameraView) => {
    setBoardViewportWidth(view.viewportW);
    cameras.current[scopeRef.current || 'root'] = { x: view.centerX, y: view.centerY, zoom: view.scale };
    window.clearTimeout(cameraSaveTimer.current);
    cameraSaveTimer.current = window.setTimeout(persistCamera, 500);
    const next = {
      left: Math.floor((view.centerX - view.viewportW / view.scale / 2 - 280) / 128) * 128,
      top: Math.floor((view.centerY - view.viewportH / view.scale / 2 - 280) / 128) * 128,
      right: Math.ceil((view.centerX + view.viewportW / view.scale / 2 + 280) / 128) * 128,
      bottom: Math.ceil((view.centerY + view.viewportH / view.scale / 2 + 280) / 128) * 128,
    };
    setBoardWindow(current => Object.keys(next).every(key => current[key as keyof typeof next] === next[key as keyof typeof next]) ? current : next);
  }, [persistCamera]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [multiSelect, setMultiSelect] = React.useState(false);
  const [categoryNotice, setCategoryNotice] = React.useState('');
  const assignmentLock = React.useRef(false);
  const [trayOrder, setTrayOrder] = React.useState<string[]>([]);
  const [trayPositions, setTrayPositions] = React.useState<Map<string, Point>>(new Map());
  const [trayViewport, setTrayViewport] = React.useState({ left: 0, width: Math.max(320, window.innerWidth - 282), height: 159 });
  const [pileNav, setPileNav] = React.useState({ left: false, right: false });
  const [zOrder, setZOrder] = React.useState<Map<string, number>>(new Map());
  const [dragging, setDragging] = React.useState<{ id: string; anchor: Point } | null>(null);
  const [hoverCategoryId, setHoverCategoryId] = React.useState<string | null>(null);
  const [dealtIds, setDealtIds] = React.useState<string[]>([]);
  const [dealOrigins, setDealOrigins] = React.useState<Map<string, Point & { delay: number }>>(new Map());
  const [intakeFeedback, setIntakeFeedback] = React.useState('');
  const intakeLock = React.useRef(false);
  const intakeTimer = React.useRef<number>();
  const dealTimer = React.useRef<number>();
  React.useEffect(() => { intakeLock.current = false; }, [images, scopeId]);
  React.useEffect(() => () => { window.clearTimeout(intakeTimer.current); window.clearTimeout(dealTimer.current); }, []);
  const [zoom, setZoom] = React.useState(() => { const value = cameras.current[scopeId || 'root']?.zoom; return typeof value === 'number' && value >= .45 && value <= 2 ? value : 1; });
  const zoomRef = React.useRef(zoom); zoomRef.current = zoom;
  const [drawSize, setDrawSize] = React.useState(3);
  const [overviewCategory, setOverviewCategory] = React.useState<{ id: string; revision: number } | undefined>(initialBrowser ? { id: 'all', revision: 1 } : undefined);
  const [pileOrder, setPileOrder] = React.useState<PileOrder>('random');
  const [reverseOrder, setReverseOrder] = React.useState(false);
  const [similarityIds, setSimilarityIds] = React.useState<string[]>([]);
  const [contentIds, setContentIds] = React.useState<string[]>([]);
  const [similarityMethod, setSimilarityMethod] = React.useState<SimilarityMethod>(clipEnabled ? 'clip' : 'color');
  const [preparingOrder, setPreparingOrder] = React.useState(false);
  const [matching, setMatching] = React.useState(false);
  const matchingLock = React.useRef(false);
  const matchingRequest = React.useRef(0);
  const [similarPreviewIds, setSimilarPreviewIds] = React.useState<string[]>([]);
  const previewThumbnails = React.useCallback((ids: string[]) => setSimilarPreviewIds(current => current.join(',') === ids.join(',') ? current : ids), []);
  const [analysisNotice, setAnalysisNotice] = React.useState('');
  React.useEffect(() => { if (message === 'Previous stashes restored.') setCategoryNotice(message); }, [message]);
  const [transientNotice, setTransientNotice] = React.useState('');
  React.useEffect(() => {
    const notice = analysisNotice || message;
    setTransientNotice(['Saving board…', 'Board saved.', 'Category created.'].includes(notice) || notice.startsWith('Stash created') ? '' : notice);
    const timer = window.setTimeout(() => setTransientNotice(''), analysisNotice ? 7000 : 3200);
    return () => window.clearTimeout(timer);
  }, [message, analysisNotice]);
  const imagesRef = React.useRef(images);
  imagesRef.current = images;
  const { metadata, progress: analysisProgress, ensure: ensureAnalysis, client: analysisClient, hashes, colors } = useImageAnalysis(images);
  const { progress: clipProgress, revision: clipRevision, orderRevision: clipOrderRevision, start: startClip, pause: pauseClip,
    ensureReferences: ensureClipReferences, order: orderContent, similar: similarContent, setInteracting: clipInteraction } = useContentIndex();
  React.useEffect(() => () => clipInteraction(false), [clipInteraction]);

  const currentStash = categories.find(stash => stash.id === scopeId);
  const previousScopePath = React.useRef('');
  if (currentStash) previousScopePath.current = currentStash.name;
  const scopeImages = React.useMemo(() => images.filter(image => image.categoryId === scopeId), [images, scopeId]);
  const boardImages = React.useMemo(() => images.filter(image => imageOnScopeBoard(image, scopeId)), [images, scopeId]);
  const trayImages = React.useMemo(() => scopeImages.filter(image => !imageOnScopeBoard(image, scopeId)), [scopeImages, scopeId]);
  const trayIds = React.useMemo(() => trayImages.map(image => image.id).join(','), [trayImages]);
  const similarCandidateIds = React.useMemo(() => images.filter(image => !imageOnScopeBoard(image, scopeId)).map(image => image.id).join(','), [images, scopeId]);
  const allIds = React.useMemo(() => images.map(image => image.id).join(','), [images]);
  const selectedImages = React.useMemo(() => images.filter(image => selectedIds.has(image.id)), [images, selectedIds]);
  React.useEffect(() => {
    if (currentStash && currentStash.layoutInitialized !== true) void onPrepareStash(currentStash.id, boardViewportWidth).catch(cause => setAnalysisNotice(String(cause)));
  }, [scopeId, currentStash?.layoutInitialized]);
  const categoryById = React.useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  const imageById = React.useMemo(() => new Map(images.map((image) => [image.id, image])), [images]);
  const imageColors = React.useMemo(() => new Map(images.flatMap(image => {
    const name = image.categoryId && image.categoryId !== scopeId ? categoryById.get(image.categoryId) : undefined;
    return name ? [[image.id, categoryColor(name)] as [string, string]] : [];
  })), [images, categoryById, scopeId]);

  const codedOnBoard = boardImages.filter((image) => !!image.categoryId);
  const freeBoardCards = React.useMemo(() => boardImages.map((image, index) => asCard(image, undefined,
    image.categoryId && image.categoryId !== scopeId ? categoryById.get(image.categoryId) : undefined,
    { x: image.boardX ?? 110 + index % 8 * 205, y: image.boardY ?? 130 + Math.floor(index / 8) * 215 },
    zOrder.get(image.id) || index + 1)), [boardImages, categoryById, zOrder, scopeId]);
  const boardCards = freeBoardCards;
  // Z-order changes do not change the space occupied by images or stash stacks.
  const occupiedCards = React.useMemo(() => boardImages.map((image, index) => ({ x: image.boardX ?? 110 + index % 8 * 205, y: image.boardY ?? 130 + Math.floor(index / 8) * 215 })), [boardImages]);
  const categoryLayout = React.useMemo(() => {
    const groups = stashBoardLayout(images, categories, scopeId, boardViewportWidth / zoom, preferences.anchors, occupiedCards);
    return { groups, height: Math.max(1600, ...groups.map(group => group.y + group.height + 96)) };
  }, [images, categories, scopeId, boardViewportWidth, zoom, preferences.anchors, occupiedCards]);
  React.useEffect(() => {
    const missing = categoryLayout.groups.filter(group => !preferences.anchors[group.id]);
    if (!missing.length) return;
    setPreferences(current => ({ ...current, anchors: { ...Object.fromEntries(missing.map(group => [group.id, { x: group.x, y: group.y }])), ...current.anchors } }));
  }, [categoryLayout.groups, preferences.anchors]);
  const boardCardById = React.useMemo(() => new Map(boardCards.map(card => [card.id, card])), [boardCards]);
  const worldHeight = Math.max(categoryLayout.height, ...boardCards.map(card => card.y + CARD_WIDTH + workspaceSize.height / (2 * zoom) + 120));
  const worldWidth = Math.max(WORLD_WIDTH, ...boardCards.map(card => card.x + CARD_WIDTH + boardViewportWidth / (2 * zoom) + 120), ...categoryLayout.groups.map(group => group.x + group.width + 48));
  const worldSize = React.useMemo(() => ({ width: worldWidth, height: worldHeight }), [worldWidth, worldHeight]);
  const initialCenter = React.useMemo(() => {
    const saved = cameras.current[scopeId || 'root'];
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return { x: saved.x, y: saved.y };
    if (scopeId && boardCards.length) {
      const first = boardCards.reduce((first, card) => card.y < first.y || card.y === first.y && card.x < first.x ? card : first);
      const minX = Math.min(...boardCards.map(card => card.x)), maxX = Math.max(...boardCards.map(card => card.x + CARD_WIDTH));
      const minY = Math.min(...boardCards.map(card => card.y)), maxY = Math.max(...boardCards.map(card => card.y + CARD_WIDTH));
      const fits = maxX - minX < workspaceSize.width - 64 && maxY - minY < workspaceSize.height - 56 - pileGeometry.paneHeight - 160;
      return fits ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : { x: first.x + Math.max(120, workspaceSize.width / 2 - 32), y: first.y + Math.max(110, (workspaceSize.height - 56 - pileGeometry.paneHeight) / 2 - 100) };
    }
    if (scopeId && categoryLayout.groups.length) {
      const first = categoryLayout.groups[0]; return { x: first.x + first.width / 2, y: first.y + first.height / 2 };
    }
    return { x: Math.min(760, Math.max(100, window.innerWidth / 2)), y: Math.min(480, Math.max(220, (window.innerHeight - 210) / 2)) };
  }, [scopeId]);
  React.useEffect(() => () => { window.clearTimeout(cameraSaveTimer.current); persistCamera(); window.clearTimeout(hold.current?.timer); }, [persistCamera]);
  React.useEffect(() => { if (scopeId && !categories.some(stash => stash.id === scopeId)) {
    const parent = categories.find(stash => stash.name.toLocaleLowerCase() === parentPath(previousScopePath.current).toLocaleLowerCase());
    matchingRequest.current++; matchingLock.current = false; setMatching(false);
    setScopeId(parent?.id || null); scopeRef.current = parent?.id || null;
    setCameraCenter(undefined); clearSelection();
    const camera = cameras.current[parent?.id || 'root']; setZoom(camera?.zoom >= .45 && camera.zoom <= 2 ? camera.zoom : 1);
  } }, [scopeId, categories]);
  React.useEffect(() => {
    try { localStorage.setItem(`folder-sort-board:${projectId}`, JSON.stringify(preferences)); } catch { /* Viewing preferences must not prevent sorting. */ }
  }, [projectId, preferences]);
  React.useEffect(() => {
    try { localStorage.setItem(`folder-sort-pile:${projectId}`, JSON.stringify(pileSize)); } catch { /* Sizing must work without persistent storage. */ }
  }, [projectId, pileSize]);
  React.useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const update = () => setWorkspaceSize(current => current.width === workspace.clientWidth && current.height === workspace.clientHeight
      ? current : { width: workspace.clientWidth, height: workspace.clientHeight });
    const observer = new ResizeObserver(update);
    observer.observe(workspace); update();
    return () => { observer.disconnect(); if (pileResize.current?.frame !== undefined) cancelAnimationFrame(pileResize.current.frame); };
  }, []);
  React.useLayoutEffect(() => {
    const oldStep = previousPileStep.current, newStep = pileGeometry.step;
    previousPileStep.current = newStep;
    if (oldStep === newStep) return;
    // Keep the same part of the collection in view when changing density.
    const scroll = trayScrollRef.current;
    if (scroll) {
      // The DOM may already have clamped scrollLeft to the narrower canvas.
      // Anchor to the last measured position from before this density change.
      scroll.scrollLeft = Math.max(0, (trayViewport.left - 26) * newStep / oldStep + 26);
      pileScrollLeft.current = scroll.scrollLeft;
      setTrayViewport({ left: scroll.scrollLeft, width: scroll.clientWidth, height: scroll.clientHeight });
    }
    setTrayPositions(current => new Map([...current].map(([id, point]) => [id, { ...point, x: Math.max(0, (point.x - 26) * newStep / oldStep + 26) }])));
  }, [pileGeometry.step]);
  React.useEffect(() => () => {
    if (pulseTimer.current !== undefined) clearTimeout(pulseTimer.current);
  }, []);

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
    if (!clipEnabled || pileOrder !== 'semantic' || dragging || resizingPile) return;
    let active = true;
    // Refresh occasionally and after a completed batch; hold it during drags.
    // Unindexed images remain accessible at the end.
    void orderContent(imagesRef.current.map((image) => image.id)).then((ids) => {
      if (active) setContentIds(ids);
    }).catch((cause) => { if (active && !(cause instanceof DOMException && cause.name === 'AbortError')) setAnalysisNotice(cause instanceof Error ? cause.message : 'Could not order by content.'); });
    return () => { active = false; };
  }, [clipEnabled, pileOrder, allIds, clipOrderRevision, dragging, resizingPile, orderContent]);

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
  const traySequence = React.useMemo(() => orderedImages.filter(image => image.categoryId === scopeId && !imageOnScopeBoard(image, scopeId)), [orderedImages, scopeId]);
  const trayIndices = React.useMemo(() => new Map(traySequence.map((image, index) => [image.id, index])), [traySequence]);
  const visibleBoardCards = boardCards.filter(card => card.id === selectedId || card.id === dragging?.id ||
    card.x + CARD_WIDTH >= boardWindow.left && card.x <= boardWindow.right && card.y + CARD_WIDTH >= boardWindow.top && card.y <= boardWindow.bottom)
    .map(card => ({ ...card, src: objectUrls.get(card.id) }));
  // The pile can contain thousands of images, but only a small part of its
  // horizontal canvas is visible. Keep moved, selected, and dragged cards mounted.
  const visibleTrayCards: CardData[] = [];
  const viewportLeft = trayViewport.left - TRAY_OVERSCAN;
  const viewportRight = trayViewport.left + trayViewport.width + TRAY_OVERSCAN;
  const stripIndices = pileSize.collapsed ? [] : visibleStripIndices(traySequence.length, pileGeometry.step, pileGeometry.imageSize,
    viewportLeft, viewportRight, trayPositions, trayIndices, [selectedId, dragging?.id]);
  for (const index of stripIndices) {
    const image = traySequence[index];
    const hash = smallHash(image.id);
    const savedPoint = trayPositions.get(image.id) || { x: 26 + index * pileGeometry.step, y: 15 + hash % 36 };
    const point = { ...savedPoint, y: Math.min(savedPoint.y, Math.max(0, trayViewport.height - pileGeometry.imageSize - 8)) };
    if (traySequence.length > 60 && point.x + pileGeometry.imageSize < viewportLeft && image.id !== selectedId && image.id !== dragging?.id) continue;
    if (traySequence.length > 60 && point.x > viewportRight && image.id !== selectedId && image.id !== dragging?.id) continue;
    visibleTrayCards.push(asCard(image, objectUrls.get(image.id), image.categoryId && image.categoryId !== scopeId ? categoryById.get(image.categoryId) : undefined,
      point, zOrder.get(image.id) || index + 1));
  }
  useThumbnails(thumbnails, [...visibleBoardCards.map(card => card.id), ...visibleTrayCards.map(card => card.id), ...similarPreviewIds, ...categoryLayout.groups.filter(group => group.x + group.width >= boardWindow.left && group.x <= boardWindow.right && group.y + group.height >= boardWindow.top && group.y <= boardWindow.bottom).flatMap(group => group.previewIds)], !overviewOpen, false);

  React.useEffect(() => {
    if (selectedId && !images.some((image) => image.id === selectedId)) setSelectedId(null);
    const available = new Set(images.map(image => image.id));
    setSelectedIds(current => [...current].every(id => available.has(id)) ? current : new Set([...current].filter(id => available.has(id))));
  }, [images, selectedId]);

  const clearSelection = useStableCallback(() => { setSelectedIds(new Set()); setSelectedId(null); });
  const returnToPile = (ids: string[]) => { clearSelection(); onReturnToPile(ids); };
  const selectImage = useStableCallback((id: string, options?: { toggle?: boolean }) => {
    setSelectedId(id);
    setSelectedIds(current => {
      if (!options?.toggle && !multiSelect) return new Set([id]);
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  });
  const dragSelection = (id: string) => selectedIds.has(id) ? [...selectedIds] : [id];
  const resetGroupPreview = () => {
    boardRef.current?.querySelectorAll<HTMLElement>('[data-group-preview]').forEach(node => { node.style.removeProperty('translate'); node.removeAttribute('data-group-preview'); });
    clipInteraction(false);
  };
  const previewGroupMove = (group: CategoryBoardGroup, delta: BoardPoint) => {
    clipInteraction(true);
    const ids = new Set(group.ids);
    boardRef.current?.querySelectorAll<HTMLElement>('.card--sort, [data-board-group-id]').forEach(node => {
      if (node.dataset.boardGroupId !== group.id && !ids.has((node.dataset.testid || '').replace('card-', ''))) return;
      node.style.translate = `${delta.x}px ${delta.y}px`; node.dataset.groupPreview = 'true';
    });
  };
  const moveCategoryGroup = (group: CategoryBoardGroup, delta: BoardPoint) => {
    flushSync(() => setPreferences(current => ({ ...current, anchors: { ...current.anchors,
      [group.id]: { x: Math.max(8, Math.round(group.x + delta.x)), y: Math.max(8, Math.round(group.y + delta.y)) } } })));
    resetGroupPreview();
  };
  const navigateStash = async (id: string | null, fromDrop = false, reveal?: Point) => {
    if (navigationLock.current || !fromDrop && (busy || dragging || assignmentLock.current)) return;
    if (id === scopeId) return;
    navigationLock.current = true;
    try { if (id) await onPrepareStash(id, boardViewportWidth); }
    catch (cause) { setAnalysisNotice(cause instanceof Error ? cause.message : 'Could not open stash.'); return; }
    finally { navigationLock.current = false; }
    matchingRequest.current++; matchingLock.current = false; setMatching(false); setAnalysisNotice('');
    setIntakeFeedback(''); window.clearTimeout(intakeTimer.current);
    cancelGrouping(); clearSelection(); setChooserOpen(false); setEditingStashId(null);
    setScopeId(id); scopeRef.current = id; setCameraCenter(undefined); setTrayPositions(new Map());
    const saved = cameras.current[id || 'root'];
    setZoom(saved && saved.zoom >= .45 && saved.zoom <= 2 ? saved.zoom : 1);
    if (reveal) {
      const scale = saved && saved.zoom >= .45 && saved.zoom <= 2 ? saved.zoom : 1, width = boardViewportWidth / scale, height = (workspaceSize.height - 56 - pileGeometry.paneHeight) / scale;
      const center = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : { x: reveal.x + width / 2, y: reveal.y + height / 2 };
      const point = { x: Math.max(reveal.x + CARD_WIDTH + 12 - width / 2, Math.min(center.x, reveal.x - 12 + width / 2)),
        y: Math.max(reveal.y + CARD_WIDTH + 12 - height / 2, Math.min(center.y, reveal.y - 12 + height / 2)) };
      cameras.current[id || 'root'] = { ...point, zoom: scale }; setCameraCenter(point);
    }
    trayScrollRef.current?.scrollTo({ left: 0 }); persistCamera();
    window.requestAnimationFrame(() => workspaceRef.current?.querySelector<HTMLElement>('.workspace-location summary')?.focus({ preventScroll: true }));
  };
  const createStash = async (ids: string[], point?: Point, label?: string) => {
    if (assignmentLock.current || busy || saving) return;
    assignmentLock.current = true;
    try {
      const stash = await onCreateStash([...new Set(ids)], scopeId, label);
      let anchor = point || visibleBoardCenter();
      if (!point) {
        for (let attempt = 0; attempt < 100; attempt++) {
          if (!categoryLayout.groups.some(group => Math.abs(group.x - anchor.x) < 250 && Math.abs(group.y - anchor.y) < 260) &&
            !boardCards.some(card => !ids.includes(card.id) && Math.abs(card.x - anchor.x) < 230 && Math.abs(card.y - anchor.y) < 230)) break;
          anchor = { x: anchor.x + 264, y: anchor.y };
        }
      }
      setPreferences(current => ({ ...current, anchors: { ...current.anchors, [stash.id]: { x: Math.max(8, anchor.x), y: Math.max(110, anchor.y) } } }));
      clearSelection(); setEditingStashId(stash.id); setPulseCategoryId(stash.id);
      setCameraCenter({ x: anchor.x + 118, y: anchor.y + 124 });
    } catch (cause) { setAnalysisNotice(cause instanceof Error ? cause.message : 'Could not create stash.'); }
    finally { assignmentLock.current = false; }
  };

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
    if (!scroll || pileSize.collapsed) return;
    let frame: number | null = null;
    const updateNav = () => {
      // A queued observer callback can arrive just after collapse hid the
      // scroll area. Never replace the remembered position with its zero size.
      if (pileCollapsed.current || !scroll.clientWidth) return;
      pileScrollLeft.current = scroll.scrollLeft;
      const next = { left: scroll.scrollLeft > 2, right: scroll.scrollLeft + scroll.clientWidth < scroll.scrollWidth - 2 };
      setPileNav((current) => current.left === next.left && current.right === next.right ? current : next);
      setTrayViewport((current) => current.left === scroll.scrollLeft && current.width === scroll.clientWidth && current.height === scroll.clientHeight
        ? current : { left: scroll.scrollLeft, width: scroll.clientWidth, height: scroll.clientHeight });
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
  }, [trayIds, pileSize.collapsed]);
  React.useLayoutEffect(() => {
    if (!pileSize.collapsed && trayScrollRef.current) trayScrollRef.current.scrollLeft = pileScrollLeft.current;
  }, [pileSize.collapsed]);

  const categoryAt = (point: Point): string | null => {
    if (!contains(boardPaneRef.current?.getBoundingClientRect(), point)) return null;
    const elements = document.elementsFromPoint(point.x, point.y).filter(element => !element.closest('.card.isDragging, .sorting-workspace__drag-ghost'));
    if (elements[0]?.closest('button, input, details') && !elements[0]?.closest('[data-stash-drop-id]')) return null;
    const tile = elements.map(element => element.closest<HTMLElement>('[data-stash-drop-id]')).find(Boolean);
    if (tile && boardRef.current?.contains(tile)) return tile.dataset.stashDropId || null;
    const canvas = boardRef.current?.querySelector('[data-testid="board-canvas"]')?.getBoundingClientRect();
    if (!canvas) return null;
    return categoryLayout.groups.find(group => contains(new DOMRect(canvas.left + group.x * zoom, canvas.top + group.y * zoom, group.width * zoom, group.height * zoom), point))?.id || null;
  };
  const imageTargetAt = (point: Point, sourceId: string): string | null => {
    if (!contains(boardPaneRef.current?.getBoundingClientRect(), point) || categoryAt(point)) return null;
    const elements = document.elementsFromPoint(point.x, point.y).filter(element => !element.closest('.card.isDragging, .sorting-workspace__drag-ghost'));
    if (elements[0]?.closest('button, input, details, .stash-navigation')) return null;
    const excluded = new Set(dragSelection(sourceId));
    const canvas = boardRef.current?.querySelector('[data-testid="board-canvas"]')?.getBoundingClientRect();
    if (!canvas) return null;
    // Only mounted images are examined. Hit boxes follow the image's actual aspect ratio.
    const nodes = [...(boardRef.current?.querySelectorAll<HTMLElement>('.card:not(.isDragging)') || [])].sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex));
    for (const node of nodes) {
      const id = (node.dataset.testid || '').replace('card-', '');
      const card = boardCardById.get(id); if (!card || excluded.has(id)) continue;
      const fit = getComputedStyle(node);
      const width = (parseFloat(fit.getPropertyValue('--image-fit-width')) || 100) / 100 * CARD_WIDTH * zoom;
      const height = (parseFloat(fit.getPropertyValue('--image-fit-height')) || 100) / 100 * CARD_WIDTH * zoom;
      if (inGroupingTarget(point, { left: canvas.left + card.x * zoom + (CARD_WIDTH * zoom - width) / 2, top: canvas.top + card.y * zoom + (CARD_WIDTH * zoom - height) / 2, width, height })) return id;
    }
    return null;
  };
  const cancelGrouping = () => { window.clearTimeout(hold.current?.timer); hold.current = undefined; setGroupPreview(null); };
  const prepareGrouping = (id: string, point: Point) => {
    const targetId = !busy && !saving ? imageTargetAt(point, id) : null;
    if (!targetId) { if (hold.current) cancelGrouping(); return; }
    const current = hold.current;
    if (current?.targetId === targetId && Math.hypot(point.x - current.point.x, point.y - current.point.y) <= STASH_HOLD_SLOP) return;
    cancelGrouping();
    const serial = ++groupSerial.current;
    const card = boardCardById.get(targetId)!;
    const canvas = boardRef.current!.querySelector('[data-testid="board-canvas"]')!.getBoundingClientRect();
    const pane = boardPaneRef.current!.getBoundingClientRect();
    const targetTop = canvas.top + card.y * zoom, targetBottom = targetTop + CARD_WIDTH * zoom;
    const position = { x: Math.max(pane.left + 110, Math.min(pane.right - 110, canvas.left + (card.x + CARD_WIDTH / 2) * zoom)),
      y: Math.max(pane.top + 110, Math.min(pane.bottom - 105, targetTop > pane.top + 210 ? targetTop - 105 : targetBottom + 12)) };
    const timer = window.setTimeout(() => {
      if (!hold.current || hold.current.serial !== serial || !dragPointRef.current || imageTargetAt(dragPointRef.current, id) !== targetId) return;
      hold.current.ready = true; setGroupPreview({ targetId, ready: true, serial, position });
    }, STASH_HOLD_MS);
    hold.current = { targetId, point, ready: false, timer, serial }; setGroupPreview({ targetId, ready: false, serial, position });
  };
  const commitGrouping = (id: string, point: Point) => {
    const current = hold.current;
    if (!current?.ready || imageTargetAt(point, id) !== current.targetId || busy || saving) return false;
    const ids = [...new Set([current.targetId, ...dragSelection(id)])];
    const target = boardCardById.get(current.targetId);
    cancelGrouping(); void createStash(ids, target); return true;
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
    if (contains(trayRef.current?.getBoundingClientRect(), point)) return pileGeometry.imageSize;
    const image = imageById.get(id);
    return image && imageIsOnBoard(image) ? CARD_WIDTH * zoom : pileGeometry.imageSize;
  };
  const onDragStart = useStableCallback((id: string, point: Point, anchor: Point) => {
    clipInteraction(true);
    dragPointRef.current = point;
    dragAnchorRef.current = anchor;
    setDragging({ id, anchor });
    setDragInPile(false); setTakeOutHover(false);
    cancelGrouping();
  });
  const onDragMove = useStableCallback((id: string, point: Point) => {
    dragPointRef.current = point;
    if (ghostRef.current) {
      const size = dragPreviewSize(id, point);
      ghostRef.current.style.left = `${point.x}px`;
      ghostRef.current.style.top = `${point.y}px`;
      ghostRef.current.style.width = `${size}px`;
      ghostRef.current.style.height = `${size}px`;
    }
    const targetId = categoryAt(point);
    setTakeOutHover(!!scopeId && document.elementsFromPoint(point.x, point.y).some(element => element.closest("[data-stash-parent]")));
    setDragInPile(contains(trayRef.current?.getBoundingClientRect(), point));
    setHoverCategoryId(targetId);
    if (targetId) cancelGrouping(); else prepareGrouping(id, point);
  });
  const onDragEnd = useStableCallback(() => { cancelGrouping(); resetGroupPreview(); clipInteraction(false); dragPointRef.current = null; setDragging(null); setHoverCategoryId(null); setDragInPile(false); setTakeOutHover(false); });
  const bringToFront = useStableCallback((id: string) => setZOrder((current) => new Map(current).set(id, Math.max(0, ...current.values()) + images.length + 1)));
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
  const addFromPile = (origin: DOMRect) => {
    if (intakeLock.current || busy || saving || preparingOrder || !trayImages.length) return;
    const pane = boardPaneRef.current?.getBoundingClientRect();
    const canvas = boardRef.current?.querySelector<HTMLElement>('[data-testid="board-canvas"]')?.getBoundingClientRect();
    if (!pane || !canvas) return;
    const chosen = (pileOrder === 'random' ? shuffled(trayImages) : traySequence).slice(0, drawSize);
    // Controls live outside the canvas, so only a small edge inset is needed.
    const sidePad = Math.min(24, Math.max(0, (pane.width - CARD_WIDTH * zoom) / 2));
    const verticalPad = Math.min(24, Math.max(0, (pane.height - CARD_WIDTH * zoom) / 2));
    const view = { x: (pane.left + sidePad - canvas.left) / zoom, y: (pane.top + verticalPad - canvas.top) / zoom,
      width: (pane.width - sidePad * 2) / zoom, height: (pane.height - verticalPad * 2) / zoom };
    const moves = arrangeVisibleBatch(chosen.map(image => image.id), [
      ...boardCards.map(card => ({ x: card.x, y: card.y, width: CARD_WIDTH, height: CARD_WIDTH })),
      ...categoryLayout.groups.map(group => ({ x: group.x, y: group.y, width: group.width, height: group.height, protected: true })),
    ], view, CARD_WIDTH);
    const origins = new Map(chosen.map((image, index) => {
      const thumbnail = trayRef.current?.querySelector<HTMLElement>(`[data-testid="card-${CSS.escape(image.id)}"]`)?.getBoundingClientRect();
      const visible = thumbnail && !pileSize.collapsed && thumbnail.right > pane.left && thumbnail.left < pane.right;
      const source = visible ? thumbnail : origin;
      return [image.id, { x: (source.left + source.width / 2 - canvas.left) / zoom - CARD_WIDTH / 2,
        y: (source.top + source.height / 2 - canvas.top) / zoom - CARD_WIDTH / 2, delay: index * .045 }] as const;
    }));
    intakeLock.current = true;
    setDealOrigins(origins); setDealtIds(moves.map(move => move.id));
    onPlaceOnBoard(moves);
    setIntakeFeedback(`Added ${chosen.length} ${chosen.length === 1 ? 'image' : 'images'}`);
    window.clearTimeout(intakeTimer.current); window.clearTimeout(dealTimer.current);
    intakeTimer.current = window.setTimeout(() => setIntakeFeedback(''), 1600);
    dealTimer.current = window.setTimeout(() => { setDealOrigins(new Map()); setDealtIds([]); }, 1000);
  };
  const changePileOrder = (order: PileOrder) => {
    if (order === 'semantic' && !clipEnabled) return;
    setPileOrder(order); setReverseOrder(false); setTrayPositions(new Map()); setAnalysisNotice('');
    if (order === 'semantic') setSimilarityMethod('clip');
    trayScrollRef.current?.scrollTo({ left: 0 });
  };
  const reversePileOrder = () => { setReverseOrder(value => !value); setTrayPositions(new Map()); trayScrollRef.current?.scrollTo({ left: 0 }); };
  const shufflePile = () => { changePileOrder('random'); setTrayOrder(shuffled(images.map(image => image.id))); };
  const addMarkedToBoard = (ids: string[]) => {
    const eligible = ids.filter(id => { const image = imageById.get(id); return image && !imageOnScopeBoard(image, scopeId); });
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

  const assignCategory = async (ids: string[], categoryId: string | null, name?: string, options?: { point?: Point; tray?: boolean }) => {
    if (assignmentLock.current || busy || saving || !ids.length) return;
    const latest = new Map(imagesRef.current.map(image => [image.id, image]));
    const selected = [...new Set(ids)].flatMap(id => { const image = latest.get(id); return image ? [image] : []; });
    if (!selected.length) return;
    const changes = planStashAssignments(imagesRef.current, categories, selected.map((image, index) => ({ id: image.id, categoryId,
      ...(options?.tray ? { placement: 'tray' as const } : options?.point ? { boardPosition: { x: options.point.x + index * 24, y: options.point.y + index * 24 } } : {}) })),
      boardViewportWidth, preferences.anchors, true);
    const newBoardIds = changes.filter(change => !!change.boardPosition).map(change => change.id);
    if (!categoryId && changes.every(change => latest.get(change.id)?.categoryId === null && !change.boardPosition && !change.placement)) return;
    assignmentLock.current = true;
    setPulseCategoryId(null);
    try {
      await onAssign(changes);
      setCategoryNotice(`${selected.length === 1 ? 'Image' : `${selected.length.toLocaleString()} images`} ${categoryId ? `moved into ${name || categoryById.get(categoryId) || 'stash'}` : 'moved to Unsorted'}.${newBoardIds.length ? ' Added to board.' : ''}`);
      if (categoryId) {
        setPulseCategoryId(categoryId);
        if (pulseTimer.current !== undefined) clearTimeout(pulseTimer.current);
        pulseTimer.current = window.setTimeout(() => setPulseCategoryId(null), 650);
      }
      clearSelection(); setChooserOpen(false);
      return changes;
    } finally { assignmentLock.current = false; }
  };
  const assignDropped = (id: string, categoryId: string) => {
    void assignCategory(dragSelection(id), categoryId === 'unassigned' ? null : categoryId).catch(() => {});
  };
  React.useEffect(() => {
    if (clipEnabled) return;
    matchingRequest.current++; matchingLock.current = false; setMatching(false); setSimilarPreviewIds([]);
    setSimilarityMethod(method => method === 'clip' ? 'color' : method);
    setPileOrder(order => order === 'semantic' ? 'random' : order);
  }, [clipEnabled]);
  const changeSimilarityMethod = (method: SimilarityMethod) => {
    if (method === 'clip' && !clipEnabled) return;
    setSimilarityMethod(method);
  };
  const findSimilarImages = async (referenceId?: string, method: SimilarityMethod = similarityMethod): Promise<SimilarMatch[]> => {
    if (method === 'color') await ensureAnalysis('color');
    if (!mountedRef.current) return [];
    const current = imagesRef.current;
    const references = current.filter(image => imageOnScopeBoard(image, scopeId) && (!referenceId || image.id === referenceId));
    const candidates = current.filter(image => !imageOnScopeBoard(image, scopeId));
    if (method === 'clip') {
      if (!clipEnabled) throw new Error('Content matching is off in project settings.');
      const referenceIds = await ensureClipReferences(references.map(image => image.id));
      if (!referenceIds.length) throw new Error('No readable reference image on the board.');
      // Prepare a bounded starter pool on first use. Matching a single indexed
      // candidate is arbitrary; a small cohort makes the first add meaningful
      // without waiting for a large corpus to finish indexing.
      let matches = await similarContent(candidates.map(image => image.id), referenceIds, drawSize);
      if ((clipProgress.done < Math.min(images.length, 13) || !matches.length) && !['paused', 'error'].includes(clipProgress.phase)) {
        await ensureClipReferences(candidates.slice(0, 12).map(image => image.id));
        matches = await similarContent(candidates.map(image => image.id), referenceIds, drawSize);
      }
      return matches;
    }
    if (!colors(references).length) throw new Error('No readable reference image on the board.');
    return analysisClient().similarColors(colors(candidates), colors(references), drawSize);
  };
  const addSimilar = async (referenceId?: string, method: SimilarityMethod = similarityMethod, preview?: SimilarMatch[]) => {
    if (matchingLock.current || busy) return;
    const request = ++matchingRequest.current;
    matchingLock.current = true; setMatching(true); setAnalysisNotice('');
    try {
      const matches = preview ?? await findSimilarImages(referenceId, method);
      if (!mountedRef.current || request !== matchingRequest.current || scopeRef.current !== scopeId) return;
      // Recheck placement after the async search: dragging can continue during it.
      const byId = new Map(imagesRef.current.map((image) => [image.id, image]));
      const eligible = matches.filter((match) => {
        const image = byId.get(match.id), reference = byId.get(match.referenceId);
        return image && !imageOnScopeBoard(image, scopeId) && reference && imageOnScopeBoard(reference, scopeId);
      });
      if (!eligible.length) { setAnalysisNotice(method === 'clip' ? 'No indexed images left in the pile. Resume CLIP to analyze more images.' : 'No close visual matches left in the pile.'); return; }
      const center = visibleBoardCenter();
      const pane = boardPaneRef.current?.getBoundingClientRect();
      const canvas = boardRef.current?.querySelector<HTMLElement>('[data-testid="board-canvas"]')?.getBoundingClientRect();
      const viewport = pane && canvas ? {
        left: Math.max(0, (pane.left - canvas.left) / zoom), right: (pane.right - canvas.left) / zoom,
        top: Math.max(0, (pane.top - canvas.top) / zoom), bottom: (pane.bottom - canvas.top) / zoom,
      } : { left: 0, right: WORLD_WIDTH, top: 0, bottom: worldHeight };
      const positions = new Map(imagesRef.current.filter(image => imageOnScopeBoard(image, scopeId)).map((image, index) => [image.id,
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
      setAnalysisNotice(`Added ${moves.length} similar ${moves.length === 1 ? 'image' : 'images'}.`);
      window.setTimeout(() => setDealtIds([]), 800);
    } catch (cause) {
      if (mountedRef.current && request === matchingRequest.current) setAnalysisNotice(cause instanceof Error ? cause.message : 'Could not find similar images.');
    } finally { if (request === matchingRequest.current) { matchingLock.current = false; if (mountedRef.current) setMatching(false); } }
  };

  const takeOutToParent = (id: string, point: Point) => {
    if (!currentStash || !document.elementsFromPoint(point.x, point.y).some(element => element.closest('[data-stash-parent]'))) return false;
    const parent = categories.find(stash => stash.name === parentPath(currentStash.name));
    void assignCategory(dragSelection(id), parent?.id || null).then(changes => { if (changes?.length) return navigateStash(parent?.id || null, true, changes[0].boardPosition); }).catch(() => {});
    return true;
  };
  const onStashImageDrop = (id: string, sourceId: string, point: Point) => {
    if (takeOutToParent(id, point) || commitGrouping(id, point)) return;
    const target = categoryAt(point);
    if (target === sourceId) return;
    if (target) { assignDropped(id, target); return; }
    const boardPoint = boardPointAt(point, dragAnchorRef.current);
    if (boardPoint) void assignCategory(dragSelection(id), scopeId, undefined, { point: boardPoint }).catch(() => {});
    else if (contains(trayRef.current?.getBoundingClientRect(), point)) void assignCategory(dragSelection(id), scopeId, undefined, { tray: true }).catch(() => {});
  };

  const onBoardMoveEnd = useStableCallback((id: string, x: number, y: number, _dropPoint?: Point, screenPoint?: Point): boolean => {
    const move = (point: Point) => { onPlaceOnBoard([{ id, x: Math.max(0, point.x), y: Math.max(0, point.y) }]); };
    if (!screenPoint) { move({ x, y }); return true; }
    if (takeOutToParent(id, screenPoint)) return false;
    if (commitGrouping(id, screenPoint)) return false;
    const categoryId = categoryAt(screenPoint);
    if (categoryId) { assignDropped(id, categoryId); return false; }
    if (contains(trayRef.current?.getBoundingClientRect(), screenPoint)) { returnToPile(dragSelection(id)); return true; }
    if (contains(boardPaneRef.current?.getBoundingClientRect(), screenPoint)) {
      const point = boardPointAt(screenPoint, dragAnchorRef.current);
      if (!point) return false;
      move(point);
      return true;
    }
    return false;
  });
  const onTrayMoveEnd = useStableCallback((id: string, x: number, y: number, _dropPoint?: Point, screenPoint?: Point): boolean => {
    if (!screenPoint) return false;
    if (commitGrouping(id, screenPoint)) return false;
    const categoryId = categoryAt(screenPoint);
    if (categoryId) { assignDropped(id, categoryId); return false; }
    const boardPoint = boardPointAt(screenPoint, dragAnchorRef.current);
    if (boardPoint) { onPlaceOnBoard([{ id, ...boardPoint }]); return true; }
    if (contains(trayRef.current?.getBoundingClientRect(), screenPoint)) {
      setTrayPositions((current) => new Map(current).set(id, { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.min(trayViewport.height - pileGeometry.imageSize - 8, Math.round(y))) }));
      return true;
    }
    return false;
  });

  const openBoardImage = useStableCallback((id: string) => { const image = imageById.get(id); if (image) onOpenImage(image, { ids: boardImages.map(image => image.id), parentId: scopeId }); });
  const trayKeyboardMove = useStableCallback((id: string, direction: 'left' | 'right' | 'up' | 'down') => { if (direction === 'up') placeAt(id, { x: initialCenter.x, y: initialCenter.y }); });

  const openPileImage = useStableCallback((id: string) => { const image = imageById.get(id); if (image) onOpenImage(image, { ids: traySequence.map(image => image.id), parentId: scopeId }); });
  useThumbnailUrls(thumbnails, dragging ? [dragging.id] : []);
  const overlayImage = dragging ? imageById.get(dragging.id) : undefined;
  const overlayPoint = dragPointRef.current;
  const overlaySize = dragging && overlayPoint ? dragPreviewSize(dragging.id, overlayPoint) : 0;
  const analysisStatus = analysisProgress.running ? `Analyzing images… ${analysisProgress.done} / ${analysisProgress.total}` :
    preparingOrder ? 'Preparing pile order…' : matching ? 'Finding similar images…' : '';

  const visibleGroups = categoryLayout.groups.filter(group => group.x + group.width >= boardWindow.left && group.x <= boardWindow.right && group.y + group.height >= boardWindow.top && group.y <= boardWindow.bottom);
  const breadcrumbs = currentStash ? currentStash.name.split('/').map((_, index, parts) => categories.find(stash => stash.name.toLocaleLowerCase() === parts.slice(0, index + 1).join('/').toLocaleLowerCase())).filter((stash): stash is LibraryCategory => !!stash) : [];
  const parentStash = currentStash ? categories.find(stash => stash.name.toLocaleLowerCase() === parentPath(currentStash.name).toLocaleLowerCase()) : undefined;
  const groupingCount = dragging && groupPreview ? new Set([...dragSelection(dragging.id), groupPreview.targetId]).size : 0;
  const saveBoardImage = async (scope: BoardExportScope) => {
    if (imageExport.current || busy) return;
    const board = boardRef.current, canvas = board?.querySelector<HTMLElement>('[data-testid="board-canvas"]');
    if (!board || !canvas) return;
    // Read the camera at the click, including fractional pan/zoom. The quantized
    // render window includes overscan and is not the visible screenshot area.
    const root = board.getBoundingClientRect(), world = canvas.getBoundingClientRect();
    const view = { scale: zoom, centerX: (root.left + board.clientWidth / 2 - world.left) / zoom,
      centerY: (root.top + board.clientHeight / 2 - world.top) / zoom, viewportW: board.clientWidth, viewportH: board.clientHeight };
    const exportGroups = categoryLayout.groups.map(group => ({ ...group, ids: group.previewIds }));
    const previewCards = categoryLayout.groups.flatMap(group => group.previewIds.flatMap((id, index) => { const image = imageById.get(id); return image ? [asCard(image, undefined, undefined, { x: group.x + 22 + index * 10, y: group.y + 65 + index * 6 }, index + 1)] : []; }));
    const snapshot = { scope, view, mode: 'stashes' as const, cards: [...boardCards, ...previewCards], groups: exportGroups,
 };
    const controller = new AbortController(); imageExport.current = controller;
    setExportError(''); setExportNotice(''); setExportStatus('Preparing board PNG…');
    try {
      const { exportBoardPng } = await import('./boardExport');
      const result = await exportBoardPng(snapshot, controller.signal, (done, total) => {
        if (mountedRef.current) setExportStatus(`Saving board PNG… ${done.toLocaleString()} / ${total.toLocaleString()}`);
      });
      download(result.blob, `${safeFilename(projectName)}-board-${scope === 'view' ? 'view' : 'full'}.png`);
      if (mountedRef.current) setExportNotice(`Board PNG saved · ${result.width} × ${result.height}${result.reduced ? ' · scaled to fit' : ''}${result.unavailable ? ` · ${result.unavailable} ${result.unavailable === 1 ? 'preview' : 'previews'} unavailable` : ''}`);
    } catch (cause) {
      if (mountedRef.current) {
        if (controller.signal.aborted) setExportNotice('Board image export canceled.');
        else setExportError(cause instanceof Error ? cause.message : 'Could not export the board image.');
      }
    } finally {
      imageExport.current = undefined;
      if (mountedRef.current) {
        setExportStatus('');
        window.clearTimeout(exportNoticeTimer.current);
        exportNoticeTimer.current = window.setTimeout(() => setExportNotice(''), 7000);
      }
    }
  };

  const rememberPileScroll = () => {
    const scroll = trayScrollRef.current;
    if (!pileCollapsed.current && scroll?.clientWidth) pileScrollLeft.current = scroll.scrollLeft;
  };
  const setPileHeight = (height: number) => {
    rememberPileScroll();
    setPileSize(current => height < (pileGeometry.minHeight + pileGeometry.collapsedHeight) / 2
      ? { ...current, collapsed: true }
      : { ...current, collapsed: false, height: Math.round(Math.max(pileGeometry.minHeight, Math.min(pileGeometry.maxHeight, height))) });
  };
  const finishPileResize = (event: React.PointerEvent) => {
    const resize = pileResize.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    if (resize.frame !== undefined) cancelAnimationFrame(resize.frame);
    rememberPileScroll();
    if (resize.next < (pileGeometry.minHeight + pileGeometry.collapsedHeight) / 2) setPileSize(current => ({ ...current, collapsed: true, height: resize.previousHeight }));
    else setPileHeight(resize.next);
    pileResize.current = undefined; setResizingPile(false); clipInteraction(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const processingControls = <>{clipEnabled && <ContentIndexStatus enabled={clipEnabled} compact />}
    {exportStatus && <p role="status">{exportStatus} <button type="button" onClick={() => imageExport.current?.abort()}>Cancel export</button></p>}
    {exportError && <button type="button" onClick={() => setExportError('')}>Dismiss export error</button>}
    {analysisProgress.failed > 0 && <p>{analysisProgress.failed} previews unavailable</p>}
  </>;
  const similarityControls = <div className="workspace-similarity">
    <div className="workspace-similarity-reference" aria-label="Reference images">{boardImages.slice(0, 5).map(image => <img key={image.id} src={objectUrls.get(image.id)} alt={image.path} />)}</div>
    <div className="sorting-workspace__similarity-tools">
      <select aria-label="Similarity method" value={similarityMethod} disabled={matching} onChange={event => changeSimilarityMethod(event.target.value as SimilarityMethod)}>
        {clipEnabled && <option value="clip">Content</option>}<option value="color">Color</option>
      </select>
      <button type="button" aria-label="Add similar to board" disabled={!boardImages.length || !similarCandidateIds || busy || matching} onClick={() => void addSimilar()}><ScanSearch size={17} />Add similar</button>
    </div>
    {processingControls}
  </div>;

  return <main ref={workspaceRef} tabIndex={-1} className={`sorting-workspace sorting-workspace--stashes sorting-workspace--shell${multiSelect ? ' is-selecting' : ''}${resizingPile ? ' is-resizing-pile' : ''}`} aria-label="Sorting workspace"
    style={{ gridTemplateRows: `56px minmax(0,1fr) ${pileGeometry.paneHeight}px`, '--pile-head-height': `${pileGeometry.head}px`, '--pile-grip-height': `${pileGeometry.grip}px`, '--pile-board-height': `${workspaceSize.height - 56 - pileGeometry.paneHeight}px` } as React.CSSProperties}
    onKeyDown={event => {
      if (overviewOpen || event.defaultPrevented) return;

      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Escape') { event.preventDefault(); cancelGrouping(); clearSelection(); setChooserOpen(false); }
    }}
    onLoadCapture={(event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || !image.classList.contains('cardPreview__img')) return;
      const card = image.closest<HTMLElement>('.card');
      if (!card || !image.naturalWidth || !image.naturalHeight) return;
      const scale = Math.min(card.clientWidth / image.naturalWidth, card.clientHeight / image.naturalHeight);
      card.style.setProperty('--image-fit-width', `${image.naturalWidth * scale / card.clientWidth * 100}%`);
      card.style.setProperty('--image-fit-height', `${image.naturalHeight * scale / card.clientHeight * 100}%`);
    }}>
    <h1 className="sorting-workspace__visually-hidden">Sort images</h1>
    <WorkspaceBar clipEnabled={clipEnabled} current={currentStash} breadcrumbs={breadcrumbs} parent={parentStash} directCount={scopeImages.length}
      selectedCount={selectedImages.length} selectionOrigin={selectedImages.length === 1 && selectedImages[0].categoryId !== scopeId ? categoryById.get(selectedImages[0].categoryId || '') || 'Unsorted' : undefined}
      selectMode={multiSelect} allOnBoard={selectedImages.every(image => imageOnScopeBoard(image, scopeId))} canMoveHere={!!scopeId && selectedImages.some(image => image.categoryId !== scopeId)}
      busy={busy || saving} dragging={!!dragging} boardCount={boardImages.length} sortedCount={codedOnBoard.length} zoom={zoom} undo={undo}
      status={exportStatus || exportNotice || (busy ? progress || 'Saving…' : analysisStatus || transientNotice || (saving ? 'Saving…' : message))} error={error || exportError}
      processing={processingControls} similarity={similarityControls}
      exportActions={<ExportActions projectName={projectName} images={images} categories={categories} busy={busy} canFolder={canExportFolder} onSorted={onExport} onBackup={onBackup} onBoardPng={scope => void saveBoardImage(scope)} exportingImage={!!exportStatus} />}
      takeOutHover={takeOutHover} onBack={onBack} onSettings={onSettings} onNavigate={navigateStash} onSelectMode={() => setMultiSelect(value => !value)} onDeselect={clearSelection}
      onCreate={() => void createStash([...selectedIds])} onMove={() => setChooserOpen(true)} onMoveHere={() => void assignCategory([...selectedIds], scopeId)}
      onReturn={() => returnToPile([...selectedIds])} onAdd={() => addMarkedToBoard([...selectedIds])}
      onInspect={() => { if (selectedImages[0]) onOpenImage(selectedImages[0], { ids: boardImages.map(image => image.id), parentId: scopeId }); }}
      onClear={() => returnToPile(boardImages.map(image => image.id))} onClearSorted={() => returnToPile(codedOnBoard.map(image => image.id))} onZoom={setZoom} onRename={onRenameStash} />
    <div className="sorting-workspace__board" ref={boardPaneRef} role="region" aria-label="Sorting board area">
      <Board thumbnailCache={thumbnails} key={scopeId || "root"} cards={visibleBoardCards}
        baseCardWidth={CARD_WIDTH} cardLayoutMode="as-is" showSortSelection showCategoryLabels
        dealtCardIds={dealtIds} dealCardOrigins={dealOrigins} allowExternalDrag
        boardBackground={<StashBoardLayer thumbnailCache={thumbnails} groups={visibleGroups} urls={objectUrls} zoom={zoom} busy={busy || saving} hoverId={hoverCategoryId} pulseId={pulseCategoryId} editingId={editingStashId}
          images={imageById} onImageStart={onDragStart} onImageMove={onDragMove} onImageEnd={onDragEnd} onImageDrop={onStashImageDrop} onOpen={navigateStash} onRename={onRenameStash} onMove={moveCategoryGroup} onPreviewMove={previewGroupMove} onCancelMove={resetGroupPreview} />}
        cardAction={selectedImages.length === 1 && imageOnScopeBoard(selectedImages[0], scopeId) && !dragging ? {
          id: selectedImages[0].id,
          element: <SimilarImageAdd key={`${selectedImages[0].id}:${drawSize}:${similarCandidateIds}`} method={similarityMethod} clipEnabled={clipEnabled} contentRevision={clipRevision} count={drawSize}
            disabled={!similarCandidateIds || busy || matching} images={imageById} urls={objectUrls} thumbnailCache={thumbnails} portal={workspaceRef.current}
            onPreview={method => findSimilarImages(selectedImages[0].id, method)}
            onAdd={(method, matches) => addSimilar(selectedImages[0].id, method, matches)}
            onMethod={changeSimilarityMethod} onThumbnails={previewThumbnails} />,
        } : undefined}
        selectedCardIds={[...selectedIds]} cardCategoryColors={imageColors}  selectionOnly={multiSelect}
        viewScale={zoom} viewCenter={cameraCenter || initialCenter} worldSize={worldSize} panEnabled onViewChange={updateBoardWindow}
        boardRef={boardRef} dragEnabled
        onBringToFront={bringToFront} onSelectCard={selectImage}
        onClearSelection={clearSelection} onLassoSelect={(ids, append) => { setSelectedIds(current => new Set(append ? [...current, ...ids] : ids)); setSelectedId(ids.at(-1) || null); }}
        onOpenPreview={openBoardImage}
        onMoveEnd={onBoardMoveEnd} onDragScreenStart={onDragStart}
        onDragScreenMove={onDragMove} onDragScreenEnd={onDragEnd} />
    </div>

    <section className={`sorting-workspace__tray${pileSize.collapsed ? ' is-collapsed' : ''}`} ref={trayRef} id={trayId} aria-label="Image pile">
      <div className="sorting-workspace__pile-resize" role="separator" tabIndex={0} aria-label="Resize image pile" aria-orientation="horizontal" aria-controls={trayId}
        aria-valuemin={pileGeometry.collapsedHeight} aria-valuemax={pileGeometry.maxHeight} aria-valuenow={pileGeometry.paneHeight} aria-valuetext={pileSize.collapsed ? 'Pile collapsed; add controls remain available' : `${pileGeometry.paneHeight} pixels tall`}
        title="Pull up to expand; pull down to collapse. Use ↑ / ↓, Home / End when focused. Double-click to reset height."
        onDoubleClick={() => setPileSize(current => ({ ...current, height: undefined, collapsed: false }))}
        onKeyDown={event => {
          const height = event.key === 'ArrowUp' ? (pileSize.collapsed ? pileGeometry.expandedHeight : pileGeometry.paneHeight + (event.shiftKey ? 48 : 16))
            : event.key === 'ArrowDown' ? (pileGeometry.paneHeight <= pileGeometry.minHeight ? pileGeometry.collapsedHeight : pileGeometry.paneHeight - (event.shiftKey ? 48 : 16))
            : event.key === 'Home' ? pileGeometry.collapsedHeight : event.key === 'End' ? pileGeometry.maxHeight : undefined;
          if (height === undefined) return;
          event.preventDefault(); event.stopPropagation(); setPileHeight(height);
        }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
          rememberPileScroll();
          pileResize.current = { pointerId: event.pointerId, y: event.clientY, height: pileGeometry.paneHeight, next: pileGeometry.paneHeight, previousHeight: pileSize.height };
          setResizingPile(true); clipInteraction(true);
        }}
        onPointerMove={event => {
          const resize = pileResize.current;
          if (!resize || resize.pointerId !== event.pointerId) return;
          resize.next = resize.height + resize.y - event.clientY;
          if (resize.frame !== undefined) return;
          resize.frame = requestAnimationFrame(() => { resize.frame = undefined; setPileHeight(resize.next); });
        }} onPointerUp={finishPileResize} onPointerCancel={finishPileResize} onLostPointerCapture={finishPileResize}><span aria-hidden="true" /></div>
      <PileDock clipEnabled={clipEnabled} stash={currentStash?.name} count={trayImages.length} total={scopeImages.length} batchSize={drawSize}
        collapsed={!!pileSize.collapsed} disabled={busy || saving} preparing={preparingOrder} order={pileOrder} reversed={reverseOrder}
        feedback={intakeFeedback} geometry={pileGeometry} contentId={`${trayId}-thumbnails`} onAdd={addFromPile} onBatchSize={setDrawSize}
        onToggle={() => { rememberPileScroll(); setPileSize(current => ({ ...current, collapsed: !current.collapsed })); }}
        onExplore={() => { setOverviewCategory(undefined); setOverviewOpen(true); }}
        onBrowseProject={() => { setOverviewCategory(current => ({ id: "all", revision: (current?.revision || 0) + 1 })); setOverviewOpen(true); }}
        onOrder={changePileOrder} onReverse={reversePileOrder} onShuffle={shufflePile} onHeight={setPileHeight}
        onImageSize={imageSize => setPileSize(current => ({ ...current, imageSize, collapsed: false,
          height: Math.max(pileGeometry.expandedHeight, pileGeometry.head + pileGeometry.grip + imageSize + 16) }))}
        onReset={() => setPileSize({ ...DEFAULT_PILE_SIZE })} />
      <div className="sorting-workspace__tray-scroll" hidden={!!pileSize.collapsed} id={`${trayId}-thumbnails`} ref={trayScrollRef} tabIndex={0} aria-label="Scroll image pile">
        <div className="sorting-workspace__tray-canvas" style={{ width: Math.max(650, traySequence.length * pileGeometry.step + pileGeometry.imageSize + 28, ...[...trayPositions.values()].map(point => point.x + pileGeometry.imageSize + 28)) }}>
          {visibleTrayCards.map((card) => <DraggableCard thumbnailCache={thumbnails} key={card.id} card={card} cardW={pileGeometry.imageSize} cardH={pileGeometry.imageSize}
            // Density reflow and scroll anchoring happen together; springing
            // from old positions would briefly empty a virtualized viewport.
            instantPosition
            mode="sort" isSelected={selectedIds.has(card.id)} selectionOnly={multiSelect} categoryColor={imageColors.get(card.id)} dragEnabled onBringToFront={bringToFront}
            onMoveEnd={onTrayMoveEnd} onDragScreenStart={onDragStart} onDragScreenMove={onDragMove} onDragScreenEnd={onDragEnd}
            onSelectCard={selectImage} onKeyboardMove={trayKeyboardMove}
            onOpenPreview={openPileImage}
            categoryLabel={card.meta.tags[0]} />)}
        </div>
      </div>
      {!pileSize.collapsed && pileNav.left && <button className="sorting-workspace__pile-nav sorting-workspace__pile-nav--left" type="button" aria-label="Scroll pile left"
        onClick={() => trayScrollRef.current?.scrollBy({ left: -trayScrollRef.current.clientWidth * .8, behavior: 'smooth' })}><ChevronLeft size={22} /></button>}
      {!pileSize.collapsed && pileNav.right && <button className="sorting-workspace__pile-nav sorting-workspace__pile-nav--right" type="button" aria-label="Scroll pile right"
        onClick={() => trayScrollRef.current?.scrollBy({ left: trayScrollRef.current.clientWidth * .8, behavior: 'smooth' })}><ChevronRight size={22} /></button>}
      {!pileSize.collapsed && trayImages.length === 0 && <p className="sorting-workspace__tray-empty">{scopeImages.length ? 'These images are on the board. Return images here to make space.' : scopeId ? 'This stash has no direct images. Browse the project to bring some in.' : 'Every image is in a stash. Open a stash to keep sorting.'}</p>}
    </section>

    {chooserOpen && <StashPicker categories={categories} images={images} selected={selectedImages} busy={busy || saving} onClose={() => setChooserOpen(false)} onChoose={async id => { await assignCategory([...selectedIds], id); }} onCreate={async name => { await onCreateStash([...selectedIds], scopeId, name); clearSelection(); }} />}
    {dragging && overlayImage && overlayPoint && <div ref={ghostRef} className="sorting-workspace__drag-ghost" style={{
      left: overlayPoint.x, top: overlayPoint.y, width: overlaySize, height: overlaySize,
      transform: `translate(-${dragging.anchor.x * 100}%, -${dragging.anchor.y * 100}%)`,
    }} aria-hidden="true">
      {objectUrls.get(overlayImage.id) ? <img src={objectUrls.get(overlayImage.id)} alt="" /> : <span>{overlayImage.path.split('/').at(-1)}</span>}
      {hoverCategoryId ? <span className="sorting-workspace__drag-count">{hoverCategoryId === 'unassigned' ? 'Move to Unsorted' : `Move ${dragSelection(overlayImage.id).length === 1 ? 'into' : `${dragSelection(overlayImage.id).length} into`} ${categoryById.get(hoverCategoryId)}`}</span> : dragInPile && imageIsOnBoard(overlayImage) ? <span className="sorting-workspace__drag-count">Return {dragSelection(overlayImage.id).length} to pile</span> : dragSelection(overlayImage.id).length > 1 && <span className="sorting-workspace__drag-count">Move {dragSelection(overlayImage.id).length} images</span>}
    </div>}
          {groupPreview && <div key={groupPreview.serial} className={`stash-group-preview${groupPreview.ready ? ' is-ready' : ''}`} style={{ left: groupPreview.position.x, top: groupPreview.position.y }} role="status" aria-label={groupPreview.ready ? 'Release to create stash' : 'Hold to create stash'}>
            <div className="stash-group-preview__row"><span className="stash-group-preview__photos" aria-hidden="true">{[...(dragging ? [...new Set([dragging.id, ...dragSelection(dragging.id)])].slice(0, 2) : []), groupPreview.targetId].map((id, index) => objectUrls.get(id) && <img key={id} src={objectUrls.get(id)} alt="" draggable={false} style={{ rotate: `${(index - 1) * 7}deg` }} />)}</span><span className="stash-group-preview__ring"><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" /></svg>{groupPreview.ready ? <Check size={20} /> : <Layers3 size={20} />}</span></div><strong>{groupPreview.ready ? 'Release to create stash' : 'Hold to create stash'}</strong><small>{groupingCount} images{currentStash ? ` · inside ${currentStash.name.split('/').at(-1)}` : ''}</small>
          </div>}
    <PileOverview clipEnabled={clipEnabled} workspaceScope={scopeId} projectName={projectName} open={overviewOpen} images={orderedImages} categories={categories} thumbnails={thumbnails}
      order={pileOrder} reversed={reverseOrder} preparing={preparingOrder} busy={busy} error={error}
      status={analysisStatus || (clipEnabled ? clipProgress.phase === 'loading' ? `Loading CLIP${clipProgress.percent === undefined ? '…' : ` · ${clipProgress.percent}%`} · first download ~75 MB` : ['indexing', 'paused'].includes(clipProgress.phase) ? `CLIP · ${clipProgress.done} / ${clipProgress.total} indexed${clipProgress.phase === 'paused' ? ' · paused' : ''}` : clipProgress.phase === 'error' ? clipProgress.error || '' : '' : '')}
      indexAction={clipEnabled && (['loading', 'indexing'].includes(clipProgress.phase)
        ? <button type="button" aria-label="Pause CLIP indexing" onClick={pauseClip}><Pause size={12} />Pause</button>
        : ['paused', 'error'].includes(clipProgress.phase) ? <button type="button" aria-label={clipProgress.phase === 'error' ? 'Retry CLIP indexing' : 'Resume CLIP indexing'} onClick={() => void startClip().catch(() => {})}><Play size={12} />{clipProgress.phase === 'error' ? 'Retry' : 'Resume'}</button> : null)}
      onOrder={changePileOrder} onReverse={reversePileOrder} onShuffle={shufflePile} onInteracting={clipInteraction}
      onClose={() => setOverviewOpen(false)} onAdd={addMarkedToBoard}
      categoryNotice={categoryNotice} undo={undo}
      categoryRequest={overviewCategory} onAssign={async (ids, id, name) => { await assignCategory(ids, id, name); }} onCreateStash={(ids, name) => onCreateStash(ids, scopeId, name)} />
  </main>;
}
