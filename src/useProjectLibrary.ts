import * as React from 'react';
import { getActiveProjectId, listCategories, listImages, listProjects, type LibraryProject, type LibraryImage, type LibraryCategory } from './libraryStore';

/** Project reads share one generation so an older async read cannot replace a newer selection. */
export function useProjectLibrary(onError: (message: string) => void) {
  const [projects, setProjects] = React.useState<LibraryProject[]>([]);
  const [activeId, setActiveId] = React.useState<string>();
  const [images, setImages] = React.useState<LibraryImage[]>([]);
  const [categories, setCategories] = React.useState<LibraryCategory[]>([]);
  const currentId = React.useRef(activeId);
  const generation = React.useRef(0);
  const active = React.useRef(true);
  const errors = React.useRef(onError); errors.current = onError;

  const selectProject = React.useCallback((id: string) => {
    if (currentId.current === id) return;
    generation.current++;
    currentId.current = id;
    setActiveId(id); setImages([]); setCategories([]);
  }, []);
  const loadCollection = React.useCallback(async (id: string) => {
    const request = currentId.current === id ? ++generation.current : generation.current;
    const [foundImages, foundCategories] = await Promise.all([listImages(id), listCategories(id)]);
    if (active.current && currentId.current === id && generation.current === request) {
      setImages(foundImages); setCategories(foundCategories);
    }
    return foundImages;
  }, []);
  React.useEffect(() => {
    active.current = true;
    let startup = true;
    void Promise.all([listProjects(), getActiveProjectId()]).then(([found, stored]) => {
      if (!startup || !active.current) return;
      setProjects(latest => latest.length ? latest : found);
      if (!currentId.current) {
        const id = found.some(project => project.id === stored) ? stored : found[0]?.id;
        if (id) selectProject(id);
      }
    }).catch(cause => { if (startup) errors.current(String(cause)); });
    return () => { startup = false; active.current = false; generation.current++; };
  }, [selectProject]);
  React.useEffect(() => {
    if (!activeId) return;
    let current = true;
    void loadCollection(activeId).catch(cause => { if (current) errors.current(String(cause)); });
    return () => { current = false; };
  }, [activeId, loadCollection]);
  const refresh = React.useCallback(async (id = currentId.current) => {
    const found = await listProjects();
    if (active.current && currentId.current === id) setProjects(found);
    if (id) return loadCollection(id);
  }, [loadCollection]);
  return { projects, setProjects, activeId, selectProject, images, setImages, categories, refresh };
}
