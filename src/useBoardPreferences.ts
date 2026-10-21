import * as React from 'react';
import { readBoardPreferences, type BoardPoint } from './categoryBoard';

type AnchorRestore = (stashId: string, point: BoardPoint) => void;
const activeBoards = new Map<string, Set<AnchorRestore>>();

// History outlives a workspace mount. Restore the currently open board, even if
// the action was recorded by an earlier instance of that workspace.
export function restoreStashAnchor(projectId: string, stashId: string, point: BoardPoint) {
  const saved = readBoardPreferences(projectId);
  try { localStorage.setItem(`folder-sort-board:${projectId}`, JSON.stringify({ ...saved, anchors: { ...saved.anchors, [stashId]: point } })); }
  catch { /* An open board can still recover in memory. */ }
  activeBoards.get(projectId)?.forEach(restore => restore(stashId, point));
}

export function useBoardPreferences(projectId: string) {
  const [preferences, setPreferences] = React.useState(() => readBoardPreferences(projectId));
  React.useLayoutEffect(() => {
    const restore: AnchorRestore = (stashId, point) => setPreferences(current => ({ ...current, anchors: { ...current.anchors, [stashId]: point } }));
    const listeners = activeBoards.get(projectId) || new Set<AnchorRestore>();
    listeners.add(restore); activeBoards.set(projectId, listeners);
    return () => { listeners.delete(restore); if (!listeners.size) activeBoards.delete(projectId); };
  }, [projectId]);
  React.useEffect(() => {
    try { localStorage.setItem(`folder-sort-board:${projectId}`, JSON.stringify(preferences)); }
    catch { /* Viewing preferences must not prevent sorting. */ }
  }, [projectId, preferences]);
  return [preferences, setPreferences] as const;
}
