import * as React from 'react';
import { animate, motion, useDragControls, useMotionValue, useReducedMotion, useSpring, type MotionStyle } from 'framer-motion';
import type { CardData, Mode } from './types';
import { clamp } from './utils';
import { CardPreview } from './CardPreview';

const ROTATION_MAX = 2; // degrees
const RESIZE_EDGE_BAND_PX = 12;
const RESIZE_EDGE_BAND_MIN_PX = 6;

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface ResizeStartPayload {
  pointerId: number;
  clientX: number;
  clientY: number;
  edge: ResizeEdge;
}

function detectResizeEdge(localX: number, localY: number, width: number, height: number): ResizeEdge | null {
  if (width <= 0 || height <= 0) return null;
  const edgeBand = Math.max(
    RESIZE_EDGE_BAND_MIN_PX,
    Math.min(RESIZE_EDGE_BAND_PX, Math.floor(Math.min(width, height) / 4))
  );
  const nearLeft = localX <= edgeBand;
  const nearRight = localX >= width - edgeBand;
  const nearTop = localY <= edgeBand;
  const nearBottom = localY >= height - edgeBand;

  if (nearTop && nearLeft) return 'nw';
  if (nearTop && nearRight) return 'ne';
  if (nearBottom && nearLeft) return 'sw';
  if (nearBottom && nearRight) return 'se';
  if (nearTop) return 'n';
  if (nearBottom) return 's';
  if (nearLeft) return 'w';
  if (nearRight) return 'e';
  return null;
}

export interface DraggableCardProps {
  card: CardData;
  cardW: number;
  cardH: number;
  liftedCardW?: number;
  liftedCardH?: number;
  mode: Mode;
  isSelected?: boolean;
  dragEnabled: boolean;
  coordinateScale?: number;
  dragConstraintsRef?: React.RefObject<HTMLElement>;
  onBringToFront: (id: string) => void;
  onMoveEnd: (id: string, newX: number, newY: number, dropPoint?: { x: number; y: number }, screenPoint?: { x: number; y: number }) => boolean | void;
  onDragScreenStart?: (id: string, point: { x: number; y: number }, anchor: { x: number; y: number }) => void;
  onDragScreenMove?: (id: string, point: { x: number; y: number }) => void;
  onDragScreenEnd?: (id: string) => void;
  onResizeStart?: (id: string, pointer: ResizeStartPayload) => void;
  onSelectCard?: (id: string, options?: { toggle?: boolean }) => void;
  onKeyboardMove?: (id: string, direction: 'left' | 'right' | 'up' | 'down') => void;
  keyboardDescriptionId?: string;
  locationLabel?: string;
  onDragTraceStart?: (id: string, x: number, y: number) => void;
  onDragTraceSample?: (id: string, x: number, y: number, dragPoint?: { x: number; y: number }) => void;
  onOpenPreview?: (id: string) => void;
  showChrome?: boolean;
  categoryLabel?: string;
  categoryColor?: string;
  dimmed?: boolean;
  selectionOnly?: boolean;
  dealIn?: boolean;
}

