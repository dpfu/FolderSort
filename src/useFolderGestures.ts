import * as React from 'react';
import { PointerSession } from './pointerSession';
import { useStableCallback } from './useStableCallback';
import type { BoardPoint } from './categoryBoard';
import type { StashTile } from './stashBoard';

type Point = BoardPoint;
type Taking = { id: string; x: number; y: number; anchor: Point; started: boolean };
type Moving = { x: number; y: number; delta: Point };
type Options = {
  group: StashTile;
  zoom: number;
  busy: boolean;
  onMove: (group: StashTile, delta: Point) => void;
  onPreviewMove: (group: StashTile, delta: Point) => void;
  onCancelMove: () => void;
  onImageStart: (id: string, point: Point, anchor: Point) => void;
  onImageMove: (id: string, point: Point) => void;
  onImageEnd: () => void;
  onImageDrop: (id: string, groupId: string, point: Point) => void;
  onOpen: (id: string) => void;
};
export function useFolderGestures(options: Options) {
  const { group, zoom, busy } = options;
  const [move] = React.useState(() => new PointerSession<Moving>());
  const [take] = React.useState(() => new PointerSession<Taking>());
  const [takingOut, setTakingOut] = React.useState(false);
  const dragged = React.useRef(false),
    dropFrame = React.useRef<number>();
  const endImage = useStableCallback(options.onImageEnd);
  const cancelMove = useStableCallback(options.onCancelMove);
  const cancelImage = () => {
    if (take.cancel()?.started) endImage();
    setTakingOut(false);
  };
  React.useEffect(
    () => () => {
      if (dropFrame.current !== undefined) cancelAnimationFrame(dropFrame.current);
      if (take.cancel()?.started || dropFrame.current !== undefined) endImage();
      if (move.cancel()) cancelMove();
    },
    [take, move, endImage, cancelMove],
  );
  const handle: React.HTMLAttributes<HTMLButtonElement> = {
    onPointerDown: (event) => {
      if (
        event.button !== 0 ||
        busy ||
        !move.begin(event.pointerId, { x: event.clientX, y: event.clientY, delta: { x: 0, y: 0 } })
      )
        return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event) => {
      const current = move.read(event.pointerId);
      if (!current) return;
      current.delta = {
        x: Math.max(-group.x + 8, (event.clientX - current.x) / zoom),
        y: Math.max(-group.y + 8, (event.clientY - current.y) / zoom),
      };
      options.onPreviewMove(group, current.delta);
    },
    onPointerUp: (event) => {
      const current = move.finish(event.pointerId);
      if (!current) return;
      if (Math.hypot(current.delta.x, current.delta.y) > 4 / zoom)
        options.onMove(group, current.delta);
      else options.onCancelMove();
    },
    onPointerCancel: (event) => {
      if (move.finish(event.pointerId)) options.onCancelMove();
    },
    onLostPointerCapture: (event) => {
      if (move.finish(event.pointerId)) options.onCancelMove();
    },
    onKeyDown: (event) => {
      if (!event.key.startsWith('Arrow')) return;
      event.preventDefault();
      const n = event.shiftKey ? 48 : 16;
      options.onMove(group, {
        x: event.key === 'ArrowLeft' ? -n : event.key === 'ArrowRight' ? n : 0,
        y: event.key === 'ArrowUp' ? -n : event.key === 'ArrowDown' ? n : 0,
      });
    },
  };
  const top: React.HTMLAttributes<HTMLButtonElement> = {
    onPointerDown: (event) => {
      if (
        event.button !== 0 ||
        busy ||
        dropFrame.current !== undefined ||
        !group.topImageId ||
        take.current
      )
        return;
      event.stopPropagation();
      dragged.current = false;
      const rect = event.currentTarget.getBoundingClientRect(),
        thumbnail = event.currentTarget.querySelector('img');
      const ratio =
        thumbnail?.naturalWidth && thumbnail.naturalHeight
          ? thumbnail.naturalWidth / thumbnail.naturalHeight
          : 1;
      const anchor = {
        x: 0.5 + ((event.clientX - rect.left) / rect.width - 0.5) * Math.min(1, ratio),
        y: 0.5 + ((event.clientY - rect.top) / rect.height - 0.5) * Math.min(1, 1 / ratio),
      };
      take.begin(event.pointerId, {
        id: group.topImageId,
        x: event.clientX,
        y: event.clientY,
        anchor,
        started: false,
      });
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event) => {
      const current = take.read(event.pointerId);
      if (!current) return;
      const point = { x: event.clientX, y: event.clientY };
      if (!current.started && Math.hypot(point.x - current.x, point.y - current.y) >= 5) {
        current.started = true;
        dragged.current = true;
        setTakingOut(true);
        options.onImageStart(current.id, point, current.anchor);
      }
      if (current.started) options.onImageMove(current.id, point);
    },
    onPointerUp: (event) => {
      const current = take.finish(event.pointerId);
      if (!current) return;
      setTakingOut(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      if (current.started) {
        const point = { x: event.clientX, y: event.clientY };
        // Keep the native release ahead of saving, which disables this source.
        dropFrame.current = requestAnimationFrame(() => {
          dropFrame.current = undefined;
          options.onImageDrop(current.id, group.id, point);
          endImage();
        });
      }
    },
    onPointerCancel: (event) => {
      if (take.read(event.pointerId)) cancelImage();
    },
    onLostPointerCapture: (event) => {
      if (take.read(event.pointerId)) cancelImage();
    },
    onClick: (event) => {
      if (dragged.current && (event.detail > 0 || (event.nativeEvent as PointerEvent).pointerType))
        return;
      options.onOpen(group.id);
    },
  };
  return { handle, top, takingOut };
}
