import * as React from 'react';
import { getActiveProjectId, listCategories, listImages, listProjects, type LibraryProject, type LibraryImage, type LibraryCategory } from './libraryStore';

/** Project summaries and image collections have independent read/mutation versions. */
export function useProjectLibrary(onError: (message: string) => void) {
  const [projects, setLoadedProjects] = React.useState<LibraryProject[]>([]);
  const [activeId, setActiveId] = React.useState<string>();
  const [images, setLoadedImages] = React.useState<LibraryImage[]>([]);
  const [categories, setCategories] = React.useState<LibraryCategory[]>([]);
  const currentId = React.useRef(activeId);
  const projectVersion = React.useRef(0);
  const collectionVersion = React.useRef(0);
  const requestedCollection = React.useRef<string>();
  const active = React.useRef(true);
  const errors = React.useRef(onError); errors.current = onError;
  const isCurrent = React.useCallback((id: string | undefined, request: number, version: number) =>
    active.current && currentId.current === id && version === request, []);

  const setImages: React.Dispatch<React.SetStateAction<LibraryImage[]>> = React.useCallback(update => {
    collectionVersion.current++; setLoadedImages(update);
  }, []);
  const setProjects: React.Dispatch<React.SetStateAction<LibraryProject[]>> = React.useCallback(update => {
    projectVersion.current++; setLoadedProjects(update);
  }, []);
  const selectProject = React.useCallback((id: string) => {
    if (currentId.current === id) return;
    projectVersion.current++; collectionVersion.current++;
    currentId.current = id; requestedCollection.current = undefined;
    setActiveId(id); setLoadedImages([]); setCategories([]);
  }, []);
  const loadCollection = React.useCallback(async (id: string, request: number) => {
    try {
      const [foundImages, foundCategories] = await Promise.all([listImages(id), listCategories(id)]);
      if (!isCurrent(id, request, collectionVersion.current)) return;
      setLoadedImages(foundImages); setCategories(foundCategories);
      return foundImages;
    } catch (cause) { if (isCurrent(id, request, collectionVersion.current)) throw cause; }
  }, [isCurrent]);

  React.useEffect(() => {
    active.current = true;
    let startup = true;
    const request = projectVersion.current;
    void Promise.all([listProjects(), getActiveProjectId()]).then(([found, stored]) => {
      if (!startup || !active.current) return;
      if (projectVersion.current === request) setLoadedProjects(latest => latest.length ? latest : found);
      if (!currentId.current) {
        const id = found.some(project => project.id === stored) ? stored : found[0]?.id;
        if (id) selectProject(id);
      }
    }).catch(cause => { if (startup) errors.current(String(cause)); });
    return () => { startup = false; active.current = false; projectVersion.current++; collectionVersion.current++; };
  }, [selectProject]);
  React.useEffect(() => {
    // A new-project/import refresh may already own this initial load. Do not
    // invalidate it with a duplicate effect after the active-id render commits.
    if (!activeId || requestedCollection.current === activeId) return;
    requestedCollection.current = activeId;
    const request = ++collectionVersion.current;
    let current = true;
    void loadCollection(activeId, request).catch(cause => { if (current) errors.current(String(cause)); });
    return () => { current = false; };
  }, [activeId, loadCollection]);
  const refresh = React.useCallback(async (id = currentId.current) => {
    if (!active.current || id !== currentId.current) return;
    // Claim both reads before the first await; an older list response cannot
    // supersede a newer refresh, setting change or optimistic board movement.
    const projectRequest = ++projectVersion.current;
    const collectionRequest = ++collectionVersion.current;
    requestedCollection.current = id;
    try {
      const found = await listProjects();
      if (isCurrent(id, projectRequest, projectVersion.current)) setLoadedProjects(found);
      if (id && isCurrent(id, collectionRequest, collectionVersion.current)) return loadCollection(id, collectionRequest);
    } catch (cause) { if (isCurrent(id, projectRequest, projectVersion.current)) throw cause; }
  }, [isCurrent, loadCollection]);
  return { projects, setProjects, activeId, selectProject, images, setImages, categories, refresh };
}
