import { useThumbnailUrls } from './useThumbnailUrls';
import * as React from 'react';
import { useStableCallback } from './useStableCallback';
import { useWorkspaceZoomGuard } from './useWorkspaceZoomGuard';
import { stashPreviewPosition } from './stashPreviewPosition';
import { flushSync } from 'react-dom';
import { Layers3, ScanSearch, Check } from 'lucide-react';
import { Board } from './Board';
import WorkspaceBar from './WorkspaceBar';
import BoardToolbar from './BoardToolbar';
import ExportActions from './ExportActions';
import type { UndoView } from './UndoControl';
import SimilarImageAdd, { type SimilarityMethod } from './SimilarImageAdd';
import { download, safeFilename } from './download';
import type { BoardExportScope } from './boardExport';
import { categoryColor } from './categoryTree';
import { imageIsOnBoard, type CategoryAssignment, type LibraryCategory, type LibraryImage } from './libraryStore';
import StashPicker from './StashPicker';
import StashBoardLayer from './StashBoardLayer';
import { planStashAssignments } from './stashPlacement';
import { stashBoardLayout, imageOnScopeBoard, inGroupingTarget, STASH_HOLD_MS, STASH_HOLD_SLOP, parentPath } from './stashBoard';

import { type BoardPoint, type CategoryBoardGroup } from './categoryBoard';
import { restoreStashAnchor, useBoardPreferences } from './useBoardPreferences';
import { orderByMetadata, type PileOrder, type SimilarMatch } from './imageAnalysis';
import { useImageAnalysis } from './useImageAnalysis';
import { useContentIndex } from './ContentIndex';
import ContentIndexStatus from './ContentIndexStatus';
import { type ImageThumbnailCache, useThumbnails } from './imageThumbnails';
import ImageBrowser from './ImageBrowser';
import { readImageBrowserView } from './imageBrowserView';
import { useBoardNavigation } from './useBoardNavigation';
import { fitBoardView, MIN_BOARD_ZOOM } from './stashView';
import { useImageIntake, type BoardMove } from './useImageIntake';
import { useWorkspaceSelection } from './useWorkspaceSelection';
import type { ProjectAction } from './useActionHistory';
import type { CardData } from './types';
import './workspace.css';
import './stash-board.css';
import './workspace-shell.css';

type Point = { x: number; y: number };

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
  onRememberAction: (action: ProjectAction) => void;
  undo?: UndoView;
  onCreateStash: (ids: string[], parentId: string | null, name?: string) => Promise<LibraryCategory>;
  onRenameStash: (id: string, name: string) => Promise<void>;
  onPrepareStash: (id: string, width: number) => Promise<void>;
  onPlaceOnBoard: (moves: BoardMove[]) => void;
  onReturnToPile: (ids: string[]) => void;
};

