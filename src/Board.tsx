import { useBoardCamera } from './useBoardCamera';
import * as React from 'react';
import { PointerSession } from './pointerSession';
import type { ImageThumbnailCache } from './imageThumbnails';
import { LocateFixed } from 'lucide-react';
import type { CameraFrameSource, CardData, CardLayoutMode } from './types';
import { boardPanGutter, type CameraView } from './camera';
import { useBoardPan } from './useBoardPan';
import { useBoardGestures } from './useBoardGestures';
import type { GestureCamera } from './boardGestures';
import { DraggableCard } from './DraggableCard';
import { getCardDimensions } from './cardLayout';
export interface BoardProps {
  cards: CardData[];
  thumbnailCache?: ImageThumbnailCache;
  baseCardWidth: number;
  cardLayoutMode: CardLayoutMode;
  selectedCardIds?: string[];
  showSortSelection?: boolean;
  showCategoryLabels?: boolean;
  cardCategoryColors?: Map<string, string>;
  instantPositionIds?: Set<string>;
  selectionOnly?: boolean;
  dealtCardIds?: string[];
  dealCardOrigins?: Map<string, { x: number; y: number; delay: number; inPlace?: boolean }>;
  allowExternalDrag?: boolean;
  boardOverlay?: React.ReactNode;
  boardBackground?: React.ReactNode;
  cardAction?: { id: string; element: React.ReactNode };
  viewScale?: number;
  viewCenter?: { x: number; y: number };
  worldSize?: { width: number; height: number };
  panEnabled?: boolean;
  onViewChange?: (view: CameraView, source: CameraFrameSource) => void;
  onGestureView?: (view: GestureCamera) => void;
  boardRef: React.RefObject<HTMLDivElement>;
  dragEnabled: boolean;
  onBringToFront: (id: string) => void;
  onMoveEnd: (id: string, newX: number, newY: number, dropPoint?: { x: number; y: number }, screenPoint?: { x: number; y: number }) => boolean | void;
  onDragScreenStart?: (id: string, point: { x: number; y: number }, anchor: { x: number; y: number }) => void;
  onDragScreenMove?: (id: string, point: { x: number; y: number }) => void;
  onDragScreenEnd?: (id: string) => void;
  onSelectCard?: (id: string, options?: { toggle?: boolean }) => void;
  onClearSelection?: () => void;
  onLassoSelect?: (ids: string[], append: boolean) => void;
  onOpenPreview?: (id: string) => void;
}


