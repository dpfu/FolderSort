import * as React from 'react';
import { RequestOwner } from './requestOwner';
import { getActiveProjectId, listCategories, listImages, listProjects, type LibraryProject, type LibraryImage, type LibraryCategory } from './libraryStore';

type Collection = { phase: 'unselected' | 'loading' | 'ready' | 'error'; images: LibraryImage[]; categories: LibraryCategory[] };
const emptyCollection: Collection = { phase: 'unselected', images: [], categories: [] };

/** Project summaries and collections have independent request ownership and mutation invalidation. */
export function useProjectLibrary(onError: (message: string) => void) {
  const [projects, setLoadedProjects] = React.useState<LibraryProject[]>([]);
  const [activeId, setActiveId] = React.useState<string>();
  const [collection, setCollection] = React.useState<Collection>(emptyCollection);
  const currentId = React.useRef(activeId), requestedCollection = React.useRef<string>();
  const [projectReads] = React.useState(() => new RequestOwner());
  const [collectionReads] = React.useState(() => new RequestOwner());
  const [lifetime] = React.useState(() => new RequestOwner());
  const errors = React.useRef(onError); errors.current = onError;
  const setImages: React.Dispatch<React.SetStateAction<LibraryImage[]>> = React.useCallback(update => {
    collectionReads.invalidate();
    setCollection(current => ({ ...current, phase: 'ready', images: typeof update === 'function' ? update(current.images) : update }));
  }, [collectionReads]);
  const setProjects: React.Dispatch<React.SetStateAction<LibraryProject[]>> = React.useCallback(update => {
    projectReads.invalidate(); setLoadedProjects(update);
  }, [projectReads]);
  const selectProject = React.useCallback((id: string) => {
    if (currentId.current === id) return;
    projectReads.invalidate(); collectionReads.invalidate(); currentId.current = id; requestedCollection.current = undefined;
    setActiveId(id); setCollection(emptyCollection);
  }, [projectReads, collectionReads]);
  const loadCollection = React.useCallback(async (id: string, ticket: object) => {
    try {
      const [images, categories] = await Promise.all([listImages(id), listCategories(id)]);
      if (!collectionReads.owns(ticket) || currentId.current !== id) return;
      setCollection({ phase: 'ready', images, categories }); return images;
    } catch (cause) {
      if (collectionReads.owns(ticket) && currentId.current === id) {
        setCollection(current => ({ ...current, phase: 'error' })); throw cause;
      }
    }
  }, [collectionReads]);
  React.useEffect(() => {
    lifetime.activate(); projectReads.activate(); collectionReads.activate();
    const startup = lifetime.begin(), ticket = projectReads.begin();
    void Promise.all([listProjects(), getActiveProjectId()]).then(([found, stored]) => {
      if (!lifetime.owns(startup)) return;
      if (projectReads.owns(ticket)) setLoadedProjects(latest => latest.length ? latest : found);
      if (!currentId.current) {
        const id = found.some(project => project.id === stored) ? stored : found[0]?.id;
        if (id) selectProject(id);
      }
    }).catch(cause => { if (lifetime.owns(startup)) errors.current(String(cause)); });
    return () => { lifetime.deactivate(); projectReads.deactivate(); collectionReads.deactivate(); requestedCollection.current = undefined; };
  }, [lifetime, projectReads, collectionReads, selectProject]);
  React.useEffect(() => {
    if (!activeId || requestedCollection.current === activeId) return;
    requestedCollection.current = activeId;
    const ticket = collectionReads.begin();
    setCollection(current => ({ ...current, phase: 'loading' }));
    void loadCollection(activeId, ticket).catch(cause => { if (collectionReads.owns(ticket)) errors.current(String(cause)); });
  }, [activeId, collectionReads, loadCollection]);
  const refresh = React.useCallback(async (id = currentId.current) => {
    if (!lifetime.isActive || id !== currentId.current) return;
    const projectTicket = projectReads.begin(), collectionTicket = collectionReads.begin();
    requestedCollection.current = id;
    try {
      const found = await listProjects();
      if (projectReads.owns(projectTicket) && id === currentId.current) setLoadedProjects(found);
      if (id && collectionReads.owns(collectionTicket) && id === currentId.current) return loadCollection(id, collectionTicket);
    } catch (cause) { if (projectReads.owns(projectTicket) && id === currentId.current) throw cause; }
  }, [lifetime, projectReads, collectionReads, loadCollection]);
  return { projects, setProjects, activeId, selectProject, images: collection.images, setImages, categories: collection.categories, collectionPhase: collection.phase, refresh };
}
