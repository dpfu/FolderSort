import * as React from 'react';
import { CameraPlacement } from './cameraPlacement';
import { boardPanGutter, type CameraView } from './camera';
import type { CameraFrameSource } from './types';

export function useBoardCamera(
  boardRef: React.RefObject<HTMLDivElement>,
  worldSize: { width: number; height: number } | undefined,
  scale: number,
  requested: { x: number; y: number } | undefined,
  onViewChange?: (view: CameraView, source: CameraFrameSource) => void,
) {
  const [placement] = React.useState(() => new CameraPlacement());
  const suppressScroll = React.useRef(false);
  const nativeIntent = React.useRef(0),
    restoreFrame = React.useRef<number>();
  const focusUntil = React.useRef(0);
  const allowNativeScroll = React.useCallback(() => {
    nativeIntent.current = performance.now() + 120;
  }, []);
  const guardFocusScroll = React.useCallback((preserve: boolean) => {
    focusUntil.current = preserve ? performance.now() + 180 : 0;
  }, []);
  React.useEffect(() => () => cancelAnimationFrame(restoreFrame.current!), []);
  const geometry = React.useCallback(() => {
    const board = boardRef.current;
    if (!board || !worldSize) return;
    const gutter = boardPanGutter(worldSize.width, worldSize.height);
    return {
      board,
      left:
        gutter.x * scale +
        (Math.max(board.clientWidth, worldSize.width * scale) - worldSize.width * scale) / 2,
      top:
        gutter.y * scale +
        (Math.max(board.clientHeight, worldSize.height * scale) - worldSize.height * scale) / 2,
    };
  }, [boardRef, scale, worldSize]);
  const read = React.useCallback((): CameraView | null => {
    const frame = geometry();
    if (!frame) return null;
    const { board, left, top } = frame;
    return {
      scale,
      centerX: (board.scrollLeft + board.clientWidth / 2 - left) / scale,
      centerY: (board.scrollTop + board.clientHeight / 2 - top) / scale,
      viewportW: Math.max(1, board.clientWidth),
      viewportH: Math.max(1, board.clientHeight),
    };
  }, [geometry, scale]);
  const emit = React.useCallback(
    (source: CameraFrameSource) => {
      const view = read();
      if (!view) return;
      placement.observe({ x: view.centerX, y: view.centerY });
      onViewChange?.(view, source);
    },
    [read, onViewChange, placement],
  );
  const place = React.useCallback(
    (target: { x: number; y: number }) => {
      const frame = geometry();
      if (!frame) return;
      suppressScroll.current = true;
      frame.board.scrollLeft = Math.max(
        0,
        frame.left + target.x * scale - frame.board.clientWidth / 2,
      );
      frame.board.scrollTop = Math.max(
        0,
        frame.top + target.y * scale - frame.board.clientHeight / 2,
      );
    },
    [geometry, scale],
  );
  React.useLayoutEffect(() => {
    if (!worldSize) return;
    const task = placement.begin(requested, { x: worldSize.width / 2, y: worldSize.height / 2 });
    place(task.target);
    emit('zoom');
    const frame = requestAnimationFrame(() => {
      if (!placement.owns(task)) return;
      // Browser expansion and native focus can reflow the scroller in this frame.
      place(task.target);
      const view = read();
      if (view) placement.finish(task, { x: view.centerX, y: view.centerY });
      suppressScroll.current = false;
      emit('zoom');
    });
    return () => cancelAnimationFrame(frame);
  }, [worldSize, requested, placement, place, read, emit]);
  React.useEffect(() => {
    const board = boardRef.current;
    if (!board || !worldSize || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!placement.placing) emit('resize');
    });
    observer.observe(board);
    return () => observer.disconnect();
  }, [boardRef, worldSize, emit, placement]);
  const onScroll = React.useCallback(() => {
    const view = read(),
      center = placement.center;
    if (!view || !center) return;
    if (
      suppressScroll.current &&
      Math.abs(view.centerX - center.x) < 1 &&
      Math.abs(view.centerY - center.y) < 1
    )
      return;
    if (performance.now() <= nativeIntent.current || performance.now() > focusUntil.current) {
      // A deliberate pan can supersede a settling placement. Keep normal
      // programmatic scrolling usable for camera consumers as well.
      placement.interrupt({ x: view.centerX, y: view.centerY });
      suppressScroll.current = false;
      emit('pan');
      return;
    }
    // Native focus/reveal can scroll a large transformed canvas even when its
    // control is visible. Focus does not own a new camera position.
    place(center);
    cancelAnimationFrame(restoreFrame.current!);
    restoreFrame.current = requestAnimationFrame(() => {
      suppressScroll.current = false;
    });
  }, [emit, place, read, placement]);
  return {
    onScroll,
    allowNativeScroll,
    guardFocusScroll,
    readCameraView: read,
    emitCameraView: emit,
    placeCamera: place,
    suppressCameraScrollRef: suppressScroll,
  };
}
