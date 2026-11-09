import { ContextMenuProvider, contextKey, nativeContextTarget, useContextMenuController, type ContextAction, type ContextTrigger } from './ContextMenu';
import FolderRenameDialog from './FolderRenameDialog';
import { effectiveBrowserWidth } from './imageBrowserView';
import { folderMoveProblem } from './folderNesting';
import FolderSidebar from './FolderSidebar';
import { useFolderSidebar } from './useFolderSidebar';
import { HoldToGroup } from './holdToGroup';
import { usePreparedImageOrder } from './usePreparedImageOrder';
import { useBoardImageExport } from './useBoardImageExport';
import { useTimedValue } from './useTimedValue';
import { useWorkspaceMatching } from './useWorkspaceMatching';
import { useAsyncTask } from './useAsyncTask';
import { FolderNavigation } from './folderNavigation';
import { resolveImageDrop, type ImageDragSource, type ImageDrop } from './imageDrop';
import type { BoardEdit } from './boardEdit';
import { useThumbnailUrls } from './useThumbnailUrls';
import * as React from 'react';
import { useStableCallback } from './useStableCallback';
import { useBoardGroupDrag } from './useBoardGroupDrag';
import { useWorkspaceZoomGuard } from './useWorkspaceZoomGuard';
import { stashPreviewPosition } from './stashPreviewPosition';
import { flushSync } from 'react-dom';
import { ScanSearch } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import StashCreationCue from './StashCreationCue';
import { Board } from './Board';
import WorkspaceBar from './WorkspaceBar';
import ExportActions from './ExportActions';
import { MenuItem } from './UiActions';
import type { UndoView } from './UndoControl';
import SimilarImageAdd, { type SimilarityMethod } from './SimilarImageAdd';
import FolderNameSuggestions from './FolderNameSuggestions';
import BoardImageActions from './BoardImageActions';
import RandomImageAdd from './RandomImageAdd';
import { categoryColor, emptyStashIds } from './categoryTree';
import { type CategoryAssignment, type LibraryCategory, type LibraryImage } from './libraryStore';
import StashPicker from './StashPicker';
import StashBoardLayer from './StashBoardLayer';
import { placeCreatedFolder, planStashAssignments } from './stashPlacement';
import { stashBoardLayout, imageOnScopeBoard, inGroupingTarget, STASH_HOLD_MS, STASH_HOLD_SLOP, parentPath } from './stashBoard';

import { type BoardPoint, type CategoryBoardGroup } from './categoryBoard';
import { restoreStashAnchor, useBoardPreferences } from './useBoardPreferences';
import { orderByMetadata, type PileOrder } from './imageAnalysis';
import { useImageAnalysis } from './useImageAnalysis';
import { useContentIndex } from './ContentIndex';
import { type ImageThumbnailCache, useThumbnails } from './imageThumbnails';
import ImageBrowser from './ImageBrowser';
import { useBrowserPanel } from './useBrowserPanel';
import { shuffled, useBrowserOrder } from './useBrowserOrder';
import { useBoardNavigation } from './useBoardNavigation';
import { useStashNavigationMotion } from './useStashNavigationMotion';
import { fitBoardView, revealBoardItem, MIN_BOARD_ZOOM } from './stashView';
import { useImageIntake, type BoardMove } from './useImageIntake';
import { useBoardReveal } from './useBoardReveal';
import BoardStarter from './BoardStarter';
import { clampBatch, randomBatch, usePreviewCount, useRootIntake } from './useRootIntake';
import { similarityCandidates, similarityReferences } from './similarityScope';
import { similarityCopy } from './similarityCopy';
import { useWorkspaceSelection } from './useWorkspaceSelection';
import { useWorkspaceActionFocus } from './useWorkspaceActionFocus';
import type { ProjectAction, RenameStash } from './useActionHistory';
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
  initialStashId?: string;
  importedImageIds?: string[];
  onAssign: (assignments: CategoryAssignment[]) => Promise<void>;
  onRememberAction: (action: ProjectAction) => void;
  undo?: UndoView;
  onCreateStash: (ids: string[], parentId: string | null, name?: string) => Promise<LibraryCategory>;
  onRenameStash: RenameStash;
  onMoveFolder: (id: string, parentId: string | null) => Promise<void>;
  onRequestFolderMove: (id: string) => void;
  onDeleteEmptyStash: (id: string) => Promise<void>;
  onPrepareStash: (id: string | null, width: number) => Promise<void>;
  onPlaceOnBoard: (moves: BoardMove[]) => BoardEdit;
  onRemoveFromBoard: (ids: string[], sourceId: string | null, sourceName: string) => void;
};

