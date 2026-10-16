export type CategoryBoardMode = 'free' | 'stacks' | 'linked';
export type BoardPoint = { x: number; y: number };
export type CategoryBoardPreferences = { mode: CategoryBoardMode; anchors: Record<string, BoardPoint>; expanded: string[]; autoNext: boolean };
export type CategoryBoardGroup = BoardPoint & { id: string; name: string; ids: string[]; width: number; height: number; expanded: boolean };
export const BOARD_IMAGE_SIZE = 172;

export function readBoardPreferences(projectId: string): CategoryBoardPreferences {
  const fallback: CategoryBoardPreferences = { mode: 'free', anchors: {}, expanded: [], autoNext: false };
  try {
    const saved = JSON.parse(localStorage.getItem(`folder-sort-board:${projectId}`) || 'null');
    if (!saved || typeof saved !== 'object') return fallback;
    const anchors: Record<string, BoardPoint> = {};
    for (const [id, point] of Object.entries(saved.anchors || {}).slice(0, 10000)) {
      const p = point as BoardPoint;
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0) anchors[id] = { x: Math.min(100000, p.x), y: Math.min(1000000, p.y) };
    }
    return { mode: ['free', 'stacks', 'linked'].includes(saved.mode) ? saved.mode : 'free', anchors,
      expanded: Array.isArray(saved.expanded) ? saved.expanded.filter((id: unknown) => typeof id === 'string').slice(0, 10000) : [], autoNext: saved.autoNext === true };
  } catch { return fallback; }
}
