export type StashCamera = { x: number; y: number; zoom: number };
export type StashView = { active: string | null; cameras: Record<string, StashCamera> };
export const MIN_BOARD_ZOOM = .05;

/** Fit changes the camera, never the saved layout. */
export function fitBoardView(items: Array<{ x: number; y: number; width: number; height: number }>, width: number, height: number) {
  if (!items.length) return { x: width / 2, y: height / 2, zoom: 1 };
  const left = Math.min(...items.map(item => item.x)), top = Math.min(...items.map(item => item.y));
  const right = Math.max(...items.map(item => item.x + item.width)), bottom = Math.max(...items.map(item => item.y + item.height));
  return { x: (left + right) / 2, y: (top + bottom) / 2,
    zoom: Math.max(MIN_BOARD_ZOOM, Math.min(1, (width - 64) / Math.max(1, right - left), (height - 64) / Math.max(1, bottom - top))) };
}

/** Minimal camera adjustment to reveal a new/returned stack, preserving its layout. */
export function revealBoardItem(item: { x: number; y: number; width: number; height: number }, camera: StashCamera, width: number, height: number): StashCamera {
  const zoom = Math.max(MIN_BOARD_ZOOM, Math.min(camera.zoom, Math.max(1, width - 32) / item.width, Math.max(1, height - 32) / item.height));
  const halfW = Math.max(1, width - 32) / zoom / 2, halfH = Math.max(1, height - 32) / zoom / 2;
  return { zoom, x: Math.max(item.x + item.width - halfW, Math.min(camera.x, item.x + halfW)),
    y: Math.max(item.y + item.height - halfH, Math.min(camera.y, item.y + halfH)) };
}

/** Browser preferences may be stale or malformed; they must never break sorting. */
export function readStashView(projectId: string): StashView {
  const fallback: StashView = { active: null, cameras: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(`folder-sort-stash-view:${projectId}`) || 'null');
    if (!saved || typeof saved !== 'object') return fallback;
    const cameras: Record<string, StashCamera> = {};
    if (saved.cameras && typeof saved.cameras === 'object' && !Array.isArray(saved.cameras)) {
      for (const [id, camera] of Object.entries(saved.cameras).slice(0, 10000)) {
        const point = camera as StashCamera;
        if (id !== '__proto__' && point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
          Math.abs(point.x) <= 1_000_000 && Math.abs(point.y) <= 1_000_000 && Number.isFinite(point.zoom) && point.zoom >= MIN_BOARD_ZOOM && point.zoom <= 2) {
          cameras[id] = { x: point.x, y: point.y, zoom: point.zoom };
        }
      }
    }
    return { active: typeof saved.active === 'string' ? saved.active : null, cameras };
  } catch { return fallback; }
}