const WORLD_WIDTH = 2200;
const CARD_WIDTH = 172;

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
  projectId, projectName, clipEnabled, onSettings, images, categories, busy: projectBusy, saving, thumbnailCache, message, progress, error, onBack, onOpenImage, onAssign,
  onCreateStash, onRenameStash, onMoveFolder, onRequestFolderMove, onDeleteEmptyStash, onPrepareStash, onRememberAction, onPlaceOnBoard: saveBoardMoves, onRemoveFromBoard, canExportFolder, onExport, onBackup, initialBrowser, initialStashId, importedImageIds, undo,
}: Props) {
  const { task: folderTask, running: folderPending } = useAsyncTask();
  const busy = projectBusy || folderPending;
  const workspaceRef = React.useRef<HTMLElement>(null);
  useWorkspaceZoomGuard(workspaceRef);
  const boardRef = React.useRef<HTMLDivElement>(null);
  const boardPaneRef = React.useRef<HTMLDivElement>(null);
  const browserRef = React.useRef<HTMLElement>(null);
  const [folderDragId, setFolderDragId] = React.useState<string | null>(null);
  const [folderDropHover, setFolderDropHover] = React.useState<string | null>();
  const [folderMoveError, setFolderMoveError] = React.useState('');
  const [previewDragging, setPreviewDragging] = React.useState(false);
  const [intakeHost, setIntakeHost] = React.useState<HTMLDivElement | null>(null);
  const [randomDraft, setRandomDraft] = React.useState<{ ids: string[]; serial: number } | null>(null);
  const randomSerial = React.useRef(0);
  const navigationSceneRef = React.useRef<HTMLDivElement>(null);
  const navigationMotion = useStashNavigationMotion(boardPaneRef, navigationSceneRef, workspaceRef);
  const ghostRef = React.useRef<HTMLDivElement>(null);
  const groupPreviewRef = React.useRef<HTMLDivElement>(null);
  const dragPointerType = React.useRef('mouse');
  const dragPointerId = React.useRef(0);
  const dragSourceRef = React.useRef<EventTarget | null>(null);
  const dragPointRef = React.useRef<Point | null>(null);
  const dragDisplayPointRef = React.useRef<Point | null>(null);
  const dragAnchorRef = React.useRef<Point>({ x: .5, y: .5 });
  const browserDragSize = React.useRef(120);
  const mountedRef = React.useRef(true);
  const [preferences, setPreferences] = useBoardPreferences(projectId);
  const [browserPanel, setBrowserPanel] = useBrowserPanel(projectId, !!initialBrowser);
  const updateBrowserPanel = useStableCallback(setBrowserPanel);
  const [workspaceSize, setWorkspaceSize] = React.useState({ width: window.innerWidth, height: window.innerHeight });
  const { scopeId, setScopeId, scopeRef, cameras, zoom, setZoom, cameraCenter, setCameraCenter,
    boardViewportWidth, boardWindow, updateBoardWindow, persistCamera } = useBoardNavigation(projectId, categories,
      window.innerWidth <= 700 ? window.innerWidth : window.innerWidth - effectiveBrowserWidth(browserPanel.collapsed ? 48 : browserPanel.width, window.innerWidth), initialStashId);
  const [folderSidebar, setFolderSidebar] = useFolderSidebar(projectId, categories, scopeId);
  const [editingStashId, setEditingStashId] = React.useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = React.useState(false);
  const [contextMoveIds, setContextMoveIds] = React.useState<string[] | null>(null);
  const [renameFolderId, setRenameFolderId] = React.useState<string | null>(null);
  const [relatedRequest, setRelatedRequest] = React.useState<{ id: string; serial: number }>();
  const [previewMove, setPreviewMove] = React.useState<{ id: string; place: (destination: string | null) => Promise<boolean> }>();
  const [groupPreview, setGroupPreview] = React.useState<{ targetId: string; ready: boolean; serial: number; position: Point } | null>(null);
  const [hold] = React.useState(() => new HoldToGroup());
  const placeGroupPreview = (point: Point, size = { width: 168, height: 44 }) => {
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
  const [pulseCategoryId, setPulseCategoryId] = useTimedValue<string | null>(null, 650);
  const [dragInPile, setDragInPile] = React.useState(false);
  const [takeOutHover, setTakeOutHover] = React.useState<string | null>(null);
  const [navigation] = React.useState(() => new FolderNavigation(navigationMotion.cancel));
  React.useEffect(() => { navigation.activate(); return () => navigation.deactivate(); }, [navigation]);
  const navigationCategories = React.useRef(categories); navigationCategories.current = categories;
  const thumbnails = thumbnailCache;
  const objectUrls = thumbnails.urls;
  const { selectedId, setSelectedId, selectedIds, setSelectedIds, multiSelect, setMultiSelect, clearSelection, selectImage, dragSelection } = useWorkspaceSelection(images);
  const groupDrag = useBoardGroupDrag(boardRef);
  const movingSelection = (id: string) => groupDrag.selection(id) || dragSelection(id);
  const browserImageIds = React.useMemo(() => images.map(image => image.id), [images]);
  const { order: pileOrder, setOrder: setPileOrder, reversed: reverseOrder, setReversed: setReverseOrder,
    ids: trayOrder, setIds: setTrayOrder } = useBrowserOrder(projectId, browserImageIds);
  const [zOrder, setZOrder] = React.useState<Map<string, number>>(new Map());
  const [dragging, setDragging] = React.useState<{ id: string; anchor: Point; origin: 'board' | 'browser' | 'stash' } | null>(null);
  const focusAction = useWorkspaceActionFocus(workspaceRef, busy || saving || chooserOpen || !!dragging);
  const [hoverCategoryId, setHoverCategoryId] = React.useState<string | null>(null);
  const [similarityMethod, setSimilarityMethod] = React.useState<SimilarityMethod>(clipEnabled ? 'clip' : 'color');
  const [includeOtherStashes, setIncludeOtherStashes] = React.useState(false);
  const selectionOrigin = React.useRef<'board' | 'browser'>('board');
  const selectBrowserImage = useStableCallback((id: string, options?: { toggle?: boolean }) => {
    rootIntake.dismiss(); selectionOrigin.current = 'browser'; selectImage(id, options);
  });
  const selectBoardImage = useStableCallback((id: string, options?: { toggle?: boolean }) => {
    setRandomDraft(null); selectionOrigin.current = 'board'; selectImage(id, options);
  });
  const selectBrowserImages = useStableCallback((ids: string[]) => {
    rootIntake.dismiss(); selectionOrigin.current = 'browser'; setSelectedIds(new Set(ids)); setSelectedId(ids.at(-1) || null);
  });
  const { task: matchingTask, running: matching } = useAsyncTask();
  const [similarPreviewIds, setSimilarPreviewIds] = React.useState<string[]>([]);
  const suggestionBatches = React.useRef(new Map<string, BoardMove[][]>());
  const previewThumbnails = React.useCallback((ids: string[]) => setSimilarPreviewIds(current => current.join(',') === ids.join(',') ? current : ids), []);
  const [analysisNotice, setAnalysisNotice] = useTimedValue('', 7000);
  const contextMenu = useContextMenuController(`${projectId}:${scopeId}`, busy || saving || !!dragging || !!folderDragId || previewDragging, setAnalysisNotice);
  const imagesRef = React.useRef(images);
  imagesRef.current = images;
  const analysis = useImageAnalysis(images);
  const { metadata, progress: analysisProgress } = analysis;
  const content = useContentIndex();
  const { revision: clipRevision, search: searchContent, setInteracting: clipInteraction } = content;
  React.useEffect(() => () => clipInteraction(false), [clipInteraction]);

  const currentStash = categories.find(stash => stash.id === scopeId);
  const previousScopePath = React.useRef('');
  if (currentStash) previousScopePath.current = currentStash.name;
  const boardImages = React.useMemo(() => images.filter(image => imageOnScopeBoard(image, scopeId)), [images, scopeId]);
  const canFindSimilar = scopeId ? images.some(image => image.categoryId !== scopeId) : boardImages.length > 0 && images.filter(image => image.categoryId === null).length > 1;
  const similarCandidateIds = React.useMemo(() => similarityCandidates(images, scopeId, new Set(), includeOtherStashes).map(image => image.id).join(','), [images, scopeId, includeOtherStashes]);
  const suggestionCandidateIds = React.useMemo(() => similarityCandidates(images, scopeId, new Set(), false).map(image => image.id).join(','), [images, scopeId]);
  const allIds = React.useMemo(() => browserImageIds.join(','), [browserImageIds]);
  const selectedImages = React.useMemo(() => images.filter(image => selectedIds.has(image.id)), [images, selectedIds]);
  const missingFolderPositions = boardImages.filter(image => image.boardX === undefined || image.boardY === undefined).map(image => image.id).join(',');
  React.useEffect(() => {
    if (missingFolderPositions) void onPrepareStash(scopeId, boardViewportWidth).catch(cause => setAnalysisNotice(String(cause)));
  }, [scopeId, missingFolderPositions]);
  const categoryById = React.useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  const imageById = React.useMemo(() => new Map(images.map((image) => [image.id, image])), [images]);
  const imageColors = React.useMemo(() => new Map(images.flatMap(image => {
    const name = image.categoryId && image.categoryId !== scopeId ? categoryById.get(image.categoryId) : undefined;
    return name ? [[image.id, categoryColor(name)] as [string, string]] : [];
  })), [images, categoryById, scopeId]);

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
    if (missingFolderPositions) return;
    const missing = categoryLayout.groups.filter(group => !preferences.anchors[group.id]);
    if (!missing.length) return;
    setPreferences(current => ({ ...current, anchors: { ...Object.fromEntries(missing.map(group => [group.id, { x: group.x, y: group.y }])), ...current.anchors } }));
  }, [categoryLayout.groups, preferences.anchors, missingFolderPositions]);
  const [framedFolders] = React.useState(() => new Set([...Object.keys(cameras.current), ...(images.some(image => image.rootOnBoard === false) ? ['root'] : [])]));
  React.useLayoutEffect(() => {
    const key = scopeId || 'root', pane = boardPaneRef.current;
    if (!pane || missingFolderPositions || !boardCards.length || framedFolders.has(key)) return;
    framedFolders.add(key);
    if (boardCards.length <= 24 && categoryLayout.groups.length) {
      const view = fitBoardView([...categoryLayout.groups, ...boardCards.map(card => ({ ...card, width: CARD_WIDTH, height: CARD_WIDTH }))], pane.clientWidth, pane.clientHeight);
      setZoom(view.zoom); setCameraCenter({ x: view.x, y: view.y }); return;
    }
    const width = pane.clientWidth / zoom, height = pane.clientHeight / zoom;
    const first = boardCards.reduce((a, b) => b.y < a.y || b.y === a.y && b.x < a.x ? b : a);
    const minX = Math.min(...boardCards.map(card => card.x)), maxX = Math.max(...boardCards.map(card => card.x + CARD_WIDTH));
    const minY = Math.min(...boardCards.map(card => card.y)), maxY = Math.max(...boardCards.map(card => card.y + CARD_WIDTH));
    const fits = maxX - minX <= width - 64 && maxY - minY <= height - 64;
    setCameraCenter(fits ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
      : { x: first.x + width / 2 - 24, y: first.y + height / 2 - 24 });
  }, [scopeId, missingFolderPositions, boardCards]);
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
  const suggestionPositions = React.useMemo(() => new Map(boardCards.map(card => [card.id, { x: card.x, y: card.y }])), [boardCards]);
  const rootIntake = useRootIntake(projectId, images.some(image => imageOnScopeBoard(image, null)) || categories.some(folder => !folder.name.includes('/')));
  const relatedCount = usePreviewCount(projectId, 'related', 12);
  const pendingRootIds = React.useMemo(() => images.filter(image => image.categoryId === null && image.rootOnBoard === false).map(image => image.id), [images]);
  const pendingRootKey = pendingRootIds.join(',');
  const starterSample = React.useMemo(() => randomBatch(pendingRootIds, 24), [pendingRootKey]);
  const showStarter = scopeId === null && !browserPanel.expanded && !rootIntake.seen && !boardCards.length && !categoryLayout.groups.length && pendingRootIds.length > 0;
  const revealImages = useBoardReveal({ scopeId, cards: boardCards, pane: boardPaneRef,
    onExpand: expanded => setBrowserPanel(current => ({ ...current, expanded })),
    onFrame: view => { setZoom(view.zoom); setCameraCenter({ x: view.x, y: view.y }); } });
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
  React.useEffect(() => () => hold.cancel(), [hold]);
  React.useEffect(() => { if (scopeId && !categories.some(stash => stash.id === scopeId)) {
    navigation.cancel();
    const parent = categories.find(stash => stash.name.toLocaleLowerCase() === parentPath(previousScopePath.current).toLocaleLowerCase());
    matchingTask.cancel();
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
  const { similarityIds, contentIds, preparingOrder } = usePreparedImageOrder(pileOrder, allIds, imagesRef, analysis, content, clipEnabled, !!dragging, setAnalysisNotice);

  React.useEffect(() => { setAnalysisNotice(''); }, [message]);

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
    ...(showStarter ? starterSample.slice(0, 3) : []),
    ...categoryLayout.groups.filter(group => group.x + group.width >= boardWindow.left && group.x <= boardWindow.right && group.y + group.height >= boardWindow.top && group.y <= boardWindow.bottom).flatMap(group => group.previewIds)], true, false);
  const intake = useImageIntake({ images, scopeId, zoom, bottomInset: scopeId === null ? 96 : 0, board: boardRef, pane: boardPaneRef, cards: boardCards, groups: categoryLayout.groups, onPlace: onPlaceOnBoard });
  const onBoardIds = React.useMemo(() => new Set(boardImages.map(image => image.id)), [boardImages]);

  const resetGroupPreview = () => {
    boardRef.current?.querySelectorAll<HTMLElement>('[data-group-preview]').forEach(node => { node.style.removeProperty('translate'); node.removeAttribute('data-group-preview'); });
    setFolderDragId(null); setFolderDropHover(undefined);
    clipInteraction(false);
  };
  const folderDropAt = (sourceId: string, point: Point): string | null | undefined => {
    const source = categories.find(item => item.id === sourceId);
    if (!source) return;
    for (const element of document.elementsFromPoint(point.x, point.y)) {
      if (!workspaceRef.current?.contains(element)) continue;
      const breadcrumb = element.closest<HTMLElement>('[data-folder-destination]');
      const id = breadcrumb?.dataset.folderDestination || element.closest<HTMLElement>('[data-stash-drop-id]')?.dataset.stashDropId;
      if (!id || id === sourceId) continue;
      if (id === 'root') return null;
      const destination = categories.find(item => item.id === id);
      if (destination && !folderMoveProblem(source, destination)) return id;
    }
  };
  const requestFolderMove = (id: string) => {
    setFolderMoveError('');
    onRequestFolderMove(id);
  };
  const previewGroupMove = (group: CategoryBoardGroup, delta: BoardPoint, point?: Point) => {
    setFolderMoveError('');
    clipInteraction(true);
    setFolderDragId(group.id);
    setFolderDropHover(point ? folderDropAt(group.id, point) : undefined);
    const ids = new Set(group.ids);
    boardRef.current?.querySelectorAll<HTMLElement>('.card--sort, [data-board-group-id]').forEach(node => {
      if (node.dataset.boardGroupId !== group.id && !ids.has((node.dataset.testid || '').replace('card-', ''))) return;
      node.style.translate = `${delta.x}px ${delta.y}px`; node.dataset.groupPreview = 'true';
    });
  };
  const moveCategoryGroup = (group: CategoryBoardGroup, delta: BoardPoint, point?: Point) => {
    const destination = point ? folderDropAt(group.id, point) : undefined;
    if (destination !== undefined) {
      resetGroupPreview();
      void onMoveFolder(group.id, destination).catch(cause => setFolderMoveError(cause instanceof Error ? cause.message : 'Could not move folder.'));
      return;
    }
    if (!delta.x && !delta.y) { resetGroupPreview(); return; }
    // A rejected hierarchy drop must not become an accidental board rearrangement.
    if (point && document.elementsFromPoint(point.x, point.y).some(element => element.closest('.folder-sidebar'))) { resetGroupPreview(); return; }
    const previous = { x: group.x, y: group.y };
    onRememberAction({ projectId, kind: 'layout', label: 'Undo folder move', message: `Moved ${group.name.split('/').at(-1)}.`,
      detail: 'Undo restores the folder’s position. Its contents stay the same.', restored: 'Previous folder position restored.',
      restore: async () => { restoreStashAnchor(projectId, group.id, previous); } });
    flushSync(() => setPreferences(current => ({ ...current, anchors: { ...current.anchors,
      [group.id]: { x: Math.max(8, Math.round(group.x + delta.x)), y: Math.max(8, Math.round(group.y + delta.y)) } } })));
    resetGroupPreview();
  };
  const navigateStash = async (id: string | null, fromDrop = false, reveal?: Point) => {
    if (!fromDrop && (busy || saving || dragging || folderTask.running)) return;
    if (id && !categories.some(stash => stash.id === id)) return;
    if (id === scopeRef.current) { navigation.cancel(); return; }
    const previous = categories.find(stash => stash.id === scopeRef.current);
    const target = categories.find(stash => stash.id === id);
    const returning = !id || !!previous && !!target && previous.name.startsWith(target.name + '/');
    const direction = returning ? 'out' : 'in';
    const returnId = returning ? categories.find(stash =>
      (!target || stash.name.startsWith(target.name + '/')) &&
      (!target ? !stash.name.includes('/') : parentPath(stash.name) === target.name) &&
      (previous?.id === stash.id || previous?.name.startsWith(stash.name + '/')))?.id : undefined;
    const keyboard = navigationMotion.keyboard.current || document.activeElement?.matches(':focus-visible');
    await navigation.run({
      prepare: async () => { if (id) await onPrepareStash(id, boardViewportWidth); },
      leave: () => navigationMotion.leave(direction, id || undefined),
      valid: () => !id || navigationCategories.current.some(stash => stash.id === id),
      commit: () => {
        // Commit between the two halves of the 280 ms transition. Keep the browser
        // and menu outside the animated viewport, and let Board restore its camera.
        flushSync(() => {
          matchingTask.cancel(); setAnalysisNotice('');
          cancelGrouping(); clearSelection(); setChooserOpen(false); setEditingStashId(null);
          setScopeId(id); scopeRef.current = id; setCameraCenter(undefined); setIncludeOtherStashes(false);
          const saved = cameras.current[id || 'root'];
          setZoom(saved && saved.zoom >= MIN_BOARD_ZOOM && saved.zoom <= 2 ? saved.zoom : 1);
          if (returnId && !reveal && boardPaneRef.current) {
            const scale = saved?.zoom || 1;
            const tile = stashBoardLayout(images, categories, id, boardViewportWidth / scale, preferences.anchors).find(stash => stash.id === returnId);
            if (tile) {
              const view = revealBoardItem(tile, saved || { x: tile.x + 100, y: tile.y + 91, zoom: scale }, boardPaneRef.current.clientWidth, boardPaneRef.current.clientHeight);
              cameras.current[id || 'root'] = view; setZoom(view.zoom); setCameraCenter({ x: view.x, y: view.y });
            }
          }
          if (reveal) {
            const scale = saved && saved.zoom >= MIN_BOARD_ZOOM && saved.zoom <= 2 ? saved.zoom : 1, width = boardViewportWidth / scale, height = (boardPaneRef.current?.clientHeight || workspaceSize.height - 56) / scale;
            const center = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : { x: reveal.x + width / 2, y: reveal.y + height / 2 };
            const point = { x: Math.max(reveal.x + CARD_WIDTH + 12 - width / 2, Math.min(center.x, reveal.x - 12 + width / 2)),
              y: Math.max(reveal.y + CARD_WIDTH + 12 - height / 2, Math.min(center.y, reveal.y - 12 + height / 2)) };
            cameras.current[id || 'root'] = { ...point, zoom: scale }; setCameraCenter(point);
          }
        });
        persistCamera();
      },
      enter: () => navigationMotion.enter(direction, returnId),
      focus: () => {
        if (!keyboard) return;
        const focus = navigationMotion.tile(returnId)?.querySelector<HTMLElement>('.stash-tile__open') ||
          workspaceRef.current?.querySelector<HTMLElement>('[data-stash-parent], button[aria-label="Choose folder"]');
        focus?.focus({ preventScroll: true });
      },
      error: cause => setAnalysisNotice(cause instanceof Error ? cause.message : 'Could not open folder.'),
    });
  };
  const createStash = async (ids: string[], point?: Point, label?: string, parentId: string | null = scopeId) => {
    if (folderTask.running || busy || saving) return;
    const task = folderTask.begin(); if (!task) return;
    // The pending category briefly renders at its fallback location during the
    // store refresh. Do not migrate/frame that intermediate layout over the
    // user's camera before we apply its actual visible anchor.
    appearanceFramed.current = true; framedFolders.add(scopeId || 'root');
    try { localStorage.setItem(`folder-sort-board-appearance:${projectId}`, '2'); } catch { /* Keep this mount's guard. */ }
    try {
      const stash = await onCreateStash([...new Set(ids)], parentId, label);
      if (parentId !== scopeId) {
        if (parentId) setFolderSidebar(previous => ({ ...previous, expanded: [...new Set([...previous.expanded, parentId])] }));
        return;
      }
      flushSync(() => setBrowserPanel(current => ({ ...current, expanded: false })));
      // Commit the panel change, then let the scroller's resize/layout effects
      // settle before taking world coordinates from its canvas rectangle.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!mountedRef.current || scopeRef.current !== scopeId) return;
      const pane = boardPaneRef.current?.getBoundingClientRect(), canvas = boardRef.current?.querySelector('[data-testid="board-canvas"]')?.getBoundingClientRect();
      const viewport = pane && canvas ? { x: (pane.left + 16 - canvas.left) / zoom, y: (pane.top + 16 - canvas.top) / zoom,
        width: (pane.width - 32) / zoom, height: (pane.height - 32) / zoom } : undefined;
      const selectedCards = ids.flatMap(id => boardCardById.get(id) ? [boardCardById.get(id)!] : []);
      const anchor = point || (selectedCards.length ? { x: Math.min(...selectedCards.map(card => card.x)), y: Math.min(...selectedCards.map(card => card.y)) } : visibleBoardCenter());
      const { position, cameraCenter } = placeCreatedFolder({ folderId: stash.id, anchor,
        explicitPoint: !!point, fromBrowser: selectionOrigin.current === 'browser', viewport,
        cards: boardCards, selectedIds: ids, groups: categoryLayout.groups });
      flushSync(() => {
        setPreferences(current => ({ ...current, anchors: { ...current.anchors, [stash.id]: position } }));
        clearSelection(); setEditingStashId(stash.id); setPulseCategoryId(stash.id);
        if (cameraCenter) setCameraCenter(cameraCenter);
      });
    } catch (cause) { setAnalysisNotice(cause instanceof Error ? cause.message : 'Could not create folder.'); }
    finally { folderTask.complete(task); }
  };
  const deleteEmptyStash = async (id: string) => {
    if (busy || saving || folderTask.running) return;
    const task = folderTask.begin(); if (!task) return;
    try {
      await onDeleteEmptyStash(id);
      setEditingStashId(null);
      focusAction('undo');
    } finally { folderTask.complete(task); }
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
    const sidebar = document.elementsFromPoint(point.x, point.y).map(element => element.closest<HTMLElement>('[data-sidebar-folder]')).find(Boolean)?.dataset.sidebarFolder;
    if (sidebar && sidebar !== 'root') return sidebar;
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
    const excluded = new Set(movingSelection(sourceId));
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
  const cancelGrouping = () => { hold.cancel(); setGroupPreview(null); };
  const prepareGrouping = (id: string, point: Point) => {
    const targetId = !busy && !saving ? imageTargetAt(point, id) : null;
    hold.prepare(targetId, point, STASH_HOLD_SLOP, STASH_HOLD_MS,
      () => !!dragPointRef.current && imageTargetAt(dragPointRef.current, id) === targetId,
      current => setGroupPreview(current ? { targetId: current.targetId, ready: current.ready, serial: current.serial, position: placeGroupPreview(current.point) } : null));
  };
  const boardPointAt = (point: Point, anchor: Point = { x: .5, y: .5 }, round = true): Point | null => {
    if (!contains(boardPaneRef.current?.getBoundingClientRect(), point)) return null;
    const canvas = boardRef.current?.querySelector<HTMLElement>('[data-testid="board-canvas"]');
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return null;
    const x = Math.max(0, (point.x - rect.left) / zoom - CARD_WIDTH * anchor.x);
    const y = Math.max(0, (point.y - rect.top) / zoom - CARD_WIDTH * anchor.y);
    return round ? { x: Math.round(x), y: Math.round(y) } : { x, y };
  };
  const previewHover = useStableCallback((point: Point | null) => {
    setPreviewDragging(!!point);
    setHoverCategoryId(point ? categoryAt(point) : null);
    setTakeOutHover(point ? document.elementsFromPoint(point.x, point.y).map(element => element.closest<HTMLElement>('[data-folder-destination]')).find(Boolean)?.dataset.folderDestination || null : null);
    clipInteraction(!!point);
  });
  const placePreviewInto = useStableCallback((id: string, destination: string | null, position?: Point): BoardEdit => {
    if (busy || saving) return { status: 'unchanged' };
    const image = imagesRef.current.find(item => item.id === id);
    if (!image || image.categoryId !== null || imageOnScopeBoard(image, scopeRef.current) || destination && !categories.some(item => item.id === destination)) return { status: 'unchanged' };
    if (!position && imageOnScopeBoard(image, destination)) return { status: 'unchanged' };
    const planned = position && destination === scopeRef.current ? position :
      planStashAssignments(imagesRef.current, categories, [{ id, categoryId: destination }], boardViewportWidth, preferences.anchors)[0].boardPosition;
    if (!planned) return { status: 'unchanged' };
    const move = { id, ...planned, boardScope: destination };
    const edit = saveBoardMoves([move]);
    if (edit.status === 'accepted') {
      if (destination === scopeRef.current) { intake.settle([move]); raiseIncoming([id]); }
      else if (destination) setPulseCategoryId(destination);
    }
    return edit;
  });
  const placePreview = useStableCallback((id: string, point: Point, anchor: Point): BoardEdit => {
    const elements = document.elementsFromPoint(point.x, point.y).filter(element => !element.closest('[data-preview-drag-ghost]'));
    if (elements[0]?.closest('.board-suggestion, .board-suggestions, .staging-preview, .staging-intake, .image-browser')) return { status: 'unchanged' };
    const crumb = elements.map(element => element.closest<HTMLElement>('[data-folder-destination]')).find(Boolean)?.dataset.folderDestination;
    if (!crumb && elements.some(element => element.closest('.folder-sidebar'))) return { status: 'unchanged' };
    const folder = categoryAt(point), position = boardPointAt(point, anchor);
    if (!crumb && !folder && (!position || elements[0]?.closest('button, input, select, details, .staging-preview, .board-suggestions, .staging-intake'))) return { status: 'unchanged' };
    const destination = crumb ? crumb === 'root' ? null : crumb : folder || scopeRef.current;
    return placePreviewInto(id, destination, !folder && !crumb ? position || undefined : undefined);
  });
  const visibleBoardCenter = (): Point => {
    const rect = boardPaneRef.current?.getBoundingClientRect();
    const point = rect && boardPointAt({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    return point || { x: initialCenter.x - CARD_WIDTH / 2, y: initialCenter.y - CARD_WIDTH / 2 };
  };
  const dragPreviewSize = (id: string, point: Point): number => {
    if (contains(boardPaneRef.current?.getBoundingClientRect(), point)) return CARD_WIDTH * zoom;
    if (contains(browserRef.current?.getBoundingClientRect(), point)) return browserDragSize.current;
    const image = imageById.get(id);
    return image && imageOnScopeBoard(image, scopeId) ? CARD_WIDTH * zoom : Number(browserRef.current?.dataset.thumbnailSize) || 96;
  };
  const previewDragAt = (point: Point, anchor: Point): Point => {
    const boardPoint = boardPointAt(point, anchor, false);
    const projected = boardPoint && groupDrag.preview(boardPoint);
    const canvas = projected && boardRef.current?.querySelector('[data-testid="board-canvas"]')?.getBoundingClientRect();
    return projected && canvas ? { x: canvas.left + (projected.x + CARD_WIDTH * anchor.x) * zoom,
      y: canvas.top + (projected.y + CARD_WIDTH * anchor.y) * zoom } : point;
  };
  const onDragStart = useStableCallback((id: string, point: Point, anchor: Point, origin: 'board' | 'browser' | 'stash' = 'board') => {
    clipInteraction(true);
    groupDrag.start(id, dragSelection(id), boardCards, origin === 'board');
    dragPointRef.current = point;
    dragAnchorRef.current = anchor;
    dragDisplayPointRef.current = previewDragAt(point, anchor);
    setDragging({ id, anchor, origin });
    setDragInPile(false); setTakeOutHover(null);
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
    const displayPoint = previewDragAt(point, dragAnchorRef.current);
    dragDisplayPointRef.current = displayPoint;
    if (ghostRef.current) {
      const size = dragPreviewSize(id, point);
      ghostRef.current.style.left = `${displayPoint.x}px`;
      ghostRef.current.style.top = `${displayPoint.y}px`;
      ghostRef.current.style.width = `${size}px`;
      ghostRef.current.style.height = `${size}px`;
    }
    const targetId = categoryAt(point);
    setTakeOutHover(document.elementsFromPoint(point.x, point.y).map(element => element.closest<HTMLElement>('[data-folder-destination]')).find(Boolean)?.dataset.folderDestination || null);
    setDragInPile(contains(browserRef.current?.getBoundingClientRect(), point));
    setHoverCategoryId(targetId);
    if (targetId) cancelGrouping(); else prepareGrouping(id, point);
  });
  const onDragEnd = useStableCallback(() => { groupDrag.end(); cancelGrouping(); resetGroupPreview(); clipInteraction(false); dragPointRef.current = null; dragDisplayPointRef.current = null; dragSourceRef.current = null; setDragging(null); setHoverCategoryId(null); setDragInPile(false); setTakeOutHover(null); });
  const bringToFront = useStableCallback((id: string) => setZOrder((current) => new Map(current).set(id, Math.max(0, ...current.values()) + images.length + 1)));
  const changePileOrder = (order: PileOrder) => {
    if (order === 'semantic' && !clipEnabled) return;
    setPileOrder(order); setReverseOrder(false); setAnalysisNotice('');
    if (order === 'semantic') setSimilarityMethod('clip');
  };
  const reversePileOrder = () => setReverseOrder(value => !value);
  const shufflePile = () => { changePileOrder('random'); setTrayOrder(shuffled(images.map(image => image.id))); };
  const raiseIncoming = (ids: string[]) => setZOrder(current => {
    let front = Math.max(images.length, ...current.values());
    const next = new Map(current);
    ids.forEach(id => next.set(id, ++front));
    return next;
  });
  const closeRandomDraft = (restoreFocus = false) => {
    setRandomDraft(null);
    if (restoreFocus) focusAction('intake');
  };
  React.useEffect(() => { setRandomDraft(null); }, [scopeId]);
  const previewRandomImages = (ids: string[]) => {
    if (busy || saving || scopeId !== null) return;
    rootIntake.dismiss(); clearSelection();
    setRandomDraft({ ids, serial: ++randomSerial.current });
  };
  const acceptRandomPreview = (moves: BoardMove[]): BoardEdit => {
    if (busy || saving || scopeId !== null || !moves.length) return { status: 'unchanged' };
    const current = new Map(imagesRef.current.map(image => [image.id, image]));
    if (new Set(moves.map(move => move.id)).size !== moves.length || moves.some(move => {
      const image = current.get(move.id); return !image || image.categoryId !== null || image.rootOnBoard !== false;
    })) return { status: 'unchanged' };
    const edit = onPlaceOnBoard(moves);
    if (edit.status !== 'accepted') return edit;
    framedFolders.add('root'); intake.settle(moves); raiseIncoming(moves.map(move => move.id));
    setSelectedIds(new Set(moves.map(move => move.id))); setSelectedId(moves.at(-1)!.id);
    setAnalysisNotice(`Added ${moves.length} ${moves.length === 1 ? 'image' : 'images'} to Staging.`);
    return edit;
  };
  const addMarkedToBoard = (ids: string[], origin?: DOMRect) => {
    if (busy || saving) return;
    framedFolders.add(scopeId || 'root');
    const incoming = ids.filter(id => { const image = imageById.get(id); return image && !imageOnScopeBoard(image, scopeId); });
    const added = intake.add(ids, origin);
    if (added) {
      raiseIncoming(incoming);
      rootIntake.dismiss();
      focusAction('create');
      setBrowserPanel(current => ({ ...current, expanded: false }));
      setSelectedIds(new Set(ids)); setSelectedId(ids.at(-1) || null);
      setAnalysisNotice(`${scopeId === null && ids.every(id => imageById.get(id)?.categoryId === null) ? 'Added' : 'Moved'} ${added.toLocaleString()} ${added === 1 ? 'image' : 'images'} ${scopeId === null ? 'to Staging' : `into ${currentStash?.name.split('/').at(-1)}`}.`);
    }
  };
  const addRandomImages = (origin: DOMRect, candidateIds?: string[]) => {
    if (busy || saving || scopeId !== null) return;
    const pending = new Set(imagesRef.current.filter(image => image.categoryId === null && image.rootOnBoard === false).map(image => image.id));
    const eligible = (candidateIds || starterSample).filter(id => pending.has(id));
    if (!eligible.length) return;
    const count = clampBatch(rootIntake.count, eligible.length);
    addMarkedToBoard(candidateIds ? randomBatch(eligible, count) : eligible.slice(0, count), origin);
    if (candidateIds) focusAction('intake');
  };

  const assignCategory = async (ids: string[], categoryId: string | null, name?: string, options?: { point?: Point }) => {
    if (folderTask.running || busy || saving || !ids.length) return;
    const latest = new Map(imagesRef.current.map(image => [image.id, image]));
    const selected = [...new Set(ids)].flatMap(id => { const image = latest.get(id); return image ? [image] : []; });
    if (!selected.length) return;
    const changes = planStashAssignments(imagesRef.current, categories, selected.map((image, index) => ({ id: image.id, categoryId,
      ...(options?.point ? { boardPosition: { x: options.point.x + index * 24, y: options.point.y + index * 24 } } : {}) })),
      boardViewportWidth, preferences.anchors, true);
    if (!categoryId && changes.every(change => latest.get(change.id)?.categoryId === null && !change.boardPosition)) return;
    const task = folderTask.begin(); if (!task) return;
    setPulseCategoryId(null);
    try {
      await onAssign(changes);
      setAnalysisNotice(`${selected.length === 1 ? 'Image' : `${selected.length.toLocaleString()} images`} ${categoryId ? `moved into ${name || categoryById.get(categoryId) || 'folder'}` : 'moved to Staging'}.`);
      if (categoryId) {
        setPulseCategoryId(categoryId);
      }
      clearSelection(); setChooserOpen(false);
      return changes;
    } finally { folderTask.complete(task); }
  };
  const assignDropped = (id: string, categoryId: string) => {
    void assignCategory(movingSelection(id), categoryId === 'unassigned' ? null : categoryId).catch(() => {});
  };
  React.useEffect(() => {
    if (clipEnabled) return;
    matchingTask.cancel(); setSimilarPreviewIds([]);
    setSimilarityMethod(method => method === 'clip' ? 'color' : method);
    setPileOrder(order => order === 'semantic' ? 'random' : order);
  }, [clipEnabled]);
  const changeSimilarityMethod = (method: SimilarityMethod) => {
    if (method === 'clip' && !clipEnabled) return;
    setSimilarityMethod(method);
  };
  const { findSimilarImages, acceptSimilarPreview, addSimilar } = useWorkspaceMatching({ matchingTask, busy, saving, scopeId, scopeRef, imagesRef, clipEnabled, similarityMethod, includeOtherStashes,
    analysis, content, boardRef, boardPaneRef, zoom, worldHeight, categoryLayout, currentStash, framedFolders, intake,
    setAnalysisNotice, setSelectedIds, setSelectedId, setZoom, setCameraCenter, raiseIncoming, onPlaceOnBoard, addMarkedToBoard, revealImages });

  const moveToParent = (id: string, destination: string | null) => {
    void assignCategory(movingSelection(id), destination).then(changes => {
      if (changes?.length) return navigateStash(destination, true, changes[0].boardPosition);
    }).catch(() => {});
  };
  const dropDecision = (id: string, source: ImageDragSource, point?: Point): ImageDrop => {
    if (!point) return { kind: 'reject' };
    const sidebarTarget = document.elementsFromPoint(point.x, point.y).map(element => element.closest<HTMLElement>('[data-sidebar-folder]')).find(Boolean)?.dataset.sidebarFolder;
    if (sidebarTarget) return sidebarTarget === 'root' ? { kind: 'folder', folderId: 'unassigned' } : { kind: 'folder', folderId: sidebarTarget };
    if (document.elementsFromPoint(point.x, point.y).some(element => element.closest('.folder-sidebar'))) return { kind: 'reject' };
    const parent = document.elementsFromPoint(point.x, point.y).map(element => element.closest<HTMLElement>('[data-stash-parent]')).find(Boolean);
    const current = hold.current;
    const groupingImageId = current?.ready && !busy && !saving && imageTargetAt(point, id) === current.targetId ? current.targetId : undefined;
    return resolveImageDrop({ source, staging: scopeId === null,
      parent: parent ? { folderId: parent.dataset.stashParent === 'root' ? null : parent.dataset.stashParent! } : undefined,
      groupingImageId, folderId: categoryAt(point), overBrowser: contains(browserRef.current?.getBoundingClientRect(), point),
      boardPoint: boardPointAt(point, dragAnchorRef.current) });
  };
  const applyDropTarget = (id: string, drop: Exclude<ImageDrop, { kind: 'place' }>) => {
    switch (drop.kind) {
      case 'parent': moveToParent(id, drop.folderId); break;
      case 'group': {
        const ids = [...new Set([drop.imageId, ...movingSelection(id)])];
        const target = boardCardById.get(drop.imageId);
        cancelGrouping(); void createStash(ids, target); break;
      }
      case 'folder': assignDropped(id, drop.folderId); break;
      case 'waiting': removeFromBoard(movingSelection(id)); break;
      case 'reject': break;
    }
  };
  const sidebarFolderDrag = useStableCallback((id: string | null, point?: Point) => {
    if (!id) { resetGroupPreview(); return; }
    setFolderDragId(id); setFolderMoveError(''); clipInteraction(true);
    setFolderDropHover(point ? folderDropAt(id, point) : undefined);
  });
  const dropSidebarFolder = useStableCallback((id: string, point: Point) => {
    const row = folderDropAt(id, point);
    const inSidebar = document.elementsFromPoint(point.x, point.y).some(element => element.closest('.folder-sidebar'));
    const destination = row !== undefined ? row : !inSidebar && boardPointAt(point) ? scopeRef.current : undefined;
    resetGroupPreview();
    if (destination === undefined || busy || saving) return;
    void onMoveFolder(id, destination).catch(cause => setFolderMoveError(cause instanceof Error ? cause.message : 'Could not move folder.'));
  });
  const removalLabel = scopeId === null ? 'Remove from staging' : `Remove from “${currentStash?.name.split('/').at(-1)}”`;
  const removeFromBoard = useStableCallback((ids: string[]) => {
    if (busy || saving) return;
    const members = ids.filter(id => { const image = imageById.get(id); return image && imageOnScopeBoard(image, scopeId); });
    if (!members.length) return;
    onRemoveFromBoard(members, scopeId, currentStash?.name || 'Staging'); clearSelection(); rootIntake.dismiss();
    setAnalysisNotice(`${members.length.toLocaleString()} ${members.length === 1 ? 'image' : 'images'} returned to the waiting queue.`);
    focusAction('undo');
  });
  const onStashImageDrop = (id: string, sourceId: string, point: Point) => {
    const drop = dropDecision(id, { kind: 'folder-preview', folderId: sourceId }, point);
    if (drop.kind === 'place') void assignCategory(movingSelection(id), scopeId, undefined, { point: drop.point }).catch(() => {});
    else applyDropTarget(id, drop);
  };

  const onBoardMoveEnd = useStableCallback((id: string, x: number, y: number, _dropPoint?: Point, screenPoint?: Point): boolean => {
    const move = (point: Point) => {
      const projected = groupDrag.project(point);
      point = projected || point;
      const origin = boardCardById.get(id);
      const ids = movingSelection(id).filter(selectedId => screenPoint || boardCardById.has(selectedId));
      const moves = ids.map((selectedId, index) => {
        const card = boardCardById.get(selectedId);
        return { id: selectedId, x: Math.max(0, point.x + (card && origin ? card.x - origin.x : index * 24)), y: Math.max(0, point.y + (card && origin ? card.y - origin.y : index * 24)) };
      });
      // Commit while companion cards still use immediate Motion positions.
      // Clearing their temporary translate then reveals exactly the dropped
      // layout, rather than starting a second spring from the old positions.
      if (projected) flushSync(() => onPlaceOnBoard(moves));
      else onPlaceOnBoard(moves);
    };
    const drop = screenPoint ? dropDecision(id, { kind: 'board' }, screenPoint) : { kind: 'place' as const, point: { x, y } };
    if (drop.kind === 'place') { move(drop.point); return true; }
    applyDropTarget(id, drop); return false;
  });
  const onBrowserMoveEnd = useStableCallback((id: string, _x: number, _y: number, _dropPoint?: Point, screenPoint?: Point): boolean => {
    const drop = dropDecision(id, { kind: 'browser' }, screenPoint);
    if (drop.kind === 'place') onPlaceOnBoard(movingSelection(id).map((id, index) => ({ id, x: drop.point.x + index * 24, y: drop.point.y + index * 24 })));
    else applyDropTarget(id, drop);
    // Browser thumbnails keep their slots, including after a successful add.
    return false;
  });

  const openBoardImage = useStableCallback((id: string) => { const image = imageById.get(id); if (image) onOpenImage(image, { ids: boardImages.map(image => image.id), parentId: scopeId }); });
  useThumbnailUrls(thumbnails, dragging ? [dragging.id] : []);
  const overlayImage = dragging ? imageById.get(dragging.id) : undefined;
  const overlayPoint = dragDisplayPointRef.current;
  const overlaySize = dragging && dragPointRef.current ? dragPreviewSize(dragging.id, dragPointRef.current) : 0;
  const analysisStatus = analysisProgress.running ? `Analyzing images… ${analysisProgress.done} / ${analysisProgress.total}` :
    preparingOrder ? 'Preparing image order…' : matching ? 'Finding similar images…' : '';

  const visibleGroups = categoryLayout.groups.filter(group => group.x + group.width >= boardWindow.left && group.x <= boardWindow.right && group.y + group.height >= boardWindow.top && group.y <= boardWindow.bottom);
  const breadcrumbs = currentStash ? currentStash.name.split('/').map((_, index, parts) => categories.find(stash => stash.name.toLocaleLowerCase() === parts.slice(0, index + 1).join('/').toLocaleLowerCase())).filter((stash): stash is LibraryCategory => !!stash) : [];
  const parentStash = currentStash ? categories.find(stash => stash.name.toLocaleLowerCase() === parentPath(currentStash.name).toLocaleLowerCase()) : undefined;
  const groupingCount = dragging && groupPreview ? new Set([...movingSelection(dragging.id), groupPreview.targetId]).size : 0;
  const fitBoard = () => {
    const pane = boardPaneRef.current;
    if (!pane) return;
    const view = fitBoardView([...boardCards.map(card => ({ ...card, width: CARD_WIDTH, height: CARD_WIDTH })), ...categoryLayout.groups], pane.clientWidth, pane.clientHeight, scopeId === null ? 64 : 0);
    setZoom(view.zoom); setCameraCenter({ x: view.x, y: view.y });
    cameras.current[scopeId || 'root'] = view; persistCamera();
  };
  const imageExport = useBoardImageExport(projectName, busy, scope => {
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
    return { scope, view, background: scopeId === null ? 'staging' as const : 'folder' as const, mode: 'stashes' as const, cards: [...boardCards, ...previewCards], groups: exportGroups,
 };
  });
  const { save: saveBoardImage, status: exportStatus, notice: exportNotice, error: exportError } = imageExport;

  const similarityControls = <div className="workspace-similarity">
    <div className="workspace-similarity-reference" aria-label="Reference images">{similarityReferences(images, scopeId).slice(0, 5).map(image => <img key={image.id} src={objectUrls.get(image.id)} alt={image.path} />)}</div>
    <div className="sorting-workspace__similarity-tools">
      <select aria-label="Similarity method" value={similarityMethod} disabled={matching} onChange={event => changeSimilarityMethod(event.target.value as SimilarityMethod)}>
        {clipEnabled && <option value="clip">{similarityCopy.clip.method}</option>}<option value="color">{similarityCopy.color.method}</option>
      </select>
      <button type="button" disabled={!boardImages.length || !canFindSimilar || !similarCandidateIds || busy || matching} onClick={() => void addSimilar()}><ScanSearch size={17} />{scopeId ? 'Move matches here' : pendingRootIds.length ? 'Add matches' : 'Find similar'}</button>
    </div>
    {scopeId && <label><input type="checkbox" checked={includeOtherStashes} onChange={event => setIncludeOtherStashes(event.target.checked)} />Include other folders</label>}
    {scopeId && includeOtherStashes && <p>Matches will move from their current folders into {currentStash?.name.split('/').at(-1)}.</p>}
    {analysisProgress.failed > 0 && <p>{analysisProgress.failed} previews unavailable</p>}
  </div>;

  const folderActions = (id: string): ContextAction[] => {
    const folder = categories.find(item => item.id === id);
    if (!folder) return [];
    const empty = emptyStashIds(images, categories).has(id);
    return [
      { id: 'open', label: 'Open folder', run: () => navigateStash(id) },
      { id: 'rename', label: 'Rename folder…', run: () => setRenameFolderId(id) },
      { id: 'move', label: 'Move folder…', run: () => requestFolderMove(id) },
      { id: 'new', label: 'New subfolder', run: () => createStash([], undefined, undefined, id) },
      { id: 'delete', label: 'Delete empty folder', separator: true, disabled: !empty,
        description: empty ? undefined : 'Remove its images and subfolders first.', run: () => deleteEmptyStash(id) },
    ];
  };
  const imageContext = (event: ContextTrigger, id: string, source: 'board' | 'browser', displayedIds: string[]) => {
    if (nativeContextTarget(event)) return false;
    const image = imageById.get(id); if (!image) return false;
    const ids = selectedIds.has(id) ? [...selectedIds] : [id];
    const targets = ids.flatMap(key => imageById.get(key) ? [imageById.get(key)!] : []);
    const allHere = targets.every(item => imageOnScopeBoard(item, scopeId)), multiple = ids.length > 1;
    const actions: ContextAction[] = [];
    if (!multiple) actions.push({ id: 'view', label: 'View image', run: () => onOpenImage(image, { ids: displayedIds, parentId: scopeId }) });
    if (source === 'board' && !multiple) actions.push({ id: 'preview', label: 'Preview related images', disabled: !canFindSimilar || matching,
      run: () => { setRandomDraft(null); setRelatedRequest(previous => ({ id, serial: (previous?.serial || 0) + 1 })); } });
    if (source === 'browser') actions.push({ id: 'place', label: allHere ? 'Locate on board' : scopeId === null ? targets.filter(item => !imageOnScopeBoard(item, scopeId)).every(item => item.categoryId === null) ? 'Add to staging' : 'Move to staging' : `Move to “${currentStash?.name.split('/').at(-1)}”`,
      run: () => allHere ? revealImages(ids) : addMarkedToBoard(ids) });
    actions.push({ id: 'move', label: 'Move to folder…', separator: true, run: () => setContextMoveIds(ids) },
      { id: 'new', label: 'New folder', run: () => createStash(ids) });
    if (allHere) actions.push({ id: 'remove', label: removalLabel, separator: true, run: () => removeFromBoard(ids) });
    if (multiple) actions.push({ id: 'deselect', label: 'Deselect images', separator: true, run: clearSelection });
    if (contextMenu.open(event, { label: 'Image actions', heading: multiple ? `${ids.length} images selected` : undefined, actions })) {
      selectionOrigin.current = source;
      if (!selectedIds.has(id)) { setSelectedIds(new Set([id])); setSelectedId(id); }
      return true;
    }
    return false;
  };
  const boardContext = (event: ContextTrigger) => {
    if (event.defaultPrevented || nativeContextTarget(event) || !(event.target instanceof Element)) return;
    const target = event.target;
    const tile = target.closest<HTMLElement>('[data-stash-drop-id]');
    if (tile) { contextMenu.open(event, { label: 'Folder actions', actions: folderActions(tile.dataset.stashDropId!) }); return; }
    const card = target.closest<HTMLElement>('[data-testid^="card-"]');
    if (card) { imageContext(event, card.dataset.testid!.slice(5), 'board', boardImages.map(image => image.id)); return; }
    if (!target.hasAttribute('data-board-background')) return;
    const point = 'clientX' in event && (event.clientX || event.clientY) ? boardPointAt({ x: event.clientX, y: event.clientY }, { x: 0, y: 0 }) : undefined;
    const actions: ContextAction[] = [{ id: 'new', label: 'New folder', run: () => createStash([], point || undefined) }];
    if (scopeId === null) actions.push({ id: 'random', label: 'Preview random images', disabled: !pendingRootIds.length, run: () => previewRandomImages(pendingRootIds) });
    actions.push({ id: 'select', label: 'Select all images on board', separator: true, disabled: !boardImages.length, run: () => {
      selectionOrigin.current = 'board'; setSelectedIds(new Set(boardImages.map(image => image.id))); setSelectedId(boardImages.at(-1)?.id || null);
    } }, { id: 'fit', label: 'Fit board', run: fitBoard }, { id: 'undo', label: 'Undo', separator: true, disabled: !undo || undo.busy, run: () => undo?.onUndo() });
    contextMenu.open(event, { label: scopeId === null ? 'Staging actions' : 'Board actions', actions });
  };
  const viewPreview = (id: string) => { const image = imageById.get(id); if (image) onOpenImage(image, { ids: [id], parentId: scopeId }); };
  const previewPlacement = { onPlaceInto: placePreviewInto, onViewPreview: viewPreview,
    onMovePreview: (id: string, place: (destination: string | null) => Promise<boolean>) => setPreviewMove({ id, place }) };
  const renamingFolder = categories.find(folder => folder.id === renameFolderId);
  return <ContextMenuProvider value={contextMenu.open}><main ref={workspaceRef} tabIndex={-1} className={`sorting-workspace sorting-workspace--stashes sorting-workspace--shell sorting-workspace--browser has-folder-sidebar${multiSelect ? ' is-selecting' : ''}${browserPanel.expanded ? ' is-browser-expanded' : ''}${browserPanel.collapsed ? ' is-browser-collapsed' : ''}`} aria-label="Sorting workspace"
    style={{ '--image-browser-width': `${browserPanel.collapsed ? 48 : browserPanel.width}px`, '--pile-board-height': `${workspaceSize.height - 56}px`, '--folder-sidebar-width': `${folderSidebar.width}px`, '--folder-sidebar-space': `${folderSidebar.open ? folderSidebar.width : 48}px` } as React.CSSProperties}
    onPointerDownCapture={event => { if (!dragPointRef.current) { dragPointerType.current = event.pointerType; dragPointerId.current = event.pointerId; dragSourceRef.current = event.target; } }}
    onKeyDown={event => {
      if (event.defaultPrevented) return;

      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (dragging && dragSourceRef.current instanceof Element) {
          dragSourceRef.current.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: dragPointerId.current, pointerType: dragPointerType.current,
            clientX: dragPointRef.current?.x, clientY: dragPointRef.current?.y }));
        }
        cancelGrouping(); clearSelection(); setChooserOpen(false);
      }
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
      folderTitle={currentStash?.unnamed ? <FolderNameSuggestions key={currentStash.id} folder={currentStash} images={images} categories={categories} enabled={clipEnabled} busy={busy || saving} onRename={onRenameStash} /> : undefined}
      selectedCount={selectedImages.length} selectMode={multiSelect}
      busy={busy || saving} dragging={!!dragging || !!folderDragId} zoom={zoom} undo={undo}
      status={exportStatus || exportNotice || (busy ? progress || 'Saving…' : analysisStatus || analysisNotice || (saving ? 'Saving…' : message))} error={folderMoveError || error || exportError}
      similarity={similarityControls}
      exportActions={<ExportActions projectName={projectName} boardName={currentStash?.name.split('/').at(-1) || 'Staging'} images={images} categories={categories} busy={busy} canFolder={canExportFolder} onSorted={onExport} onBackup={onBackup} onBoardPng={scope => void saveBoardImage(scope)} exportingImage={!!exportStatus}
        boardFeedback={(exportStatus || exportError) && <>
          <p role={exportError ? 'alert' : 'status'} className={exportError ? 'workspace-error' : undefined}>{exportError || exportStatus}</p>
          {exportStatus ? <MenuItem icon="close" label="Cancel export" onClick={() => imageExport.cancel()} />
            : <MenuItem icon="close" label="Dismiss export error" onClick={() => imageExport.clearError()} />}
        </>} />}
      takeOutHover={folderDropHover === null ? 'root' : folderDropHover || takeOutHover} onBack={onBack} onSettings={onSettings} onNavigate={navigateStash} onDeselect={() => { clearSelection(); focusAction('selection'); }}
      onMove={() => setChooserOpen(true)}
      removal={selectedImages.length > 0 && selectedImages.every(image => imageOnScopeBoard(image, scopeId)) ? { label: removalLabel, onRemove: () => removeFromBoard([...selectedIds]) } : undefined}
      onSelectMode={() => setMultiSelect(value => !value)} onCreate={() => void createStash([...selectedIds])}
      onInspect={() => { if (selectedImages[0]) onOpenImage(selectedImages[0], { ids: boardImages.map(image => image.id), parentId: scopeId }); }}
      onZoom={setZoom} onFit={fitBoard} onRename={onRenameStash} onMoveFolder={requestFolderMove} currentEmpty={!boardImages.length && !categoryLayout.groups.length} onDelete={deleteEmptyStash} />
    <ImageBrowser scopeId={scopeId} destinationName={currentStash?.name.split('/').at(-1) || 'Staging'} projectId={projectId} images={orderedImages} categories={categories} thumbnails={thumbnails} importedImageIds={importedImageIds}
      onBoardIds={onBoardIds} selectedIds={selectedIds} draggingId={dragging?.id} multiSelect={multiSelect}
      busy={busy || saving} preparing={preparingOrder} clipEnabled={clipEnabled} order={pileOrder} reversed={reverseOrder} status={analysisStatus || analysisNotice || (analysisProgress.failed > 0 ? `${analysisProgress.failed} previews unavailable` : '')}
      expanded={browserPanel.expanded} onExpanded={expanded => { if (expanded) closeRandomDraft(); setBrowserPanel(current => ({ ...current, expanded })); }} regionRef={browserRef} onPanel={updateBrowserPanel}
      onOrder={changePileOrder} onReverse={reversePileOrder} onShuffle={shufflePile} onSelect={selectBrowserImage}
      onImageContext={imageContext} onSelectAll={selectBrowserImages} onDeselect={clearSelection}
      onAdd={addMarkedToBoard} onShow={revealImages} onBringToFront={bringToFront} starterActive={showStarter} onFilterChange={() => { closeRandomDraft(); rootIntake.dismiss(); }}
      intakeHost={intakeHost} randomBatch={scopeId === null ? { previewing: !!randomDraft, count: rootIntake.count, onCount: rootIntake.setCount, onAdd: ids => previewRandomImages(ids) } : undefined}
      onOpen={(image, ids) => onOpenImage(image, { ids, parentId: scopeId })}
      onDragStart={onBrowserDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDrop={onBrowserMoveEnd} onInteracting={clipInteraction} />
    <section className="sorting-workspace__board-region" data-board-location={scopeId === null ? 'staging' : 'folder'} aria-label="Sorting workspace board">
    <div onContextMenu={boardContext} onKeyDown={event => { if (contextKey(event)) boardContext(event); }} className="sorting-workspace__board" ref={boardPaneRef} role="region" aria-label="Sorting board area">
      <div className="workspace-board-scene" ref={navigationSceneRef}>
      <Board thumbnailCache={thumbnails} key={scopeId || "root"} cards={visibleBoardCards}
        baseCardWidth={CARD_WIDTH} cardLayoutMode="as-is" showSortSelection showCategoryLabels
        instantPositionIds={groupDrag.instantIds}
        dealtCardIds={intake.dealtIds} dealCardOrigins={intake.dealOrigins} allowExternalDrag
        boardBackground={<StashBoardLayer thumbnailCache={thumbnails} groups={visibleGroups} urls={objectUrls} zoom={zoom} busy={busy || saving} hoverId={folderDropHover || hoverCategoryId} pulseId={pulseCategoryId} editingId={editingStashId}
          images={imageById} onImageStart={onStashDragStart} onImageMove={onDragMove} onImageEnd={onDragEnd} onImageDrop={onStashImageDrop} onOpen={navigateStash} onRename={onRenameStash} onFinishNaming={id => setEditingStashId(current => current === id ? null : current)} onRequestMove={requestFolderMove} onDelete={deleteEmptyStash} onMove={moveCategoryGroup} onPreviewMove={previewGroupMove} onCancelMove={resetGroupPreview} />}
        cardAction={selectedImages.length === 1 && imageOnScopeBoard(selectedImages[0], scopeId) && !dragging ? {
          id: selectedImages[0].id,
          element: <BoardImageActions label={scopeId === null ? 'Remove image from staging' : `Remove image from “${currentStash?.name.split('/').at(-1)}”`}
            disabled={busy || saving} onRemove={() => removeFromBoard([selectedImages[0].id])}>
            <SimilarImageAdd {...previewPlacement} onOpenRequestHandled={() => setRelatedRequest(undefined)} openRequest={relatedRequest?.id === selectedImages[0].id ? relatedRequest.serial : undefined} key={`${scopeId}:${selectedImages[0].id}`} referenceId={selectedImages[0].id} scopeId={scopeId}
            method={similarityMethod} clipEnabled={clipEnabled} contentRevision={clipRevision} count={relatedCount.count} onCount={relatedCount.setCount}
            queryKey={suggestionCandidateIds} batches={suggestionBatches.current}
            disabled={!canFindSimilar || busy || saving || matching} images={imageById} urls={objectUrls} thumbnailCache={thumbnails} portal={workspaceRef.current}
            board={boardRef} pane={boardPaneRef} positions={suggestionPositions} groups={categoryLayout.groups} zoom={zoom}
            onPreview={(method, count) => findSimilarImages(selectedImages[0].id, method, count, true, false)}
            onSearch={async (query, count) => {
              const referenceId = selectedImages[0].id;
              const candidates = similarityCandidates(imagesRef.current, scopeId, new Set([referenceId]), false)
                .filter(image => !imageOnScopeBoard(image, scopeId));
              return (await searchContent(candidates.map(image => image.id), query, count)).map(match => ({ ...match, referenceId }));
            }}
            onAdd={acceptSimilarPreview} onPlace={placePreview} onHover={previewHover}
            onMethod={changeSimilarityMethod} onThumbnails={previewThumbnails} /></BoardImageActions>,
        } : undefined}
        selectedCardIds={[...selectedIds]} cardCategoryColors={imageColors}  selectionOnly={multiSelect}
        viewScale={zoom} viewCenter={cameraCenter || initialCenter} worldSize={worldSize} panEnabled onViewChange={updateBoardWindow}
        onGestureView={view => { setZoom(view.scale); setCameraCenter({ x: view.centerX, y: view.centerY }); }}
        boardRef={boardRef} dragEnabled={!busy}
        onBringToFront={bringToFront} onSelectCard={selectBoardImage}
        onClearSelection={clearSelection} onLassoSelect={(ids, append) => { setSelectedIds(current => new Set(append ? [...current, ...ids] : ids)); setSelectedId(ids.at(-1) || null); }}
        onOpenPreview={openBoardImage}
        onMoveEnd={onBoardMoveEnd} onDragScreenStart={onDragStart}
        onDragScreenMove={onDragMove} onDragScreenEnd={onDragEnd} />
      {!showStarter && !randomDraft && !boardCards.length && !categoryLayout.groups.length && <p className="workspace-empty-board">{scopeId === null ? 'Add a few images to Staging to start sorting.' : 'This folder is empty. Move images here from the browser, or create a folder.'}</p>}
      </div>
      <AnimatePresence>{showStarter && <BoardStarter key="starter" count={rootIntake.count} available={pendingRootIds.length} previewIds={starterSample.slice(0, 3)} thumbnails={thumbnails}
        busy={busy || saving} onCount={rootIntake.setCount} onStart={addRandomImages} onDismiss={rootIntake.dismiss} />}</AnimatePresence>
      <div className="staging-intake-host" ref={setIntakeHost} />
      {randomDraft && scopeId === null && <RandomImageAdd {...previewPlacement} key={randomDraft.serial} candidateIds={randomDraft.ids} count={rootIntake.count}
        board={boardRef} pane={boardPaneRef} zoom={zoom} host={intakeHost} images={imageById} thumbnails={thumbnails} urls={objectUrls}
        positions={suggestionPositions} groupLayoutKey={categoryLayout.groups.map(group => `${group.id}:${group.x}:${group.y}`).join('|')}
        disabled={busy || saving || !!dragging} onCount={rootIntake.setCount} onAccept={acceptRandomPreview} onClose={closeRandomDraft} onPlace={placePreview} onHover={previewHover} />}
    </div>

    <footer className={`workspace-board-status${error || exportError ? ' has-error' : ''}`} title={error || exportError || message}>
      {error || exportError || exportStatus || exportNotice || (busy ? progress : saving ? 'Saving…' : analysisNotice) || message || 'Hold an image over another to create a folder.'}
    </footer>
    </section>

    <FolderSidebar categories={categories} currentId={scopeId} view={folderSidebar} onView={setFolderSidebar} busy={busy || saving}
      dragging={!!dragging || !!folderDragId || previewDragging} dragFolderId={folderDragId}
      onNavigate={navigateStash} onFolderActions={folderActions} onCreateTop={() => createStash([], undefined, undefined, null)} onRequestMove={requestFolderMove} onDrag={sidebarFolderDrag} onDrop={dropSidebarFolder} />
    {renamingFolder && <FolderRenameDialog key={renamingFolder.id} folder={renamingFolder} busy={busy || saving} onRename={onRenameStash} onClose={() => setRenameFolderId(null)} />}
    {contextMoveIds && <StashPicker categories={categories} images={images} selected={images.filter(image => contextMoveIds.includes(image.id))} busy={busy || saving}
      onClose={() => setContextMoveIds(null)} onChoose={async id => { await assignCategory(contextMoveIds, id); }} />}
    {previewMove && imageById.has(previewMove.id) && <StashPicker categories={categories} images={images} selected={[imageById.get(previewMove.id)!]} busy={busy || saving}
      onClose={() => setPreviewMove(undefined)} onChoose={async id => {
        if (imageOnScopeBoard(imageById.get(previewMove.id)!, id)) throw new Error(id === null ? 'This image is already on Staging. Choose a folder.' : 'This image is already in that folder.');
        if (!await previewMove.place(id)) throw new Error('Could not place this preview. Try again.');
      }} />}
    {chooserOpen && <StashPicker categories={categories} images={images} selected={selectedImages} busy={busy || saving} onClose={() => {
      setChooserOpen(false);
      focusAction('selection');
    }} onChoose={async id => { await assignCategory([...selectedIds], id); }} onCreate={async name => {
      await onCreateStash([...selectedIds], scopeId, name); setBrowserPanel(current => ({ ...current, expanded: false })); clearSelection();
    }} />}
    {dragging && overlayImage && overlayPoint && <div ref={ghostRef} className="sorting-workspace__drag-ghost" style={{
      left: overlayPoint.x, top: overlayPoint.y, width: overlaySize, height: overlaySize,
      transform: `translate(-${dragging.anchor.x * 100}%, -${dragging.anchor.y * 100}%)`,
    }} aria-hidden="true">
      {objectUrls.get(overlayImage.id) ? <img src={objectUrls.get(overlayImage.id)} alt="" /> : <span>{overlayImage.path.split('/').at(-1)}</span>}
      {hoverCategoryId ? <span className="sorting-workspace__drag-count">{hoverCategoryId === 'unassigned' ? 'Move to Staging' : `Move ${movingSelection(overlayImage.id).length === 1 ? 'into' : `${movingSelection(overlayImage.id).length} into`} ${categoryById.get(hoverCategoryId)}`}</span> : dragInPile ? <span className="sorting-workspace__drag-count">{scopeId === null && movingSelection(overlayImage.id).every(id => { const image = imageById.get(id); return image && imageOnScopeBoard(image, null); }) ? 'Return to waiting images' : 'Drop on a board or folder to move'}</span> : movingSelection(overlayImage.id).length > 1 && <span className="sorting-workspace__drag-count">Move {movingSelection(overlayImage.id).length} images</span>}
    </div>}
    {groupPreview && <StashCreationCue ref={groupPreviewRef} key={groupPreview.serial} ready={groupPreview.ready} position={groupPreview.position}
      count={groupingCount} urls={[objectUrls.get(groupPreview.targetId), dragging ? objectUrls.get(movingSelection(dragging.id).at(-1) || dragging.id) : undefined]} />}
  </main>{contextMenu.host}</ContextMenuProvider>;
}
