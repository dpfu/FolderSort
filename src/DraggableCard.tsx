import * as React from 'react';
import { flushSync } from 'react-dom';
import { animate, motion, useDragControls, useMotionValue, useReducedMotion, useSpring, type MotionStyle } from 'framer-motion';
import type { CardData, Mode } from './types';
import { clamp } from './utils';
import { useThumbnailUrls } from './useThumbnailUrls';
import type { ImageThumbnailCache } from './imageThumbnails';
import { sameCard } from './cardEquality';
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
  appearance?: 'board' | 'browser';
  testIdPrefix?: string;
  card: CardData;
  thumbnailCache?: ImageThumbnailCache;
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
  categoryTitle?: string;
  categoryColor?: string;
  categoryDropId?: string;
  instantPosition?: boolean;
  dimmed?: boolean;
  selectionOnly?: boolean;
  dealIn?: boolean;
  dealFrom?: { x: number; y: number; delay: number };
  imageAction?: React.ReactNode;
}

function DraggableCardComponent({
  appearance = 'board',
  testIdPrefix = 'card',
  card,
  thumbnailCache,
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
  categoryTitle,
  categoryColor,
  categoryDropId,
  instantPosition = false,
  dimmed = false,
  selectionOnly = false,
  dealIn = false,
  dealFrom,
  imageAction,
}: DraggableCardProps) {
  useThumbnailUrls(thumbnailCache, [card.id]);
  const previewCard = thumbnailCache ? { ...card, src: thumbnailCache.urls.get(card.id) } : card;
  const prefersReducedMotion = useReducedMotion();
  const arrival = React.useRef(prefersReducedMotion ? undefined : dealFrom);
  const [arriving, setArriving] = React.useState(!!arrival.current);
  const elementRef = React.useRef<HTMLDivElement>(null);
  const arrivalAnimation = React.useRef<Animation>();
  const x = useMotionValue(card.x);
  const y = useMotionValue(card.y);
  React.useLayoutEffect(() => {
    const from = arrival.current, surface = elementRef.current?.querySelector<HTMLElement>('.card__surface');
    if (!from || !surface?.animate) { setArriving(false); return; }
    // Animate only the photo surface. The card's drag geometry and focus
    // target are already at their final position throughout the arrival.
    const animation = surface.animate([
      { transform: `translate(${from.x - card.x}px, ${from.y - card.y}px) scale(.72)`, opacity: 0 },
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
    ], { duration: 340, delay: from.delay * 1000, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    arrivalAnimation.current = animation;
    void animation.finished.then(() => setArriving(false)).catch(() => {});
    return () => animation.cancel();
  }, []);
  React.useLayoutEffect(() => {
    if (!instantPosition) return;
    x.stop(); y.stop(); x.set(card.x); y.set(card.y);
  }, [instantPosition, card.x, card.y, x, y]);
  const rawRotate = useMotionValue(0);
  const springRotate = useSpring(rawRotate, { stiffness: 800, damping: 55 });
  const rotate = prefersReducedMotion ? rawRotate : springRotate;
  const dragControls = useDragControls();
  const dragAnchorRef = React.useRef({ x: .5, y: .5 });
  const wasSelectedOnPress = React.useRef(false);
  const draggedSincePress = React.useRef(false);
  const quickDragHandled = React.useRef(false);
  const dragCancelled = React.useRef(false);
  const quickDragCleanup = React.useRef<() => void>();
  const dragCallbacks = React.useRef({ onMoveEnd, onDragScreenStart, onDragScreenEnd });
  dragCallbacks.current = { onMoveEnd, onDragScreenStart, onDragScreenEnd };
  React.useEffect(() => () => quickDragCleanup.current?.(), []);
  const [isDragging, setIsDragging] = React.useState(false);
  const [dragArmed, setDragArmed] = React.useState(false);
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
    (e: React.PointerEvent<HTMLDivElement>) => {
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
      // Focus without native scroll-to-reveal before the browser's default
      // pointer focus. The board camera owns scrolling during a drag.
      if (e.button === 0 && mode === 'sort') e.currentTarget.focus({ preventScroll: true });
      // Avoid preventDefault here; pointer capture must keep working on touch.
      wasSelectedOnPress.current = !!isSelected;
      draggedSincePress.current = false;
      quickDragHandled.current = false;
      dragCancelled.current = false;
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
      if (appearance === 'browser') {
        const image = e.currentTarget.querySelector('img');
        const ratio = image?.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 1;
        const fitWidth = Math.min(rect.width, rect.height * ratio), fitHeight = Math.min(rect.height, rect.width / ratio);
        // The browser uses landscape slots; the board uses square image frames.
        // Preserve the grabbed point on the photograph across that transition.
        dragAnchorRef.current = {
          x: .5 + (dragAnchorRef.current.x - .5) * rect.width / Math.max(1, fitWidth) * Math.min(1, ratio),
          y: .5 + (dragAnchorRef.current.y - .5) * rect.height / Math.max(1, fitHeight) * Math.min(1, 1 / ratio),
        };
      }
      // A quick release can precede Motion's first animation frame in WebKit.
      // Keep normal drags with Motion; complete only an unreported pointer drag.
      quickDragCleanup.current?.();
      if (mode === 'sort' && onDragScreenStart) {
        const start = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
        const origin = { x: card.x, y: card.y };
        const release = (event: PointerEvent) => {
          if (event.pointerId !== start.pointerId) return;
          quickDragCleanup.current?.();
          setDragArmed(false);
          if (event.type === 'pointercancel') {
            quickDragHandled.current = true; dragCancelled.current = true; x.set(origin.x); y.set(origin.y);
            dragCallbacks.current.onDragScreenEnd?.(card.id); return;
          }
          if (draggedSincePress.current || Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 4) return;
          quickDragHandled.current = true; draggedSincePress.current = true;
          const point = { x: event.clientX, y: event.clientY };
          const next = { x: origin.x + (point.x - start.x) / coordinateScale, y: origin.y + (point.y - start.y) / coordinateScale };
          const callbacks = dragCallbacks.current;
          callbacks.onDragScreenStart?.(card.id, point, dragAnchorRef.current);
          const moved = callbacks.onMoveEnd(card.id, next.x, next.y, { x: next.x + cardW / 2, y: next.y + cardH / 2 }, point);
          callbacks.onDragScreenEnd?.(card.id);
          if (moved === false) {
            const transition = prefersReducedMotion ? { duration: 0 } : { type: 'spring' as const, stiffness: 520, damping: 40, mass: .7 };
            animate(x, origin.x, transition); animate(y, origin.y, transition);
          }
        };
        window.addEventListener('pointerup', release, true);
        window.addEventListener('pointercancel', release, true);
        quickDragCleanup.current = () => {
          window.removeEventListener('pointerup', release, true); window.removeEventListener('pointercancel', release, true);
          quickDragCleanup.current = undefined;
        };
      }
      // Idle photos do not need Motion's continuous layout projection. Arm
      // the existing drag controls synchronously before starting this gesture.
      if (mode === 'sort') flushSync(() => setDragArmed(true));
      dragControls.start(e);
    },
    [appearance, card.id, card.x, card.y, cardW, cardH, mode, coordinateScale, dragControls, dragEnabled, getResizeEdgeFromEvent, isSelected, selectionOnly, onBringToFront, onResizeStart, onSelectCard, onDragScreenStart, prefersReducedMotion, x, y]
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
      ref={elementRef}
      className={`card ${mode === 'setup' ? 'card--setup' : 'card--sort'} ${dragEnabled ? 'card--draggable' : 'card--static'} ${isSelected ? 'isSelected' : ''} ${isDragging ? 'isDragging' : ''} ${
        resizeHotEdge && canResize ? 'isResizeHot' : ''
      } ${
        resizeHotEdge && canResize ? `isResizeHot--${resizeHotEdge}` : ''
      } ${categoryLabel ? 'isCategorized' : ''} ${appearance === 'browser' ? 'card--browser' : ''} ${dimmed && !isSelected ? 'isDimmed' : ''}`}
      data-testid={`${testIdPrefix}-${card.id}`}
      data-category-drop-id={categoryDropId}
      data-arriving={arriving || undefined}
      title={appearance === 'browser' ? [cardLabel, categoryTitle].filter(Boolean).join(' · ') : undefined}
      role={mode === 'setup' && isKeyboardInteractive ? 'button' : mode === 'sort' && isKeyboardInteractive ? 'group' : undefined}
      aria-roledescription={mode === 'sort' && isKeyboardInteractive ? 'movable card' : undefined}
      tabIndex={isKeyboardInteractive ? 0 : -1}
      aria-label={`Card: ${cardLabel}${locationLabel ? `. Current area: ${locationLabel}` : ''}`}
      aria-describedby={isKeyboardInteractive ? keyboardDescriptionId : undefined}
      aria-pressed={mode === 'setup' ? !!isSelected : undefined}
      style={{ x, y, zIndex: card.z, rotate, width: cardW, height: cardH, '--category-color': categoryColor } as MotionStyle}
      drag={dragEnabled && (mode !== 'sort' || dragArmed)}
      layoutDependency={dragArmed}
      dragControls={dragControls}
      dragListener={false}
      dragConstraints={dragConstraintsRef}
      dragMomentum={false}
      dragElastic={0.10}
      // State-driven position. While dragging, Framer temporarily takes over.
      // Give drag controls a starting position before the first motion value exists.
      initial={dealIn && !dealFrom && !prefersReducedMotion ? { x: card.x, y: card.y + 170, opacity: 0 } : { x: card.x, y: card.y }}
      animate={{ x: card.x, y: card.y, opacity: 1 }}
      transition={prefersReducedMotion || instantPosition ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40, mass: 0.7 }}
      whileDrag={{ scale: liftScale * 1.03, boxShadow: 'var(--shadow-lift)' }}
      onPointerDown={event => {
        // A newly added image can be picked up immediately, even mid-arrival.
        if (arriving) { arrivalAnimation.current?.cancel(); setArriving(false); }
        handlePointerDown(event);
      }}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerMove={updateResizeHotEdge}
      onPointerEnter={updateResizeHotEdge}
      onPointerLeave={() => setResizeHotEdge(null)}
      onPointerCancel={() => { setDragArmed(false); quickDragHandled.current = true; dragCancelled.current = true; quickDragCleanup.current?.(); x.set(card.x); y.set(card.y); setResizeHotEdge(null); setIsDragging(false); onDragScreenEnd?.(card.id); }}
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
        if (quickDragHandled.current) { if (dragCancelled.current) { x.set(card.x); y.set(card.y); } return; }
        draggedSincePress.current = true;
        setIsDragging(true);
        rawRotate.set(0);
        onDragTraceStart?.(card.id, card.x, card.y);
        onDragScreenStart?.(card.id, info.point, dragAnchorRef.current);
      }}
      onDragEnd={(e, info) => {
        void e;
        setDragArmed(false);
        setIsDragging(false);
        rawRotate.set(0);
        if (e.type === 'pointercancel') { x.set(card.x); y.set(card.y); onDragScreenEnd?.(card.id); return; }
        if (quickDragHandled.current) { if (dragCancelled.current) { x.set(card.x); y.set(card.y); } return; }
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
      onDoubleClick={event => {
        if (event.shiftKey || event.metaKey || event.ctrlKey) return;
        if (card.kind !== 'text') {
          onOpenPreview?.(card.id);
        }
      }}
    >
      <div className="card__surface">
        <CardPreview card={previewCard} onOpenPreview={onOpenPreview} showPreviewButton={mode !== 'setup'} />

        {categoryLabel ? <span className="card__categoryLabel" title={categoryTitle || categoryLabel}>{categoryLabel.split('/').at(-1)}</span> : null}
        {isSelected && mode === 'sort' && <span className="card__selectedMark" aria-hidden="true">✓</span>}

        {showChrome && mode === 'setup' ? (
          <div className="card__chrome">
            <div className="card__meta">
              <span className="card__tag">{card.meta.name}</span>
            </div>
          </div>
        ) : null}
      </div>
      {imageAction && <div className="card__imageAction" style={{ transform: `scale(${1 / coordinateScale})` }}
        onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>{imageAction}</div>}
    </motion.div>
  );
}

export const DraggableCard = React.memo(DraggableCardComponent, (left, right) => {
  if (!sameCard(left.card, right.card)) return false;
  const keys = Object.keys(left) as Array<keyof DraggableCardProps>;
  return keys.length === Object.keys(right).length && keys.every(key => key === 'card' || Object.is(left[key], right[key]));
});
DraggableCard.displayName = 'DraggableCard';
