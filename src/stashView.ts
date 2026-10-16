export type StashCamera = { x: number; y: number; zoom: number };
export type StashView = { active: string | null; cameras: Record<string, StashCamera> };

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
          Math.abs(point.x) <= 1_000_000 && Math.abs(point.y) <= 1_000_000 && Number.isFinite(point.zoom) && point.zoom >= .45 && point.zoom <= 2) {
          cameras[id] = { x: point.x, y: point.y, zoom: point.zoom };
        }
      }
    }
    return { active: typeof saved.active === 'string' ? saved.active : null, cameras };
  } catch { return fallback; }
}
