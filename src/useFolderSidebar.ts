import * as React from 'react';
import { folderAncestors } from './folderTree';
import { parentPath } from './stashGeometry';
import type { LibraryCategory } from './libraryStore';

export type FolderSidebarView = { open: boolean; width: number; expanded: string[] };
export const MIN_FOLDER_SIDEBAR_WIDTH = 210, MAX_FOLDER_SIDEBAR_WIDTH = 340;
const key = (projectId: string) => `folder-sort-folder-sidebar:${projectId}`;
export function readFolderSidebar(projectId: string): FolderSidebarView {
  try {
    const saved = JSON.parse(localStorage.getItem(key(projectId)) || 'null');
    return { open: saved?.open === true,
      width: Number.isFinite(saved?.width) ? Math.max(MIN_FOLDER_SIDEBAR_WIDTH, Math.min(MAX_FOLDER_SIDEBAR_WIDTH, saved.width)) : 260,
      expanded: Array.isArray(saved?.expanded) ? [...new Set<string>(saved.expanded.filter((id: unknown): id is string => typeof id === 'string'))] : [] };
  } catch { return { open: false, width: 260, expanded: [] }; }
}

/** Per-project presentation preferences, separate from projects, paths and Undo. */
export function useFolderSidebar(projectId: string, categories: LibraryCategory[], currentId: string | null) {
  const [view, setView] = React.useState(() => readFolderSidebar(projectId));
  const latest = React.useRef(view); latest.current = view;
  const previousNames = React.useRef<Map<string, string>>();
  const currentPath = categories.find(folder => folder.id === currentId)?.name;
  React.useEffect(() => {
    const parents = folderAncestors(categories, currentId);
    setView(previous => parents.every(id => previous.expanded.includes(id)) ? previous : { ...previous, expanded: [...new Set([...previous.expanded, ...parents])] });
  }, [currentId, currentPath]);
  React.useEffect(() => {
    const previous = previousNames.current;
    previousNames.current = new Map(categories.map(folder => [folder.id, folder.name]));
    if (!previous) return;
    const changed = categories.filter(folder => previous.has(folder.id) && previous.get(folder.id) !== folder.name);
    const changedPaths = new Set(changed.map(folder => folder.name.toLocaleLowerCase()));
    const movedRoots = changed.filter(folder => {
      for (let path = parentPath(folder.name).toLocaleLowerCase(); path; path = parentPath(path)) if (changedPaths.has(path)) return false;
      return true;
    });
    const parents = movedRoots.flatMap(folder => folderAncestors(categories, folder.id).filter(id => id !== folder.id));
    if (parents.length) setView(previous => parents.every(id => previous.expanded.includes(id)) ? previous : { ...previous, expanded: [...new Set([...previous.expanded, ...parents])] });
  }, [categories]);
  React.useEffect(() => {
    const save = () => { try { localStorage.setItem(key(projectId), JSON.stringify(latest.current)); } catch { /* The panel also works without storage. */ } };
    const timer = window.setTimeout(save, 150);
    return () => window.clearTimeout(timer);
  }, [projectId, view]);
  React.useEffect(() => {
    const save = () => { try { localStorage.setItem(key(projectId), JSON.stringify(latest.current)); } catch { /* Preferences are optional. */ } };
    window.addEventListener('pagehide', save);
    return () => { window.removeEventListener('pagehide', save); save(); };
  }, [projectId]);
  return [view, setView] as const;
}