function DraggableCardComponent({
  card,
  cardW,
  cardH,
  liftedCardW,
  liftedCardH,
  mode,
  isSelected,
  dragEnabled,
  coordinateScale = 1,
  dragConstraintsRef,
  onBringToFront,
  onMoveEnd,
  onDragScreenStart,
  onDragScreenMove,
  onDragScreenEnd,
  onResizeStart,
  onSelectCard,
  onKeyboardMove,
  keyboardDescriptionId,
  locationLabel,
  onDragTraceStart,
  onDragTraceSample,
  onOpenPreview,
  showChrome,
  categoryLabel,
  categoryColor,
  dimmed = false,
  selectionOnly = false,
  dealIn = false,
}: DraggableCardProps) {
  const x = useMotionValue(card.x);
  const y = useMotionValue(card.y);
  const rawRotate = useMotionValue(0);
  const springRotate = useSpring(rawRotate, { stiffness: 800, damping: 55 });
  const prefersReducedMotion = useReducedMotion();
  const rotate = prefersReducedMotion ? rawRotate : springRotate;
  const dragControls = useDragControls();
  const dragAnchorRef = React.useRef({ x: .5, y: .5 });
  const wasSelectedOnPress = React.useRef(false);
  const draggedSincePress = React.useRef(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const canResize = mode === 'setup' && !!isSelected && !!onResizeStart;
  const liftScale = Math.max(
    1,
    Math.min(
      (liftedCardW || cardW) / Math.max(1, cardW),
      (liftedCardH || cardH) / Math.max(1, cardH)
    )
  );
  const [resizeHotEdge, setResizeHotEdge] = React.useState<ResizeEdge | null>(null);
  const isKeyboardInteractive = mode === 'setup' ? !!onSelectCard : mode === 'sort' && !!onKeyboardMove;
  const cardLabel = card.meta.name || card.meta.frontText || `${card.kind} card`;
  React.useEffect(() => {
    if (!canResize) {
      setResizeHotEdge(null);
    }
  }, [canResize]);

  const getResizeEdgeFromEvent = React.useCallback(
    (e: React.PointerEvent) => {
      if (!canResize) return null;
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      return detectResizeEdge(localX, localY, rect.width, rect.height);
    },
    [canResize]
  );

  const updateResizeHotEdge = React.useCallback(
    (e: React.PointerEvent) => {
      const next = getResizeEdgeFromEvent(e);
      setResizeHotEdge((prev) => (prev === next ? prev : next));
    },
    [getResizeEdgeFromEvent]
  );

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      const resizeEdge = !e.shiftKey ? getResizeEdgeFromEvent(e) : null;
      if (resizeEdge) {
        e.preventDefault();
        e.stopPropagation();
        const native = e.nativeEvent as PointerEvent & { stopImmediatePropagation?: () => void };
        native.stopImmediatePropagation?.();
        onBringToFront(card.id);
        onResizeStart?.(card.id, {
          pointerId: e.pointerId,
          clientX: e.clientX,
          clientY: e.clientY,
          edge: resizeEdge,
        });
        return;
      }
      // Keep default focus behavior, but lift card to top.
      // (Avoid preventDefault here; it can interfere with pointer capture in some browsers.)
      wasSelectedOnPress.current = !!isSelected;
      draggedSincePress.current = false;
      if (e.shiftKey || e.metaKey || e.ctrlKey || selectionOnly) {
        onSelectCard?.(card.id, { toggle: true });
      } else if (!isSelected) {
        onSelectCard?.(card.id, { toggle: false });
      }
      if (!selectionOnly && !e.shiftKey && !e.metaKey && !e.ctrlKey) onBringToFront(card.id);
      if (!dragEnabled) return;
      if (e.button !== 0) return;
      if (e.shiftKey || e.metaKey || e.ctrlKey || selectionOnly) return;
      const rect = e.currentTarget.getBoundingClientRect();
      dragAnchorRef.current = {
        x: clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1),
        y: clamp((e.clientY - rect.top) / Math.max(1, rect.height), 0, 1),
      };
      dragControls.start(e);
    },
    [card.id, dragControls, dragEnabled, getResizeEdgeFromEvent, isSelected, selectionOnly, onBringToFront, onResizeStart, onSelectCard]
  );

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Let nested controls, such as the video preview button, handle their own keys.
      if (event.target !== event.currentTarget) return;

      if (event.key === 'Enter' && card.kind !== 'text' && (mode !== 'setup' || event.altKey)) {
        event.preventDefault(); onOpenPreview?.(card.id); return;
      }

      if ((mode === 'setup' && (event.key === 'Enter' || event.key === ' ')) || (mode === 'sort' && event.key.toLowerCase() === 's' && onSelectCard)) {
        event.preventDefault();
        onSelectCard?.(card.id, { toggle: event.shiftKey || event.metaKey || event.ctrlKey || selectionOnly });
        onBringToFront(card.id);
        return;
      }

      if (mode !== 'sort' || !onKeyboardMove) return;
      const direction =
        event.key === 'ArrowLeft'
          ? 'left'
          : event.key === 'ArrowRight'
            ? 'right'
            : event.key === 'ArrowUp'
              ? 'up'
              : event.key === 'ArrowDown'
                ? 'down'
                : null;
      if (!direction) return;
      event.preventDefault();
      onKeyboardMove(card.id, direction);
    },
    [card.id, card.kind, mode, selectionOnly, onBringToFront, onKeyboardMove, onOpenPreview, onSelectCard]
  );

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onSelectCard || (mode !== 'setup' && mode !== 'sort')) return;
      // Preserve a group while a selected image starts dragging. A plain click
      // on that image selects just it, so the next assignment cannot recode the group.
      if (event.detail !== 0) {
        if (mode === 'sort' && wasSelectedOnPress.current && !draggedSincePress.current && !selectionOnly && !event.shiftKey && !event.metaKey && !event.ctrlKey) onSelectCard(card.id, { toggle: false });
        return;
      }
      // Pointer activation already ran through onPointerDown. A zero-detail click
      // is the synthetic activation exposed by assistive technology.
      onSelectCard(card.id, { toggle: event.shiftKey || event.metaKey || event.ctrlKey || selectionOnly });
      onBringToFront(card.id);
    },
    [card.id, mode, selectionOnly, onBringToFront, onSelectCard]
  );

  return (
    <motion.div
      className={`card ${mode === 'setup' ? 'card--setup' : 'card--sort'} ${dragEnabled ? 'card--draggable' : 'card--static'} ${isSelected ? 'isSelected' : ''} ${isDragging ? 'isDragging' : ''} ${
        resizeHotEdge && canResize ? 'isResizeHot' : ''
      } ${
        resizeHotEdge && canResize ? `isResizeHot--${resizeHotEdge}` : ''
      } ${categoryLabel ? 'isCategorized' : ''} ${dimmed && !isSelected ? 'isDimmed' : ''}`}
      data-testid={`card-${card.id}`}
      role={mode === 'setup' && isKeyboardInteractive ? 'button' : mode === 'sort' && isKeyboardInteractive ? 'group' : undefined}
      aria-roledescription={mode === 'sort' && isKeyboardInteractive ? 'movable card' : undefined}
      tabIndex={isKeyboardInteractive ? 0 : -1}
      aria-label={`Card: ${cardLabel}${locationLabel ? `. Current area: ${locationLabel}` : ''}`}
      aria-describedby={isKeyboardInteractive ? keyboardDescriptionId : undefined}
      aria-pressed={mode === 'setup' ? !!isSelected : undefined}
      style={{ x, y, zIndex: card.z, rotate, width: cardW, height: cardH, '--category-color': categoryColor } as MotionStyle}
      drag={dragEnabled}
      dragControls={dragControls}
      dragListener={false}
      dragConstraints={dragConstraintsRef}
      dragMomentum={false}
      dragElastic={0.10}
      // State-driven position. While dragging, Framer temporarily takes over.
      // Give drag controls a starting position before the first motion value exists.
      initial={dealIn ? { x: card.x, y: card.y + 170, opacity: 0 } : { x: card.x, y: card.y }}
      animate={{ x: card.x, y: card.y, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 520, damping: 40, mass: 0.7 }}
      whileDrag={{ scale: liftScale * 1.03, boxShadow: 'var(--shadow-lift)' }}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerMove={updateResizeHotEdge}
      onPointerEnter={updateResizeHotEdge}
      onPointerLeave={() => setResizeHotEdge(null)}
      onPointerCancel={() => { setResizeHotEdge(null); setIsDragging(false); }}
      onDrag={(e, info) => {
        void e;
        onDragScreenMove?.(card.id, info.point);
        // Very subtle rotation driven by recent horizontal movement.
        const next = prefersReducedMotion ? 0 : clamp(info.delta.x * 0.35, -ROTATION_MAX, ROTATION_MAX);
        rawRotate.set(next);

        const nextX = card.x + info.offset.x / coordinateScale;
        const nextY = card.y + info.offset.y / coordinateScale;
        onDragTraceSample?.(card.id, nextX, nextY, {
          x: nextX + cardW / 2,
          y: nextY + cardH / 2,
        });
      }}
      onDragStart={(_event, info) => {
        draggedSincePress.current = true;
        setIsDragging(true);
        rawRotate.set(0);
        onDragTraceStart?.(card.id, card.x, card.y);
        onDragScreenStart?.(card.id, info.point, dragAnchorRef.current);
      }}
      onDragEnd={(e, info) => {
        void e;
        setIsDragging(false);
        rawRotate.set(0);
        const nextX = card.x + info.offset.x / coordinateScale;
        const nextY = card.y + info.offset.y / coordinateScale;
        const moved = onMoveEnd(card.id, nextX, nextY, {
          x: nextX + cardW / 2,
          y: nextY + cardH / 2,
        }, info.point);
        onDragScreenEnd?.(card.id);
        // Rejected and unchanged drops keep the same React coordinates. Motion
        // therefore needs an explicit return from its temporary drag position.
        if (moved === false) {
          const transition = prefersReducedMotion
            ? { duration: 0 }
            : { type: 'spring' as const, stiffness: 520, damping: 40, mass: 0.7 };
          animate(x, card.x, transition);
          animate(y, card.y, transition);
        }
      }}
      onDoubleClick={() => {
        if (card.kind !== 'text') {
          onOpenPreview?.(card.id);
        }
      }}
    >
      <div className="card__surface">
        <CardPreview card={card} onOpenPreview={onOpenPreview} showPreviewButton={mode !== 'setup'} />

        {categoryLabel ? <span className="card__categoryLabel">{categoryLabel}</span> : null}
        {isSelected && mode === 'sort' && <span className="card__selectedMark" aria-hidden="true">✓</span>}

        {showChrome && mode === 'setup' ? (
          <div className="card__chrome">
            <div className="card__meta">
              <span className="card__tag">{card.meta.name}</span>
            </div>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

export const DraggableCard = React.memo(DraggableCardComponent);
DraggableCard.displayName = 'DraggableCard';
