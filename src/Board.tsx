import * as React from 'react';
import { LocateFixed } from 'lucide-react';
import type { CameraFrameSource, CardData, CardLayoutMode } from './types';
import { boardPanGutter, type CameraView } from './camera';
import { useBoardPan } from './useBoardPan';
import { DraggableCard } from './DraggableCard';
import { getCardDimensions } from './cardLayout';
export interface BoardProps {
  cards: CardData[];
  baseCardWidth: number;
  cardLayoutMode: CardLayoutMode;
  selectedCardIds?: string[];
  showSortSelection?: boolean;
  showCategoryLabels?: boolean;
  cardCategoryColors?: Map<string, string>;
  instantPositionIds?: Set<string>;
  selectionOnly?: boolean;
  dealtCardIds?: string[];
  dealCardOrigins?: Map<string, { x: number; y: number; delay: number }>;
  allowExternalDrag?: boolean;
  boardOverlay?: React.ReactNode;
  boardBackground?: React.ReactNode;
  cardAction?: { id: string; element: React.ReactNode };
  viewScale?: number;
  viewCenter?: { x: number; y: number };
  worldSize?: { width: number; height: number };
  panEnabled?: boolean;
  onViewChange?: (view: CameraView, source: CameraFrameSource) => void;
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
  const lassoPointerIdRef = React.useRef<number | null>(null);
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const cameraLayoutRef = React.useRef<HTMLDivElement>(null);
  const lastViewCenterRef = React.useRef<{ x: number; y: number } | null>(null);
  const lastRequestedCenterRef = React.useRef<{ x: number; y: number } | null>(null);
  const suppressCameraScrollRef = React.useRef(false);
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
          const element = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="card-"]')).find(
            (candidate) => candidate.dataset.testid === expectedTestId
          );
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
    }, [dragEnabled, onMoveEnd]
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
  const readCameraView = React.useCallback((): CameraView | null => {
    const board = boardRef.current;
    if (!board || !worldSize) return null;
    const scaledW = worldSize.width * cameraScale;
    const scaledH = worldSize.height * cameraScale;
    const layoutW = Math.max(board.clientWidth, scaledW);
    const layoutH = Math.max(board.clientHeight, scaledH);
    const frameLeft = gutterX + (layoutW - scaledW) / 2;
    const frameTop = gutterY + (layoutH - scaledH) / 2;
    return {
      scale: cameraScale,
      centerX: (board.scrollLeft + board.clientWidth / 2 - frameLeft) / cameraScale,
      centerY: (board.scrollTop + board.clientHeight / 2 - frameTop) / cameraScale,
      viewportW: Math.max(1, board.clientWidth),
      viewportH: Math.max(1, board.clientHeight),
    };
  }, [boardRef, cameraScale, gutterX, gutterY, worldSize]);

  const emitCameraView = React.useCallback(
    (source: CameraFrameSource) => {
      const view = readCameraView();
      if (!view) return;
      lastViewCenterRef.current = { x: view.centerX, y: view.centerY };
      onViewChange?.(view, source);
    },
    [onViewChange, readCameraView]
  );

  const placeCamera = React.useCallback((target: { x: number; y: number }) => {
    const board = boardRef.current;
    if (!board || !worldSize) return;
    const scaledW = worldSize.width * cameraScale;
    const scaledH = worldSize.height * cameraScale;
    const layoutW = Math.max(board.clientWidth, scaledW);
    const layoutH = Math.max(board.clientHeight, scaledH);
    const frameLeft = gutterX + (layoutW - scaledW) / 2;
    const frameTop = gutterY + (layoutH - scaledH) / 2;
    suppressCameraScrollRef.current = true;
    board.scrollLeft = Math.max(0, frameLeft + target.x * cameraScale - board.clientWidth / 2);
    board.scrollTop = Math.max(0, frameTop + target.y * cameraScale - board.clientHeight / 2);
  }, [boardRef, cameraScale, gutterX, gutterY, worldSize]);

  React.useLayoutEffect(() => {
    if (!worldSize) return;
    const initialCenter = { x: worldSize.width / 2, y: worldSize.height / 2 };
    // A new center object is a new navigation request, even when its coordinates
    // match a prior request and the user has panned elsewhere in between.
    const requestedCenterChanged = viewCenter && viewCenter !== lastRequestedCenterRef.current;
    placeCamera(requestedCenterChanged ? viewCenter : lastViewCenterRef.current || viewCenter || initialCenter);
    lastRequestedCenterRef.current = viewCenter || null;
    emitCameraView('zoom');
    const frame = window.requestAnimationFrame(() => {
      suppressCameraScrollRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [boardRef, emitCameraView, placeCamera, viewCenter, worldSize]);

  React.useEffect(() => {
    const board = boardRef.current;
    if (!board || !worldSize || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => emitCameraView('resize'));
    observer.observe(board);
    return () => observer.disconnect();
  }, [boardRef, emitCameraView, worldSize]);

  const pan = useBoardPan({
    enabled: !!worldSize && panEnabled,
    setup: canLasso,
    boardRef,
    onPanEnd: () => emitCameraView('pan'),
    onBlankClick: onClearSelection,
  });

  const handleCanvasPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canLasso) return;
      // Let the browser own one-finger touch gestures so an overflowing board
      // remains pannable. Lasso selection is a mouse/pen interaction.
      if (event.pointerType === 'touch') return;
      if (event.button !== 0) return;
      if (!(event.target as Element).hasAttribute('data-board-background')) return;
      if (worldSize && panEnabled && !event.shiftKey) return;
      const point = canvasPoint(event);
      lassoPointerIdRef.current = event.pointerId;
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
      if (!lassoRect) return;
      if (lassoPointerIdRef.current !== event.pointerId) return;
      const point = canvasPoint(event);
      setLassoRect((prev) => (prev ? { ...prev, x1: point.x, y1: point.y } : prev));
    },
    [canvasPoint, lassoRect]
  );

  const handleCanvasPointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!lassoRect) return;
      if (lassoPointerIdRef.current !== event.pointerId) return;
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // ignore capture release errors from non-browser test environments
      }

      lassoPointerIdRef.current = null;
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
    lassoPointerIdRef.current = null;
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
      tabIndex={-1}
      role="region"
      aria-label="Sorting board"
      data-board-background
      {...pan.handlers}
      className={`board board--sort ${worldSize && panEnabled ? 'board--cameraPannable' : ''} ${pan.panning ? 'isCameraPanning' : ''} ${pan.handMode ? 'isHandMode' : ''}`}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={handleCanvasPointerUp}
      onPointerCancel={handleCanvasPointerCancel}
      onScroll={() => {
        if (!suppressCameraScrollRef.current) emitCameraView('pan');
      }}
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