const WORLD_WIDTH = 2200;
const CARD_WIDTH = 172;

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
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
  onCreateStash, onRenameStash, onPrepareStash, onRememberAction, onPlaceOnBoard: saveBoardMoves, onReturnToPile, canExportFolder, onExport, onBackup, initialBrowser, undo,
}: Props) {
  const workspaceRef = React.useRef<HTMLElement>(null);
  useWorkspaceZoomGuard(workspaceRef);
  const boardRef = React.useRef<HTMLDivElement>(null);
  const boardPaneRef = React.useRef<HTMLDivElement>(null);
  const browserRef = React.useRef<HTMLElement>(null);
  const ghostRef = React.useRef<HTMLDivElement>(null);
  const groupPreviewRef = React.useRef<HTMLDivElement>(null);
  const dragPointerType = React.useRef('mouse');
  const dragPointRef = React.useRef<Point | null>(null);
  const dragAnchorRef = React.useRef<Point>({ x: .5, y: .5 });
  const browserDragSize = React.useRef(120);
  const mountedRef = React.useRef(true);
  const [preferences, setPreferences] = useBoardPreferences(projectId);
  const [browserPanel, setBrowserPanel] = React.useState(() => {
    const view = readImageBrowserView(projectId);
    return { width: view.width, collapsed: view.collapsed && !initialBrowser, expanded: !!initialBrowser };
  });
  const updateBrowserPanel = useStableCallback(setBrowserPanel);
  const [workspaceSize, setWorkspaceSize] = React.useState({ width: window.innerWidth, height: window.innerHeight });
  const { scopeId, setScopeId, scopeRef, cameras, zoom, setZoom, cameraCenter, setCameraCenter,
    boardViewportWidth, boardWindow, updateBoardWindow, persistCamera } = useBoardNavigation(projectId, categories,
      window.innerWidth <= 700 ? window.innerWidth : window.innerWidth - Math.min(browserPanel.collapsed ? 48 : browserPanel.width, window.innerWidth * .42));
  const [editingStashId, setEditingStashId] = React.useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = React.useState(false);
  const [groupPreview, setGroupPreview] = React.useState<{ targetId: string; ready: boolean; serial: number; position: Point } | null>(null);
  const hold = React.useRef<{ targetId: string; point: Point; ready: boolean; timer: number; serial: number }>();
  const groupSerial = React.useRef(0);
  const placeGroupPreview = (point: Point, size = { width: 220, height: window.innerWidth <= 700 ? 94 : 108 }) => {
    const pane = boardPaneRef.current!.getBoundingClientRect();
    // The cue may float over the toolbar while holding, leaving the board
    // and finger clear. It cannot intercept navigation or drop targets.
    const top = workspaceRef.current?.getBoundingClientRect().top ?? pane.top;
    return stashPreviewPosition(point, { left: pane.left, right: pane.right, bottom: pane.bottom, top }, size.width, size.height, dragPointerType.current === 'touch');
  };
  React.useLayoutEffect(() => {
    const node = groupPreviewRef.current, point = hold.current?.point;
    if (!node || !point || !groupPreview) return;
    const position = placeGroupPreview(point, { width: node.offsetWidth, height: node.offsetHeight });
    if (Math.abs(position.x - groupPreview.position.x) + Math.abs(position.y - groupPreview.position.y) > .5) {
      setGroupPreview(current => current && current.serial === groupPreview.serial ? { ...current, position } : current);
    }
  }, [groupPreview?.serial, groupPreview?.ready, workspaceSize.width, workspaceSize.height, browserPanel.width, browserPanel.collapsed]);
  const onPlaceOnBoard = (moves: BoardMove[]) => saveBoardMoves(moves.map(move => ({ ...move, boardScope: scopeId })));
  const [pulseCategoryId, setPulseCategoryId] = React.useState<string | null>(null);
  const pulseTimer = React.useRef<number>();
  const [dragInPile, setDragInPile] = React.useState(false);
  const [takeOutHover, setTakeOutHover] = React.useState(false);
  const navigationLock = React.useRef(false);
  const thumbnails = thumbnailCache;
  const objectUrls = thumbnails.urls;
  const imageExport = React.useRef<AbortController>();
  const [exportStatus, setExportStatus] = React.useState('');
  const [exportNotice, setExportNotice] = React.useState('');
  const [exportError, setExportError] = React.useState('');
  const exportNoticeTimer = React.useRef<number>();
  React.useEffect(() => () => { imageExport.current?.abort(); window.clearTimeout(exportNoticeTimer.current); }, []);
  const { selectedId, setSelectedId, selectedIds, setSelectedIds, multiSelect, setMultiSelect, clearSelection, selectImage, dragSelection } = useWorkspaceSelection(images);
  const assignmentLock = React.useRef(false);
  const [trayOrder, setTrayOrder] = React.useState<string[]>([]);
  const [zOrder, setZOrder] = React.useState<Map<string, number>>(new Map());
  const [dragging, setDragging] = React.useState<{ id: string; anchor: Point; origin: 'board' | 'browser' | 'stash' } | null>(null);
  const [hoverCategoryId, setHoverCategoryId] = React.useState<string | null>(null);
  const drawSize = 3;
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
  const imagesRef = React.useRef(images);
  imagesRef.current = images;
  const { metadata, progress: analysisProgress, ensure: ensureAnalysis, client: analysisClient, hashes, colors } = useImageAnalysis(images);
  const { progress: clipProgress, revision: clipRevision, orderRevision: clipOrderRevision, ensureReferences: ensureClipReferences, order: orderContent, similar: similarContent, setInteracting: clipInteraction } = useContentIndex();
  React.useEffect(() => () => clipInteraction(false), [clipInteraction]);

  const currentStash = categories.find(stash => stash.id === scopeId);
  const previousScopePath = React.useRef('');
  if (currentStash) previousScopePath.current = currentStash.name;
  const boardImages = React.useMemo(() => images.filter(image => imageOnScopeBoard(image, scopeId)), [images, scopeId]);
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
  const appearanceFramed = React.useRef(false);
  React.useLayoutEffect(() => {
    if (appearanceFramed.current || !categoryLayout.groups.length || boardCards.length || !boardPaneRef.current) return;
    appearanceFramed.current = true;
    try { if (localStorage.getItem(`folder-sort-board-appearance:${projectId}`) === '2') return; } catch { /* Use this mount's guard. */ }
    const pane = boardPaneRef.current, view = fitBoardView(categoryLayout.groups, pane.clientWidth, pane.clientHeight);
    setZoom(view.zoom); setCameraCenter({ x: view.x, y: view.y });
    cameras.current[scopeId || 'root'] = view; persistCamera();
    try { localStorage.setItem(`folder-sort-board-appearance:${projectId}`, '2'); } catch { /* Camera remains usable. */ }
  }, [projectId, scopeId, categoryLayout.groups, boardCards.length]);
  const boardCardById = React.useMemo(() => new Map(boardCards.map(card => [card.id, card])), [boardCards]);
  const worldHeight = Math.max(categoryLayout.height, ...boardCards.map(card => card.y + CARD_WIDTH + workspaceSize.height / (2 * zoom) + 120));
  const worldWidth = Math.max(WORLD_WIDTH, ...boardCards.map(card => card.x + CARD_WIDTH + boardViewportWidth / (2 * zoom) + 120), ...categoryLayout.groups.map(group => group.x + group.width + 48));
  const worldSize = React.useMemo(() => ({ width: worldWidth, height: worldHeight }), [worldWidth, worldHeight]);
  const initialCenter = React.useMemo(() => {
    const saved = cameras.current[scopeId || 'root'];
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return { x: saved.x, y: saved.y };
    if (boardCards.length) {
      const first = boardCards.reduce((first, card) => card.y < first.y || card.y === first.y && card.x < first.x ? card : first);
      const minX = Math.min(...boardCards.map(card => card.x)), maxX = Math.max(...boardCards.map(card => card.x + CARD_WIDTH));
      const minY = Math.min(...boardCards.map(card => card.y)), maxY = Math.max(...boardCards.map(card => card.y + CARD_WIDTH));
      const fits = maxX - minX < boardViewportWidth - 64 && maxY - minY < (boardPaneRef.current?.clientHeight || workspaceSize.height - 56) - 64;
      return fits ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : { x: first.x + Math.max(120, boardViewportWidth / 2 - 96), y: first.y + Math.max(110, (boardPaneRef.current?.clientHeight || workspaceSize.height - 56) / 2 - 100) };
    }
    if (categoryLayout.groups.length) {
      const first = categoryLayout.groups[0]; return { x: first.x + first.width / 2, y: first.y + first.height / 2 };
    }
    return { x: Math.max(160, (window.innerWidth - browserPanel.width) / 2), y: Math.max(180, (window.innerHeight - 56) / 2) };
  }, [scopeId]);
  React.useEffect(() => () => window.clearTimeout(hold.current?.timer), []);
  React.useEffect(() => { if (scopeId && !categories.some(stash => stash.id === scopeId)) {
    const parent = categories.find(stash => stash.name.toLocaleLowerCase() === parentPath(previousScopePath.current).toLocaleLowerCase());
    matchingRequest.current++; matchingLock.current = false; setMatching(false);
    setScopeId(parent?.id || null); scopeRef.current = parent?.id || null;
    setCameraCenter(undefined); clearSelection();
    const camera = cameras.current[parent?.id || 'root']; setZoom(camera?.zoom >= MIN_BOARD_ZOOM && camera.zoom <= 2 ? camera.zoom : 1);
  } }, [scopeId, categories]);
  React.useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const update = () => setWorkspaceSize(current => current.width === workspace.clientWidth && current.height === workspace.clientHeight
      ? current : { width: workspace.clientWidth, height: workspace.clientHeight });
    const observer = new ResizeObserver(update);
    observer.observe(workspace); update();
    return () => observer.disconnect();
  }, []);
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
    if (!clipEnabled || pileOrder !== 'semantic' || dragging) return;
    let active = true;
    // Refresh occasionally and after a completed batch; hold it during drags.
    // Unindexed images remain accessible at the end.
    void orderContent(imagesRef.current.map((image) => image.id)).then((ids) => {
      if (active) setContentIds(ids);
    }).catch((cause) => { if (active && !(cause instanceof DOMException && cause.name === 'AbortError')) setAnalysisNotice(cause instanceof Error ? cause.message : 'Could not order by content.'); });
    return () => { active = false; };
  }, [clipEnabled, pileOrder, allIds, clipOrderRevision, dragging, orderContent]);

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
  const visibleBoardCards = boardCards.filter(card => card.id === selectedId || card.id === dragging?.id ||
    card.x + CARD_WIDTH >= boardWindow.left && card.x <= boardWindow.right && card.y + CARD_WIDTH >= boardWindow.top && card.y <= boardWindow.bottom)
    .map(card => ({ ...card, src: objectUrls.get(card.id) }));
  useThumbnails(thumbnails, [...visibleBoardCards.map(card => card.id), ...similarPreviewIds,
    ...categoryLayout.groups.filter(group => group.x + group.width >= boardWindow.left && group.x <= boardWindow.right && group.y + group.height >= boardWindow.top && group.y <= boardWindow.bottom).flatMap(group => group.previewIds)], true, false);
  const intake = useImageIntake({ images, scopeId, zoom, board: boardRef, pane: boardPaneRef, cards: boardCards, groups: categoryLayout.groups, onPlace: onPlaceOnBoard,
    onFrame: view => { setZoom(view.zoom); setCameraCenter({ x: view.x, y: view.y }); } });
  const onBoardIds = React.useMemo(() => new Set(boardImages.map(image => image.id)), [boardImages]);

  const returnToPile = (ids: string[]) => { clearSelection(); onReturnToPile(ids); };
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
    if (!delta.x && !delta.y) { resetGroupPreview(); return; }
    const previous = { x: group.x, y: group.y };
    onRememberAction({ projectId, kind: 'layout', label: 'Undo stash move', message: `Moved ${group.name.split('/').at(-1)}.`,
      detail: 'Undo restores the stack position. Images and assignments are kept.', restored: 'Previous stash position restored.',
      restore: async () => { restoreStashAnchor(projectId, group.id, previous); } });
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
    cancelGrouping(); clearSelection(); setChooserOpen(false); setEditingStashId(null);
    setScopeId(id); scopeRef.current = id; setCameraCenter(undefined);
    const saved = cameras.current[id || 'root'];
    setZoom(saved && saved.zoom >= MIN_BOARD_ZOOM && saved.zoom <= 2 ? saved.zoom : 1);
    if (reveal) {
      const scale = saved && saved.zoom >= MIN_BOARD_ZOOM && saved.zoom <= 2 ? saved.zoom : 1, width = boardViewportWidth / scale, height = (boardPaneRef.current?.clientHeight || workspaceSize.height - 56) / scale;
      const center = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : { x: reveal.x + width / 2, y: reveal.y + height / 2 };
      const point = { x: Math.max(reveal.x + CARD_WIDTH + 12 - width / 2, Math.min(center.x, reveal.x - 12 + width / 2)),
        y: Math.max(reveal.y + CARD_WIDTH + 12 - height / 2, Math.min(center.y, reveal.y - 12 + height / 2)) };
      cameras.current[id || 'root'] = { ...point, zoom: scale }; setCameraCenter(point);
    }
    persistCamera();
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
      const position = { x: Math.max(8, anchor.x), y: Math.max(48, anchor.y) };
      setPreferences(current => ({ ...current, anchors: { ...current.anchors, [stash.id]: position } }));
      clearSelection(); setEditingStashId(stash.id); setPulseCategoryId(stash.id);
      const pane = boardPaneRef.current?.getBoundingClientRect(), canvas = boardRef.current?.querySelector('[data-testid="board-canvas"]')?.getBoundingClientRect();
      if (pane && canvas && (canvas.left + position.x * zoom < pane.left + 8 || canvas.top + position.y * zoom < pane.top + 8 ||
        canvas.left + (position.x + 200) * zoom > pane.right - 8 || canvas.top + (position.y + 196) * zoom > pane.bottom - 8)) {
        setCameraCenter({ x: position.x + 100, y: position.y + 98 });
      }
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
    const position = placeGroupPreview(point);
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
    if (contains(browserRef.current?.getBoundingClientRect(), point)) return browserDragSize.current;
    const image = imageById.get(id);
    return image && imageIsOnBoard(image) ? CARD_WIDTH * zoom : Number(browserRef.current?.dataset.thumbnailSize) || 96;
  };
  const onDragStart = useStableCallback((id: string, point: Point, anchor: Point, origin: 'board' | 'browser' | 'stash' = 'board') => {
    clipInteraction(true);
    dragPointRef.current = point;
    dragAnchorRef.current = anchor;
    setDragging({ id, anchor, origin });
    setDragInPile(false); setTakeOutHover(false);
    cancelGrouping();
  });
  const onBrowserDragStart = useStableCallback((id: string, point: Point, anchor: Point) => {
    browserDragSize.current = browserRef.current?.querySelector<HTMLElement>(`[data-testid="browser-card-${CSS.escape(id)}"]`)?.getBoundingClientRect().width || Number(browserRef.current?.dataset.thumbnailSize) || 120;
    onDragStart(id, point, anchor, 'browser');
  });
  const onStashDragStart = useStableCallback((id: string, point: Point, anchor: Point) => onDragStart(id, point, anchor, 'stash'));
  const onDragMove = useStableCallback((id: string, point: Point) => {
    if (!dragPointRef.current) return;
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
    setDragInPile(contains(browserRef.current?.getBoundingClientRect(), point));
    setHoverCategoryId(targetId);
    if (targetId) cancelGrouping(); else prepareGrouping(id, point);
  });
  const onDragEnd = useStableCallback(() => { cancelGrouping(); resetGroupPreview(); clipInteraction(false); dragPointRef.current = null; setDragging(null); setHoverCategoryId(null); setDragInPile(false); setTakeOutHover(false); });
  const bringToFront = useStableCallback((id: string) => setZOrder((current) => new Map(current).set(id, Math.max(0, ...current.values()) + images.length + 1)));
  const changePileOrder = (order: PileOrder) => {
    if (order === 'semantic' && !clipEnabled) return;
    setPileOrder(order); setReverseOrder(false); setAnalysisNotice('');
    if (order === 'semantic') setSimilarityMethod('clip');
  };
  const reversePileOrder = () => setReverseOrder(value => !value);
  const shufflePile = () => { changePileOrder('random'); setTrayOrder(shuffled(images.map(image => image.id))); };
  const addMarkedToBoard = (ids: string[], origin?: DOMRect) => {
    if (busy || saving) return;
    const added = intake.add(ids, origin);
    if (added) { clearSelection(); setAnalysisNotice(`Added ${added.toLocaleString()} ${added === 1 ? 'image' : 'images'} to the board.`); }
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
      setAnalysisNotice(`${selected.length === 1 ? 'Image' : `${selected.length.toLocaleString()} images`} ${categoryId ? `moved into ${name || categoryById.get(categoryId) || 'stash'}` : 'moved to Unsorted'}.${newBoardIds.length ? ' Added to board.' : ''}`);
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
      intake.animate(moves.map(move => move.id));
      onPlaceOnBoard(moves);
      setAnalysisNotice(`Added ${moves.length} similar ${moves.length === 1 ? 'image' : 'images'}.`);
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
    else if (contains(browserRef.current?.getBoundingClientRect(), point)) void assignCategory(dragSelection(id), null, undefined, { tray: true }).catch(() => {});
  };

  const onBoardMoveEnd = useStableCallback((id: string, x: number, y: number, _dropPoint?: Point, screenPoint?: Point): boolean => {
    const move = (point: Point) => { onPlaceOnBoard([{ id, x: Math.max(0, point.x), y: Math.max(0, point.y) }]); };
    if (!screenPoint) { move({ x, y }); return true; }
    if (takeOutToParent(id, screenPoint)) return false;
    if (commitGrouping(id, screenPoint)) return false;
    const categoryId = categoryAt(screenPoint);
    if (categoryId) { assignDropped(id, categoryId); return false; }
    if (contains(browserRef.current?.getBoundingClientRect(), screenPoint)) { returnToPile(dragSelection(id)); return true; }
    if (contains(boardPaneRef.current?.getBoundingClientRect(), screenPoint)) {
      const point = boardPointAt(screenPoint, dragAnchorRef.current);
      if (!point) return false;
      move(point);
      return true;
    }
    return false;
  });
  const onBrowserMoveEnd = useStableCallback((id: string, _x: number, _y: number, _dropPoint?: Point, screenPoint?: Point): boolean => {
    if (!screenPoint) return false;
    if (commitGrouping(id, screenPoint)) return false;
    const categoryId = categoryAt(screenPoint);
    if (categoryId) { assignDropped(id, categoryId); return false; }
    const point = boardPointAt(screenPoint, dragAnchorRef.current);
    if (point) onPlaceOnBoard([{ id, ...point }]);
    // Browser thumbnails keep their slots, including after a successful add.
    return false;
  });

  const openBoardImage = useStableCallback((id: string) => { const image = imageById.get(id); if (image) onOpenImage(image, { ids: boardImages.map(image => image.id), parentId: scopeId }); });
  useThumbnailUrls(thumbnails, dragging ? [dragging.id] : []);
  const overlayImage = dragging ? imageById.get(dragging.id) : undefined;
  const overlayPoint = dragPointRef.current;
  const overlaySize = dragging && overlayPoint ? dragPreviewSize(dragging.id, overlayPoint) : 0;
  const analysisStatus = analysisProgress.running ? `Analyzing images… ${analysisProgress.done} / ${analysisProgress.total}` :
    preparingOrder ? 'Preparing image order…' : matching ? 'Finding similar images…' : '';

  const visibleGroups = categoryLayout.groups.filter(group => group.x + group.width >= boardWindow.left && group.x <= boardWindow.right && group.y + group.height >= boardWindow.top && group.y <= boardWindow.bottom);
  const breadcrumbs = currentStash ? currentStash.name.split('/').map((_, index, parts) => categories.find(stash => stash.name.toLocaleLowerCase() === parts.slice(0, index + 1).join('/').toLocaleLowerCase())).filter((stash): stash is LibraryCategory => !!stash) : [];
  const parentStash = currentStash ? categories.find(stash => stash.name.toLocaleLowerCase() === parentPath(currentStash.name).toLocaleLowerCase()) : undefined;
  const groupingCount = dragging && groupPreview ? new Set([...dragSelection(dragging.id), groupPreview.targetId]).size : 0;
  const fitBoard = () => {
    const pane = boardPaneRef.current;
    if (!pane) return;
    const view = fitBoardView([...boardCards.map(card => ({ ...card, width: CARD_WIDTH, height: CARD_WIDTH })), ...categoryLayout.groups], pane.clientWidth, pane.clientHeight);
    setZoom(view.zoom); setCameraCenter({ x: view.x, y: view.y });
  };
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
    const previewCards = categoryLayout.groups.flatMap(group => [...group.previewIds].reverse().flatMap((id, index, ids) => {
      const image = imageById.get(id); return image ? [{ ...asCard(image, undefined, undefined,
        { x: group.x + 26 + (index - ids.length + 1) * 5, y: group.y + 42 + (index - ids.length + 1) * 3 }, index + 1), frame: { width: 148, height: 104 } }] : [];
    }));
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

  return <main ref={workspaceRef} tabIndex={-1} className={`sorting-workspace sorting-workspace--stashes sorting-workspace--shell sorting-workspace--browser${multiSelect ? ' is-selecting' : ''}${browserPanel.expanded ? ' is-browser-expanded' : ''}${browserPanel.collapsed ? ' is-browser-collapsed' : ''}`} aria-label="Sorting workspace"
    style={{ '--image-browser-width': `${browserPanel.collapsed ? 48 : browserPanel.width}px`, '--pile-board-height': `${workspaceSize.height - 56}px` } as React.CSSProperties}
    onPointerDownCapture={event => { dragPointerType.current = event.pointerType; }}
    onKeyDown={event => {
      if (event.defaultPrevented) return;

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
    <WorkspaceBar projectName={projectName} clipEnabled={clipEnabled} current={currentStash} breadcrumbs={breadcrumbs} parent={parentStash}
      selectedCount={selectedImages.length} allOnBoard={selectedImages.every(image => imageOnScopeBoard(image, scopeId))} canMoveHere={!!scopeId && selectedImages.some(image => image.categoryId !== scopeId)}
      busy={busy || saving} dragging={!!dragging} boardCount={boardImages.length} sortedCount={codedOnBoard.length} zoom={zoom} undo={undo}
      status={exportStatus || exportNotice || (busy ? progress || 'Saving…' : analysisStatus || analysisNotice || (saving ? 'Saving…' : message))} error={error || exportError}
      processing={processingControls} similarity={similarityControls}
      exportActions={<ExportActions projectName={projectName} images={images} categories={categories} busy={busy} canFolder={canExportFolder} onSorted={onExport} onBackup={onBackup} onBoardPng={scope => void saveBoardImage(scope)} exportingImage={!!exportStatus} />}
      takeOutHover={takeOutHover} onBack={onBack} onSettings={onSettings} onNavigate={navigateStash} onDeselect={clearSelection}
      onMove={() => setChooserOpen(true)} onMoveHere={() => void assignCategory([...selectedIds], scopeId)}
      onReturn={() => returnToPile([...selectedIds])} onAdd={() => addMarkedToBoard([...selectedIds])}
      onInspect={() => { if (selectedImages[0]) onOpenImage(selectedImages[0], { ids: boardImages.map(image => image.id), parentId: scopeId }); }}
      onClear={() => returnToPile(boardImages.map(image => image.id))} onClearSorted={() => returnToPile(codedOnBoard.map(image => image.id))} onZoom={setZoom} onFit={fitBoard} onRename={onRenameStash} />
    <ImageBrowser projectId={projectId} images={orderedImages} categories={categories} thumbnails={thumbnails}
      onBoardIds={onBoardIds} selectedIds={selectedIds} draggingId={dragging?.id} multiSelect={multiSelect}
      busy={busy || saving} preparing={preparingOrder} clipEnabled={clipEnabled} order={pileOrder} reversed={reverseOrder} status={analysisStatus || analysisNotice}
      initialExpanded={initialBrowser} regionRef={browserRef} onPanel={updateBrowserPanel}
      onOrder={changePileOrder} onReverse={reversePileOrder} onShuffle={shufflePile} onSelect={selectImage} onDeselect={clearSelection}
      onAdd={addMarkedToBoard} onMove={() => setChooserOpen(true)} onBringToFront={bringToFront}
      onOpen={(image, ids) => onOpenImage(image, { ids, parentId: scopeId })}
      onDragStart={onBrowserDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDrop={onBrowserMoveEnd} onInteracting={clipInteraction} />
    <section className="sorting-workspace__board-region" aria-label="Sorting workspace board">
    <BoardToolbar title={currentStash?.name.split('/').at(-1) || 'Sorting board'} selected={selectedImages.length} selectMode={multiSelect}
      busy={busy || saving} dragging={!!dragging} zoom={zoom} onZoom={setZoom} onFit={fitBoard}
      onSelectMode={() => setMultiSelect(value => !value)} onDeselect={clearSelection} onMove={() => setChooserOpen(true)} onCreate={() => void createStash([...selectedIds])} />
    <div className="sorting-workspace__board" ref={boardPaneRef} role="region" aria-label="Sorting board area">
      <Board thumbnailCache={thumbnails} key={scopeId || "root"} cards={visibleBoardCards}
        baseCardWidth={CARD_WIDTH} cardLayoutMode="as-is" showSortSelection showCategoryLabels
        dealtCardIds={intake.dealtIds} dealCardOrigins={intake.dealOrigins} allowExternalDrag
        boardBackground={<StashBoardLayer thumbnailCache={thumbnails} groups={visibleGroups} urls={objectUrls} zoom={zoom} busy={busy || saving} hoverId={hoverCategoryId} pulseId={pulseCategoryId} editingId={editingStashId}
          images={imageById} onImageStart={onStashDragStart} onImageMove={onDragMove} onImageEnd={onDragEnd} onImageDrop={onStashImageDrop} onOpen={navigateStash} onRename={onRenameStash} onMove={moveCategoryGroup} onPreviewMove={previewGroupMove} onCancelMove={resetGroupPreview} />}
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
        onGestureView={view => { setZoom(view.scale); setCameraCenter({ x: view.centerX, y: view.centerY }); }}
        boardRef={boardRef} dragEnabled={!busy}
        onBringToFront={bringToFront} onSelectCard={selectImage}
        onClearSelection={clearSelection} onLassoSelect={(ids, append) => { setSelectedIds(current => new Set(append ? [...current, ...ids] : ids)); setSelectedId(ids.at(-1) || null); }}
        onOpenPreview={openBoardImage}
        onMoveEnd={onBoardMoveEnd} onDragScreenStart={onDragStart}
        onDragScreenMove={onDragMove} onDragScreenEnd={onDragEnd} />
      {!boardCards.length && !categoryLayout.groups.length && <p className="workspace-empty-board">Drag images here to compare, or drop them onto a stash.</p>}
    </div>

    <footer className={`workspace-board-status${error || exportError ? ' has-error' : ''}`} title={error || exportError || message}>
      {error || exportError || exportStatus || exportNotice || (busy ? progress : saving ? 'Saving…' : analysisNotice) || 'Hold an image over another to create a stash.'}
    </footer>
    </section>

    {chooserOpen && <StashPicker categories={categories} images={images} selected={selectedImages} busy={busy || saving} onClose={() => setChooserOpen(false)} onChoose={async id => { await assignCategory([...selectedIds], id); }} onCreate={async name => { await onCreateStash([...selectedIds], scopeId, name); clearSelection(); }} />}
    {dragging && overlayImage && overlayPoint && <div ref={ghostRef} className="sorting-workspace__drag-ghost" style={{
      left: overlayPoint.x, top: overlayPoint.y, width: overlaySize, height: overlaySize,
      transform: `translate(-${dragging.anchor.x * 100}%, -${dragging.anchor.y * 100}%)`,
    }} aria-hidden="true">
      {objectUrls.get(overlayImage.id) ? <img src={objectUrls.get(overlayImage.id)} alt="" /> : <span>{overlayImage.path.split('/').at(-1)}</span>}
      {hoverCategoryId ? <span className="sorting-workspace__drag-count">{hoverCategoryId === 'unassigned' ? 'Move to Unsorted' : `Move ${dragSelection(overlayImage.id).length === 1 ? 'into' : `${dragSelection(overlayImage.id).length} into`} ${categoryById.get(hoverCategoryId)}`}</span> : dragInPile && dragging.origin === 'stash' ? <span className="sorting-workspace__drag-count">Move to Unsorted</span> : dragInPile && dragging.origin === 'board' && imageIsOnBoard(overlayImage) ? <span className="sorting-workspace__drag-count">Remove {dragSelection(overlayImage.id).length} from board</span> : dragSelection(overlayImage.id).length > 1 && <span className="sorting-workspace__drag-count">Move {dragSelection(overlayImage.id).length} images</span>}
    </div>}
          {groupPreview && <div ref={groupPreviewRef} key={groupPreview.serial} className={`stash-group-preview${groupPreview.ready ? ' is-ready' : ''}`} style={{ left: groupPreview.position.x, top: groupPreview.position.y }} role="status" aria-label={groupPreview.ready ? 'Release to create stash' : 'Hold to create stash'}>
            <div className="stash-group-preview__row"><span className="stash-group-preview__photos" aria-hidden="true">{[...(dragging ? [...new Set([dragging.id, ...dragSelection(dragging.id)])].slice(0, 2) : []), groupPreview.targetId].map((id, index) => objectUrls.get(id) && <img key={id} src={objectUrls.get(id)} alt="" draggable={false} style={{ rotate: `${(index - 1) * 7}deg` }} />)}</span><span className="stash-group-preview__ring"><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" /></svg>{groupPreview.ready ? <Check size={20} /> : <Layers3 size={20} />}</span></div><strong>{groupPreview.ready ? 'Release to create stash' : 'Hold to create stash'}</strong><small>{groupingCount} images{currentStash ? ` · inside ${currentStash.name.split('/').at(-1)}` : ''}</small>
          </div>}
  </main>;
}
