import type { CameraView } from './camera';
import { MIN_BOARD_ZOOM } from './stashView';

export type GesturePoint = { x: number; y: number };
export type GestureCamera = Pick<CameraView, 'scale' | 'centerX' | 'centerY'>;
export type GestureAnchor = { world: GesturePoint; camera: CameraView };

export function anchorBoardGesture(camera: CameraView, point: GesturePoint): GestureAnchor {
  return { camera, world: { x: camera.centerX + (point.x - camera.viewportW / 2) / camera.scale,
    y: camera.centerY + (point.y - camera.viewportH / 2) / camera.scale } };
}

/** Keep the world point under the fingers/cursor while zooming and translating. */
export function moveBoardGesture(anchor: GestureAnchor, point: GesturePoint, factor = 1): GestureCamera {
  const scale = Math.max(MIN_BOARD_ZOOM, Math.min(2, anchor.camera.scale * (Number.isFinite(factor) && factor > 0 ? factor : 1)));
  return { scale, centerX: anchor.world.x - (point.x - anchor.camera.viewportW / 2) / scale,
    centerY: anchor.world.y - (point.y - anchor.camera.viewportH / 2) / scale };
}
