import * as React from 'react';
import { readStashView, type StashCamera } from './stashView';
import type { LibraryCategory } from './libraryStore';
import type { CameraView } from './camera';

/** Stash scope and its saved camera are independent of browser filters/selection. */
export function useBoardNavigation(projectId: string, categories: LibraryCategory[], initialWidth: number, initialStashId?: string) {
  const [saved] = React.useState(() => readStashView(projectId));
  const [scopeId, setScopeId] = React.useState<string | null>(() => {
    const requested = initialStashId ?? saved.active;
    return categories.some(stash => stash.id === requested) ? requested! : null;
  });
  const scopeRef = React.useRef(scopeId); scopeRef.current = scopeId;
  const cameras = React.useRef<Record<string, StashCamera>>(saved.cameras);
  const timer = React.useRef<number>();
  const [zoom, setZoom] = React.useState(() => cameras.current[scopeId || 'root']?.zoom || 1);
  const zoomRef = React.useRef(zoom); zoomRef.current = zoom;
  const [cameraCenter, setCameraCenter] = React.useState<{ x: number; y: number }>();
  const [boardViewportWidth, setBoardViewportWidth] = React.useState(Math.max(160, initialWidth));
  const [boardWindow, setBoardWindow] = React.useState({ left: -280, top: -280, right: window.innerWidth + 280, bottom: window.innerHeight + 280 });
  const persistCamera = React.useCallback(() => {
    try { localStorage.setItem(`folder-sort-stash-view:${projectId}`, JSON.stringify({ active: scopeRef.current, cameras: cameras.current })); } catch { /* Camera controls work without localStorage. */ }
  }, [projectId]);
  const updateBoardWindow = React.useCallback((view: CameraView) => {
    setBoardViewportWidth(view.viewportW);
    cameras.current[scopeRef.current || 'root'] = { x: view.centerX, y: view.centerY, zoom: view.scale };
    window.clearTimeout(timer.current); timer.current = window.setTimeout(persistCamera, 500);
    const next = {
      left: Math.floor((view.centerX - view.viewportW / view.scale / 2 - 280) / 128) * 128,
      top: Math.floor((view.centerY - view.viewportH / view.scale / 2 - 280) / 128) * 128,
      right: Math.ceil((view.centerX + view.viewportW / view.scale / 2 + 280) / 128) * 128,
      bottom: Math.ceil((view.centerY + view.viewportH / view.scale / 2 + 280) / 128) * 128,
    };
    setBoardWindow(current => Object.keys(next).every(key => current[key as keyof typeof next] === next[key as keyof typeof next]) ? current : next);
  }, [persistCamera]);
  React.useEffect(() => () => { window.clearTimeout(timer.current); persistCamera(); }, [persistCamera]);
  return { scopeId, setScopeId, scopeRef, cameras, zoom, setZoom, zoomRef, cameraCenter, setCameraCenter, boardViewportWidth, boardWindow, updateBoardWindow, persistCamera };
}