export function Board({
  cards,
  thumbnailCache,
  baseCardWidth,
  cardLayoutMode,
  selectedCardIds,
  showSortSelection = false,
  showCategoryLabels = false,
  cardCategoryColors,
  instantPositionIds,
  selectionOnly = false,
  dealtCardIds,
  dealCardOrigins,
  allowExternalDrag = false,
  boardOverlay,
  boardBackground,
  cardAction,
  viewScale = 1,
  viewCenter,
  worldSize,
  panEnabled = false,
  onViewChange,
  onGestureView,
  boardRef,
  dragEnabled,
  onBringToFront,
  onMoveEnd,
  onDragScreenStart,
  onDragScreenMove,
  onDragScreenEnd,
  onSelectCard,
  onClearSelection,
  onLassoSelect,
  onOpenPreview,
}: BoardProps) {
  const [keyboardAnnouncement, setKeyboardAnnouncement] = React.useState('');
  const [lassoRect, setLassoRect] = React.useState<{ x0: number; y0: number; x1: number; y1: number; append: boolean } | null>(null);
  const [lasso] = React.useState(() => new PointerSession<NonNullable<typeof lassoRect>>());
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const cameraLayoutRef = React.useRef<HTMLDivElement>(null);
  const selectedIds = React.useMemo(() => new Set(selectedCardIds), [selectedCardIds]);
  const canLasso = showSortSelection && !!onLassoSelect;
  const cardDimsById = React.useMemo(() => new Map(cards.map(card =>
    [card.id, getCardDimensions(card, cardLayoutMode, baseCardWidth)])), [cards, cardLayoutMode, baseCardWidth]);
  const cardsRef = React.useRef(cards);
  cardsRef.current = cards;

  const handleCardKeyboardMove = React.useCallback(
    (id: string, direction: 'left' | 'right' | 'up' | 'down') => {
      if (!dragEnabled) return;
      const card = cardsRef.current.find(entry => entry.id === id);
      if (!card) return;
      const restoreCardFocus = () => {
        window.requestAnimationFrame(() => {
          const expectedTestId = `card-${id}`;
          const element = Array.from(boardRef.current?.querySelectorAll<HTMLElement>('[data-testid^="card-"]') || []).find(
            (candidate) => candidate.dataset.testid === expectedTestId
          );
          allowNativeScroll();
          element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          element?.focus({ preventScroll: true });
        });
      };
      const step = 32;
      const dx = direction === 'left' ? -step : direction === 'right' ? step : 0;
      const dy = direction === 'up' ? -step : direction === 'down' ? step : 0;
      const moved = onMoveEnd(id, card.x + dx, card.y + dy);
      setKeyboardAnnouncement(moved === false ? `${card.meta.name} cannot move farther in that direction.` : `Moved ${card.meta.name}.`);
      restoreCardFocus();
    }, [dragEnabled, onMoveEnd, boardRef]
  );

  const cameraScale = worldSize ? Math.max(0.01, viewScale) : 1;
  // A gutter on every side makes panning possible at 100% and below, while
  // keeping card coordinates independent of the scrollable camera frame.
  const gutter = worldSize ? boardPanGutter(worldSize.width, worldSize.height) : { x: 0, y: 0 };
  const gutterX = gutter.x * cameraScale;
  const gutterY = gutter.y * cameraScale;
  const canvasPoint = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: (event.clientX - (rect?.left || 0)) / cameraScale, y: (event.clientY - (rect?.top || 0)) / cameraScale };
  }, [cameraScale]);
  const { readCameraView, emitCameraView, placeCamera, onScroll: onCameraScroll, allowNativeScroll, guardFocusScroll, suppressCameraScrollRef } = useBoardCamera(boardRef, worldSize, cameraScale, viewCenter, onViewChange);
  React.useEffect(() => {
    const node = boardRef.current;
    if (!node) return;
    // Preview photos are portals: React focus handlers on Board are not their
    // ancestors, although the photos live inside its scroller in the DOM.
    const focus = (event: FocusEvent) => { if ((event.target as Element).closest('[data-preview-slot]')) guardFocusScroll(true); };
    const key = (event: KeyboardEvent) => {
      if ((event.target as Element).closest('[data-preview-slot]') && ['Tab', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) allowNativeScroll();
    };
    const wheel = (event: WheelEvent) => { if ((event.target as Element).closest('[data-preview-slot]')) allowNativeScroll(); };
    node.addEventListener('focusin', focus, true); node.addEventListener('keydown', key, true); node.addEventListener('wheel', wheel, { capture: true, passive: true });
    return () => { node.removeEventListener('focusin', focus, true); node.removeEventListener('keydown', key, true); node.removeEventListener('wheel', wheel, true); };
  }, [boardRef, guardFocusScroll, allowNativeScroll]);

  const pan = useBoardPan({
    enabled: !!worldSize && panEnabled,
    setup: canLasso,
    boardRef,
    onPanEnd: () => emitCameraView('pan'), onPanMove: allowNativeScroll,
    onBlankClick: onClearSelection,
  });
  const touchNavigating = useBoardGestures({ enabled: !!worldSize && panEnabled && !!onGestureView, boardRef,
    readView: readCameraView, onChange: view => onGestureView?.(view), onBlankClick: onClearSelection });

  const handleCanvasPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canLasso) return;
      // Touch navigation belongs to the camera gesture hook. Lasso selection
      // remains a mouse/pen interaction.
      if (event.pointerType === 'touch') return;
      if (event.button !== 0) return;
      if (!(event.target as Element).hasAttribute('data-board-background')) return;
      if (worldSize && panEnabled && !event.shiftKey) return;
      const point = canvasPoint(event);
      if (!lasso.begin(event.pointerId, { x0: point.x, y0: point.y, x1: point.x, y1: point.y, append: event.shiftKey })) return;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore pointer capture errors in non-browser test environments
      }
      setLassoRect({
        x0: point.x,
        y0: point.y,
        x1: point.x,
        y1: point.y,
        append: event.shiftKey,
      });
    },
    [canvasPoint, canLasso, panEnabled, worldSize]
  );

  const handleCanvasPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const current = lasso.read(event.pointerId); if (!current) return;
      const point = canvasPoint(event);
      current.x1 = point.x; current.y1 = point.y; setLassoRect({ ...current });
    },
    [canvasPoint, lassoRect]
  );

  const handleCanvasPointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const lassoRect = lasso.finish(event.pointerId); if (!lassoRect) return;
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // ignore capture release errors from non-browser test environments
      }

      const minX = Math.min(lassoRect.x0, lassoRect.x1);
      const maxX = Math.max(lassoRect.x0, lassoRect.x1);
      const minY = Math.min(lassoRect.y0, lassoRect.y1);
      const maxY = Math.max(lassoRect.y0, lassoRect.y1);
      const isClick = maxX - minX < 4 && maxY - minY < 4;

      if (isClick) {
        if (!lassoRect.append) onClearSelection?.();
        setLassoRect(null);
        return;
      }

      const selectedIds = cards
        .filter((card) => {
          const dims = cardDimsById.get(card.id) || { w: baseCardWidth, h: Math.round(baseCardWidth * (9 / 16)) };
          const cardMinX = card.x;
          const cardMaxX = card.x + dims.w;
          const cardMinY = card.y;
          const cardMaxY = card.y + dims.h;
          const intersects = !(cardMaxX < minX || cardMinX > maxX || cardMaxY < minY || cardMinY > maxY);
          return intersects;
        })
        .map((card) => card.id);

      onLassoSelect?.(selectedIds, lassoRect.append);
      if (selectedIds.length === 0 && !lassoRect.append) {
        onClearSelection?.();
      }
      setLassoRect(null);
    },
    [baseCardWidth, cardDimsById, cards, lassoRect, onClearSelection, onLassoSelect]
  );

  const handleCanvasPointerCancel = React.useCallback(() => {
    lasso.cancel();
    setLassoRect(null);
  }, []);

  const lassoBounds = React.useMemo(() => {
    if (!lassoRect) return null;
    const left = Math.min(lassoRect.x0, lassoRect.x1);
    const top = Math.min(lassoRect.y0, lassoRect.y1);
    return {
      left,
      top,
      width: Math.abs(lassoRect.x1 - lassoRect.x0),
      height: Math.abs(lassoRect.y1 - lassoRect.y0),
    };
  }, [lassoRect]);

  const canvasStyle = React.useMemo<React.CSSProperties>(
    () => ({
      width: worldSize?.width ?? '100%',
      height: worldSize?.height ?? '100%',
      minWidth: worldSize ? undefined : '100%',
      minHeight: worldSize ? undefined : '100%',
      transform: worldSize ? `scale(${cameraScale})` : undefined,
      transformOrigin: worldSize ? 'top left' : undefined,
    }),
    [cameraScale, worldSize]
  );
  const numericCanvasW = worldSize?.width;
  const numericCanvasH = worldSize?.height;
  const scaledCanvasW = numericCanvasW ? numericCanvasW * cameraScale : null;
  const scaledCanvasH = numericCanvasH ? numericCanvasH * cameraScale : null;
  const cameraLayoutStyle = React.useMemo<React.CSSProperties>(
    () => ({
      width: scaledCanvasW ? `calc(max(100%, ${scaledCanvasW}px) + ${gutterX * 2}px)` : '100%',
      height: scaledCanvasH ? `calc(max(100%, ${scaledCanvasH}px) + ${gutterY * 2}px)` : '100%',
    }),
    [gutterX, gutterY, scaledCanvasH, scaledCanvasW]
  );
  const cameraFrameStyle = React.useMemo<React.CSSProperties>(
    () => ({
      width: scaledCanvasW ?? '100%',
      height: scaledCanvasH ?? '100%',
    }),
    [scaledCanvasH, scaledCanvasW]
  );

  return (
    <>
    <div
      ref={boardRef}
      data-testid="board-root"
      tabIndex={0}
      role="region"
      aria-label="Sorting board"
      data-board-background
      {...pan.handlers}
      className={`board board--sort ${worldSize && panEnabled ? 'board--cameraPannable' : ''} ${onGestureView ? 'board--gestures' : ''} ${pan.panning || touchNavigating ? 'isCameraPanning' : ''} ${pan.handMode ? 'isHandMode' : ''}`}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={handleCanvasPointerUp}
      onPointerCancel={handleCanvasPointerCancel}
      onWheelCapture={allowNativeScroll}
      onFocusCapture={event => guardFocusScroll(!!(event.target as Element).closest('[data-board-group-id]'))}
      onKeyDownCapture={event => { if (['Tab', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) allowNativeScroll(); }}
      onScroll={onCameraScroll}
    >
      <div ref={cameraLayoutRef} data-board-background className="boardCameraLayout" style={cameraLayoutStyle}>
        <div data-board-background className="boardCameraFrame" style={cameraFrameStyle}>
          <div
            ref={canvasRef}
            data-testid="board-canvas"
            data-board-background
            className="boardCanvas"
            style={canvasStyle}
          >
        <p className="srOnly" id="sort-card-keyboard-help">
          {showSortSelection ? 'Press S to select this image. Shift-S adds or removes it from the selection. ' : ''}
          Use the arrow keys to move this card. {panEnabled ? 'Hold Space and drag to pan the board.' : ''}
        </p>
        <p className="srOnly" role="status" aria-live="polite" aria-atomic="true">
          {keyboardAnnouncement}
        </p>
        {canLasso && lassoBounds && lassoBounds.width > 2 && lassoBounds.height > 2 ? (
          <div
            className="boardLasso"
            style={{
              left: lassoBounds.left,
              top: lassoBounds.top,
              width: lassoBounds.width,
              height: lassoBounds.height,
            }}
            aria-hidden
          />
        ) : null}

        {boardBackground}
        {cards.map((card) => {
          const dims = cardDimsById.get(card.id) || getCardDimensions(card, cardLayoutMode, baseCardWidth);
          return (
            <DraggableCard
              key={card.id}
              card={card}
              thumbnailCache={thumbnailCache}
              cardW={dims.w}
              cardH={dims.h}
              mode="sort"
              isSelected={showSortSelection && selectedIds.has(card.id)}
              dragEnabled={dragEnabled}
              coordinateScale={cameraScale}
              dragConstraintsRef={allowExternalDrag ? undefined : worldSize ? cameraLayoutRef : canvasRef}
              onBringToFront={onBringToFront}
              onMoveEnd={onMoveEnd}
              onDragScreenStart={onDragScreenStart}
              onDragScreenMove={onDragScreenMove}
              onDragScreenEnd={onDragScreenEnd}
              onSelectCard={onSelectCard}
              onKeyboardMove={dragEnabled ? handleCardKeyboardMove : undefined}
              keyboardDescriptionId={'sort-card-keyboard-help'}
              onOpenPreview={onOpenPreview}
              categoryLabel={showCategoryLabels ? card.meta.tags[0] : undefined}
              categoryColor={cardCategoryColors?.get(card.id)}
              instantPosition={instantPositionIds?.has(card.id)}
              selectionOnly={selectionOnly}
              dealIn={!!dealtCardIds?.includes(card.id)}
              dealFrom={dealCardOrigins?.get(card.id)}
              showChrome
              imageAction={cardAction?.id === card.id ? cardAction.element : undefined}
            />
          );
        })}
        {boardOverlay}
          </div>
        </div>
      </div>
    </div>
    {worldSize && panEnabled ? (
      <div className="boardPanHelp">
        <button type="button" onClick={() => {
          placeCamera({ x: worldSize.width / 2, y: worldSize.height / 2 });
          emitCameraView('pan');
          window.requestAnimationFrame(() => { suppressCameraScrollRef.current = false; });
        }}><LocateFixed />Center board</button>
      </div>
    ) : null}
    </>
  );
}
