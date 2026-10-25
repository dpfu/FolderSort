import { useProjectLibrary } from './useProjectLibrary';
import { useActionHistory, type RenameStash } from './useActionHistory';
import { useBoardActions } from './useBoardActions';
import * as React from 'react';
import ImageViewer from './ImageViewer';
import Modal from './Modal';
import UndoControl, { type UndoView } from './UndoControl';
import MenuBar from './MenuBar';
import ProjectScreen from './ProjectScreen';
import { importImages } from './imageImport';
import { readImageBrowserView } from './imageBrowserView';
import ProjectSettings from './ProjectSettings';
import { ContentIndexProvider } from './ContentIndex';
import { ActionButton } from './UiActions';
import './project-shell.css';
import { useThumbnailCache } from './imageThumbnails';
import { FolderInput, FolderOpen } from 'lucide-react';
import {
  assignImageCategories, cleanRelativePath, createProject, exportProjectDirectory, exportProjectZip,
  exportSortedDirectory, exportSortedZip, isImageFile,
  importProjectDirectory, importProjectZip,
  createStashWithImages, undoStashCreation, removeEmptyStash, restoreEmptyStash, removeImageWithUndo, restoreRemovedImage, restoreImageStates, renameCategory, renameProject, prepareStashBoard, setActiveProjectId, projectClipEnabled, setProjectClipEnabled,
  type CategoryAssignment, type ImageRestoreState, type IncomingImage, type LibraryImage,
} from './libraryStore';
import { proposedSourceCategories, sourceCategoryForPath } from './folderCategories';
import { planStashAssignments } from './stashPlacement';
import { readBoardPreferences } from './categoryBoard';
import SortingWorkspace from './SortingWorkspace';
import { download, safeFilename } from './download';

type SortView = 'library' | 'sort';

type Entry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (success: (file: File) => void, error: (error: Error) => void) => void;
  createReader?: () => { readEntries: (success: (entries: Entry[]) => void, error: (error: Error) => void) => void };
};

async function droppedFiles(transfer: DataTransfer): Promise<IncomingImage[]> {
  const collect = async (entry: Entry, parent = ''): Promise<IncomingImage[]> => {
    const path = parent ? `${parent}/${entry.name}` : entry.name;
    if (entry.isFile && entry.file) {
      const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
      return [{ file, path }];
    }
    if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader();
      const children: Entry[] = [];
      // Chromium returns at most 100 entries per call, so continue until empty.
      while (true) {
        const batch = await new Promise<Entry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        children.push(...batch);
      }
      const nested = await Promise.all(children.map((child) => collect(child, path)));
      return nested.flat();
    }
    return [];
  };
  const entries = [...transfer.items].filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() as Entry | null)
    .filter((entry): entry is Entry => Boolean(entry));
  if (entries.length) return (await Promise.all(entries.map((entry) => collect(entry)))).flat();
  return [...transfer.files].map((file) => ({ file, path: file.name }));
}

function nameFromIncomingFolder(items: IncomingImage[]): string {
  const roots = new Set(items.map((item) => cleanRelativePath(item.path).split('/')[0]));
  return roots.size === 1 && items.some((item) => item.path.includes('/')) ? [...roots][0] : 'Untitled project';
}

export default function LibraryApp() {
  const [error, setError] = React.useState('');
  const { projects, setProjects, activeId, selectProject, images, setImages, categories, refresh: refreshCollection } = useProjectLibrary(setError);
  const [pendingImport, setPendingImport] = React.useState<IncomingImage[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState('');
  const [boardSaves, setBoardSaves] = React.useState(0);
  const [message, setMessage] = React.useState('');
  const [view, setView] = React.useState<SortView>('library');
  const [selected, setSelected] = React.useState<LibraryImage>();
  const [reviewContext, setReviewContext] = React.useState<{ ids: string[]; parentId: string | null }>();
  const [initialBrowser, setInitialBrowser] = React.useState(false);
  const [initialStashId, setInitialStashId] = React.useState<string>();
  const [recentImport, setRecentImport] = React.useState<{ projectId: string; ids: string[] }>();
  const [importedImageIds, setImportedImageIds] = React.useState<string[]>();
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const settingsLock = React.useRef(false);
  const stashDeleteLock = React.useRef(false);
  const history = useActionHistory(activeId);
  const undoAction = history.current;
  const undoLock = React.useRef(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const folderInput = React.useRef<HTMLInputElement>(null);
  const importZipInput = React.useRef<HTMLInputElement>(null);
  const importFolderInput = React.useRef<HTMLInputElement>(null);
  const active = projects.find((project) => project.id === activeId);
  const importedCount = React.useMemo(() => {
    if (!recentImport || recentImport.projectId !== activeId) return 0;
    const ids = new Set(recentImport.ids);
    return images.filter(image => ids.has(image.id)).length;
  }, [recentImport, activeId, images]);

  React.useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '');
    importFolderInput.current?.setAttribute('webkitdirectory', '');
  }, [view, activeId]);

  const refresh = async (id = activeId) => {
    const found = await refreshCollection(id);
    if (found) setSelected(current => current && current.projectId === id ? found.find(image => image.id === current.id) : current);
    return found;
  };
  const boardActions = useBoardActions({ projectId: activeId, images, setImages, onRefresh: refresh,
    onError: setError, onMessage: setMessage, onSaving: setBoardSaves,
    remember: history.remember, invalidateFrom: history.invalidateFrom });

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage(''); setProgress(label);
    try { await action(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false; }
    finally { setBusy(false); setProgress(''); }
  };

  const undoRecent = async () => {
    if (!undoAction || busy || boardSaves || undoLock.current) return;
    undoLock.current = true;
    try {
      await run('Restoring your last change…', async () => {
        await undoAction.restore();
        await refresh(activeId);
        history.pop(undoAction.id); setMessage(undoAction.restored);
      });
    } finally { undoLock.current = false; }
  };
  React.useEffect(() => {
    const undoKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !undoAction || busy || boardSaves || event.shiftKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault(); void undoRecent();
    };
    document.addEventListener('keydown', undoKey);
    return () => document.removeEventListener('keydown', undoKey);
  }, [undoAction, busy, boardSaves, activeId]);

  const rememberCategoryChange = (projectId: string, previous: LibraryImage[], assignments: CategoryAssignment[], saved: LibraryImage[]) => {
    const byId = new Map(assignments.map(item => [item.id, item.categoryId]));
    const updates = new Map(saved.map(image => [image.id, image]));
    const changed = previous.filter(image => { const next = updates.get(image.id); return next && (next.categoryId !== image.categoryId || next.stashOrder !== image.stashOrder || next.boardScope !== image.boardScope || next.placement !== image.placement || next.rootOnBoard !== image.rootOnBoard || next.boardX !== image.boardX || next.boardY !== image.boardY); });
    if (!changed.length) return;
    const states: ImageRestoreState[] = changed.map(image => ({ id: image.id, categoryId: image.categoryId, stashOrder: image.stashOrder, board: { placement: image.placement, boardScope: image.boardScope, boardX: image.boardX, boardY: image.boardY, rootOnBoard: image.rootOnBoard } }));
    const removing = changed.every(image => byId.get(image.id) === null);
    history.remember({ projectId, kind: 'category',
      message: removing ? `Moved ${changed.length === 1 ? 'this image' : `${changed.length.toLocaleString()} images`} to Root.` : `Moved ${changed.length === 1 ? 'this image' : `${changed.length.toLocaleString()} images`} into a stash.`,
      detail: 'Undo restores their previous folders and positions.', label: 'Undo stash move', restored: 'Previous folders and positions restored.',
      restore: () => restoreImageStates(projectId, states),
    });
  };

  const ingest = async (items: IncomingImage[], useSourceFolders = false) => {
    await run('Adding images…', async () => {
      const projectId = activeId || (await createProject(nameFromIncomingFolder(items))).id;
      if (!activeId) selectProject(projectId);
      setRecentImport(undefined);
      const result = await importImages(projectId, items, useSourceFolders, (done, total) => setProgress(`Adding images… ${done}/${total}`)).catch(async cause => {
        // Each original is atomic. Show any completed imports after a later
        // quota/decode/storage failure instead of hiding them until reload.
        await refresh(projectId).catch(() => {});
        throw cause;
      });
      const imported = await refresh(projectId);
      const skipped = [result.duplicates && `${result.duplicates} duplicate ${result.duplicates === 1 ? 'path' : 'paths'}`, result.unsupported && `${result.unsupported} unsupported ${result.unsupported === 1 ? 'file' : 'files'}`].filter(Boolean);
      setMessage(`${result.added} image${result.added === 1 ? '' : 's'} added${skipped.length ? `; skipped ${skipped.join(' and ')}` : ''}. Saved locally.`);
      if (result.ids.length) setRecentImport({ projectId, ids: result.ids });
      // Compare against the saved collection, rather than possibly stale React
      // state during startup. Only the first successful image import enters sort.
      if (result.added > 0 && imported?.length === result.added) setView('sort');
    });
  };

  const beginImport = (items: IncomingImage[]) => {
    if (!items.length) return;
    if (!items.some((item) => isImageFile(item.file))) { setError('No supported images found. Try PNG, JPG/JPEG, GIF, WebP, AVIF, or SVG files.'); return; }
    if (proposedSourceCategories(items).length) setPendingImport(items);
    else void ingest(items);
  };

  const resetViews = () => {
    setView('library'); setInitialBrowser(false); setInitialStashId(undefined); setImportedImageIds(undefined); setRecentImport(undefined); setReviewContext(undefined); setSettingsOpen(false);
  };

  const openView = () => {
    setInitialBrowser(false); setInitialStashId(undefined); setImportedImageIds(undefined);
    setView('sort');
    setError(''); setMessage('');
    window.requestAnimationFrame(() => window.scrollTo(0, 0));
  };

  const openStash = (id: string) => {
    if (!activeId || !categories.some(stash => stash.id === id)) return;
    void run('Opening stash…', async () => {
      const browser = readImageBrowserView(activeId);
      const width = window.innerWidth <= 700 ? window.innerWidth : window.innerWidth - Math.min(browser.collapsed ? 48 : browser.width, window.innerWidth * .42);
      if (await prepareStashBoard(activeId, id, width, readBoardPreferences(activeId).anchors)) await refresh(activeId);
      setInitialStashId(id); setInitialBrowser(false); setImportedImageIds(undefined); setView('sort');
      window.requestAnimationFrame(() => window.scrollTo(0, 0));
    });
  };

  React.useEffect(() => {
    if (view !== 'sort') return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      // An early click or keyboard action may already have focused a control.
      // Only supply the initial focus while the document still has none.
      if (document.activeElement === document.body) document.querySelector<HTMLElement>('.sorting-workspace')?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view]);

  const saveAssignments = async (assignments: CategoryAssignment[]) => {
    if (!activeId) throw new Error('Create a project first');
    setBusy(true); setError(''); setMessage('');
    try {
      const changes = planStashAssignments(images, categories, assignments, window.innerWidth, readBoardPreferences(activeId).anchors);
      const saved = await assignImageCategories(activeId, changes);
      const updates = new Map(saved.map(image => [image.id, image]));
      const update = (image: LibraryImage) => updates.get(image.id) || image;
      setImages(current => current.map(update));
      setSelected(current => current ? update(current) : current);
      setProjects(current => current.map(project => project.id === activeId ? { ...project, updatedAt: Date.now() } : project));
      const destination = categories.find(stash => stash.id === assignments[0].categoryId)?.name || 'Root';
      setMessage(assignments.length === 1 ? `Image moved into ${destination}.` : `${assignments.length.toLocaleString()} images moved.`);
      rememberCategoryChange(activeId, images, assignments, saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally { setBusy(false); }
  };

  const createStash = async (ids: string[], parentId: string | null, name?: string) => {
    if (!activeId || busy || boardSaves) throw new Error('Wait for the board to finish saving.');
    setBusy(true); setError('');
    try {
      const result = await createStashWithImages(activeId, ids, parentId, name);
      await refresh(activeId);
      setMessage(`Stash created · ${ids.length} ${ids.length === 1 ? 'image' : 'images'}.`);
      history.remember({ projectId: activeId, kind: 'stash', stashId: result.category.id, imageCount: ids.length, message: `Created ${result.category.name.split('/').at(-1)} with ${ids.length} ${ids.length === 1 ? 'image' : 'images'}.`,
        detail: 'Undo restores the previous stashes and exact image positions.', label: 'Undo create stash', restored: 'Stash creation undone.', restore: () => undoStashCreation(activeId, result.category.id, result.states) });
      return result.category;
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); throw cause; }
    finally { setBusy(false); }
  };

  const renameStash: RenameStash = async (id, name, options) => {
    if (!activeId) return;
    setBusy(true); setError('');
    try {
      const previous = categories.find(stash => stash.id === id)?.name;
      await renameCategory(id, name); await refresh(activeId);
      if (options?.initialNaming && history.current?.kind === 'stash' && history.current.stashId === id) {
        history.updateLatest(current => ({ ...current, message: `Created ${name.split('/').at(-1)} with ${current.imageCount || 0} ${(current.imageCount || 0) === 1 ? 'image' : 'images'}.` }));
      } else if (previous && previous !== name) {
        history.remember({ projectId: activeId, kind: 'rename', stashId: id,
          message: 'Stash renamed.', detail: 'Undo restores its previous name.', label: 'Undo rename', restored: 'Previous stash name restored.', restore: () => renameCategory(id, previous).then(() => {}) });
      }
      if (!options?.initialNaming) setMessage('Stash renamed.');
    }
    // Rename forms own their errors, including storage failures. Keep focus and
    // feedback there instead of opening an unrelated global actions menu.
    finally { setBusy(false); }
  };

  const deleteEmptyStash = async (id: string) => {
    if (!activeId || busy || boardSaves || stashDeleteLock.current) return;
    stashDeleteLock.current = true; setBusy(true); setError('');
    try {
      const snapshot = await removeEmptyStash(activeId, id);
      await refresh(activeId);
      const name = snapshot.category.name.split('/').at(-1)!;
      history.remember({ projectId: activeId, kind: 'delete', stashId: id, message: `Deleted empty stash ${name}.`,
        detail: 'Images are kept. Undo restores the stash and its position.', label: 'Undo delete stash', restored: `Restored stash ${name}.`, restore: () => restoreEmptyStash(snapshot) });
      setMessage(`Deleted empty stash ${name}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); throw cause; }
    finally { stashDeleteLock.current = false; setBusy(false); }
  };

  const createAndAssign = async (image: LibraryImage, name: string) => { await createStash([image.id], reviewContext?.parentId || null, name); };

  const create = async (name: string) => run('Creating project…', async () => {
    const project = await createProject(name || 'Untitled project');
    resetViews(); setSelected(undefined); setPendingImport(null);
    selectProject(project.id); await refresh(project.id);
    setMessage('Project created.');
  });

  const renameActiveProject = () => {
    if (!active) return;
    const name = window.prompt('Project name', active.name);
    if (name === null || name.trim() === active.name) return;
    void run('Renaming project…', async () => { await renameProject(active.id, name); await refresh(active.id); setMessage('Project renamed.'); });
  };
  const changeClipEnabled = async (enabled: boolean) => {
    if (!activeId || settingsLock.current || busy) return;
    const id = activeId, previous = projectClipEnabled(active);
    settingsLock.current = true; setBusy(true); setError(''); setProgress('Saving settings…');
    // Stop background work immediately; roll back the setting if persistence fails.
    setProjects(current => current.map(project => project.id === id ? { ...project, settings: { ...project.settings, clipEnabled: enabled } } : project));
    try {
      const updated = await setProjectClipEnabled(id, enabled);
      setProjects(current => current.map(project => project.id === id ? updated : project));
    } catch (cause) {
      setProjects(current => current.map(project => project.id === id ? { ...project, settings: { ...project.settings, clipEnabled: previous } } : project));
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { settingsLock.current = false; setBusy(false); setProgress(''); }
  };

  const importZip = async (file?: File) => {
    if (!file) return;
    await run('Importing project…', async () => {
      const project = await importProjectZip(file);
      selectProject(project.id); resetViews(); setSelected(undefined); setPendingImport(null);
      await refresh(project.id);
      setMessage('Project imported and saved locally.');
    });
  };

  const importFolder = async (files: File[]) => {
    if (!files.length) return;
    await run('Importing project folder…', async () => {
      const project = await importProjectDirectory(files);
      selectProject(project.id); resetViews(); setSelected(undefined); setPendingImport(null);
      await refresh(project.id);
      setMessage('Project folder imported and saved locally.');
    });
  };

  const thumbnails = useThumbnailCache();
  const canExportFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  const pendingImageCount = pendingImport?.filter((item) => isImageFile(item.file)).length || 0;
  const pendingNestedCount = pendingImport?.filter(item => isImageFile(item.file) && sourceCategoryForPath(item.path)).length || 0;
  const pendingFolderCount = pendingImport ? proposedSourceCategories(pendingImport).length : 0;

  const exportSorted = (format: 'zip' | 'folder') => run(format === 'zip' ? 'Preparing sorted ZIP…' : 'Exporting sorted folder…', async () => {
    if (!active) return;
    if (format === 'zip') {
      download(await exportSortedZip(active.id), `${safeFilename(active.name)}-sorted.zip`);
      setMessage('Sorted ZIP is ready to download.');
    } else {
      const picker = (window as unknown as { showDirectoryPicker: (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
      const parent = await picker({ mode: 'readwrite' });
      const folderName = `${safeFilename(active.name)}-sorted-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await exportSortedDirectory(active.id, await parent.getDirectoryHandle(folderName, { create: true }));
      setMessage(`Sorted images saved in the ${folderName} folder.`);
    }
  });

  const exportBackup = (format: 'zip' | 'folder') => run('Preparing backup…', async () => {
    if (!active) return;
    if (format === 'zip') download(await exportProjectZip(active.id), `${safeFilename(active.name)}.zip`);
    else {
      const picker = (window as unknown as { showDirectoryPicker: (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
      const parent = await picker({ mode: 'readwrite' });
      const folderName = `${safeFilename(active.name)}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await exportProjectDirectory(active.id, await parent.getDirectoryHandle(folderName, { create: true }));
    }
    setMessage('Project backup saved.');
  });

  const imageById = new Map(images.map(image => [image.id, image]));
  const viewerImages = reviewContext ? reviewContext.ids.flatMap(id => imageById.get(id) ? [imageById.get(id)!] : []) : images;
  const viewerIndex = selected ? viewerImages.findIndex(image => image.id === selected.id) : -1;
  const undoView: UndoView | undefined = undoAction ? { ...undoAction, busy: busy || boardSaves > 0, onUndo: () => void undoRecent() } : undefined;
  const viewer = selected ? <ImageViewer image={selected} images={images} index={viewerIndex} total={viewerImages.length} onMove={direction => { const image = viewerImages[viewerIndex + direction]; if (image) setSelected(image); }} categories={categories} busy={busy} undo={undoView} onAssign={(categoryId) => saveAssignments([{ id: selected.id, categoryId }])} onCreateAndAssign={(name) => createAndAssign(selected, name)} onClose={() => setSelected(undefined)} onRemove={() => {
    void run('Deleting image from project…', async () => {
      const snapshot = await removeImageWithUndo(selected.id);
      if (!snapshot) return;
      setSelected(undefined); await refresh(activeId);
      setMessage('Image deleted from this project.');
      history.remember({ projectId: snapshot.image.projectId, kind: 'delete', message: `Deleted ${selected.path.split('/').at(-1)} from this project.`, detail: 'Your original file is kept. Undo restores the image and its stash and position.', label: 'Undo delete', restored: 'Image restored to the project.', restore: () => restoreRemovedImage(snapshot) });
    });
  }} /> : null;

  const settingsDialog = active && settingsOpen ? <Modal label="Project settings" className="project-settings-dialog" onClose={() => setSettingsOpen(false)}>
    <header><strong>{active.name}</strong><ActionButton icon="close" label="Close project settings" autoFocus onClick={() => setSettingsOpen(false)} /></header>
    <ProjectSettings enabled={projectClipEnabled(active)} busy={busy} onChange={enabled => void changeClipEnabled(enabled)} />
    {error && <p role="alert">{error}</p>}
  </Modal> : null;

  const scopedIndexImages = React.useMemo(() => images.filter(image => image.projectId === activeId), [images, activeId]);
  const projectSession = (children: React.ReactNode) => <ContentIndexProvider key={activeId || 'empty'} images={scopedIndexImages} enabled={projectClipEnabled(active)}>{children}</ContentIndexProvider>;

  if (active && view !== 'library') return projectSession(<>
    <SortingWorkspace key={active.id} projectId={active.id} projectName={active.name} clipEnabled={projectClipEnabled(active)} onSettings={() => setSettingsOpen(true)} images={images} categories={categories} busy={busy} saving={boardSaves > 0} thumbnailCache={thumbnails} progress={progress} message={message} error={error} canExportFolder={canExportFolder}
      onExport={format => void exportSorted(format)}
      onBack={() => { setView('library'); setSelected(undefined); setMessage(''); window.requestAnimationFrame(() => window.scrollTo(0, 0)); }}
      onOpenImage={(image, context) => { setReviewContext(context); setSelected(image); }}
      onBackup={format => void exportBackup(format)} initialBrowser={initialBrowser} initialStashId={initialStashId} importedImageIds={importedImageIds}
      onAssign={saveAssignments} onRememberAction={history.remember} undo={!selected ? undoView : undefined}
      onCreateStash={createStash}
      onPrepareStash={async (id, width) => {
        setBusy(true); setProgress('Arranging folder…');
        try { if (await prepareStashBoard(active.id, id, width, readBoardPreferences(active.id).anchors)) await refresh(active.id); }
        finally { setBusy(false); setProgress(''); }
      }}
      onRenameStash={renameStash}
      onDeleteEmptyStash={deleteEmptyStash}
      onPlaceOnBoard={boardActions.place} />
    {viewer}
    {settingsDialog}
  </>);

  return projectSession(<div className="library-app">
    <MenuBar light label="Project menu bar" leading={<div className="library-brand" title="Folder Sort"><FolderOpen aria-hidden="true" /></div>}
      context={<select aria-label="Project" value={activeId || ''} disabled={busy || boardSaves > 0 || !projects.length} onChange={(event) => {
            const id = event.target.value;
            selectProject(id); setSelected(undefined); resetViews(); setPendingImport(null); setError(''); setMessage('');
            void setActiveProjectId(id).catch((cause) => setError(String(cause)));
          }}>
            {!projects.length ? <option value="">No projects yet</option> : null}
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>}>
      <UndoControl action={undoView} />
    </MenuBar>

    <ProjectScreen key={active?.id || "new"} project={active} images={images} categories={categories} busy={busy || boardSaves > 0} progress={progress} message={message} error={error}
      clipEnabled={projectClipEnabled(active)} canFolder={canExportFolder} onClip={enabled => void changeClipEnabled(enabled)}
      onOpen={openView} onOpenStash={openStash} onBrowse={() => { setInitialStashId(undefined); setImportedImageIds(undefined); setInitialBrowser(true); setView('sort'); }} onRename={renameActiveProject}
      importedCount={importedCount}
      onShowImported={() => { if (!recentImport || recentImport.projectId !== activeId) return; setImportedImageIds(recentImport.ids); setInitialStashId(undefined); setInitialBrowser(true); setView('sort'); setMessage(''); }}
      onAddFiles={() => fileInput.current?.click()} onAddFolder={() => folderInput.current?.click()}
      onDrop={transfer => { void droppedFiles(transfer).then(beginImport).catch(cause => setError(String(cause))); }}
      onCreateProject={create} onImportZip={() => importZipInput.current?.click()} onImportFolder={() => importFolderInput.current?.click()}
      onCreateStash={async (name, parentId) => { await createStash([], parentId, name); }}
      onRenameStash={renameStash}
      onDeleteEmptyStash={deleteEmptyStash}
      onSorted={format => void exportSorted(format)} onBackup={format => void exportBackup(format)} />

    <input ref={fileInput} className="library-hidden-input" type="file" accept="image/*" multiple onChange={(event) => { beginImport([...event.target.files || []].map((file) => ({ file, path: file.name }))); event.target.value = ''; }} />
    <input ref={folderInput} className="library-hidden-input" type="file" multiple onChange={(event) => { beginImport([...event.target.files || []].map((file) => ({ file, path: file.webkitRelativePath || file.name }))); event.target.value = ''; }} />
    <input ref={importZipInput} className="library-hidden-input" type="file" accept=".zip,application/zip" onChange={(event) => { void importZip(event.target.files?.[0]); event.target.value = ''; }} />
    <input ref={importFolderInput} className="library-hidden-input" type="file" multiple onChange={(event) => { void importFolder([...event.target.files || []]); event.target.value = ''; }} />
    {pendingImport ? <Modal className="library-import-overlay" label="Choose starting stashes" onClose={() => setPendingImport(null)}>
      <div className="library-import-dialog"><div className="library-import-dialog__icon"><FolderInput size={26} /></div><h2>Your folder already has some order.</h2>
        <p>{pendingImageCount} {pendingImageCount === 1 ? 'image' : 'images'} total. {pendingNestedCount} {pendingNestedCount === 1 ? 'image is' : 'images are'} in {pendingFolderCount} {pendingFolderCount === 1 ? 'subfolder' : 'subfolders'}{pendingImageCount > pendingNestedCount ? `; ${pendingImageCount - pendingNestedCount} ${pendingImageCount - pendingNestedCount === 1 ? 'is' : 'are'} in the main folder` : ''}. Keep subfolders as starting stashes, or start fresh with every image unsorted. Original folder paths are kept either way; other file types are skipped.</p>
        <div className="library-import-dialog__examples">{proposedSourceCategories(pendingImport).slice(0, 6).map((name) => <span key={name}>{name}</span>)}</div>
        <div className="library-import-dialog__actions"><button className="library-button library-button--quiet" type="button" onClick={() => setPendingImport(null)}>Cancel</button>
          <button className="library-button library-button--quiet" type="button" onClick={() => { const items = pendingImport; setPendingImport(null); void ingest(items); }}>Start fresh · ignore subfolders</button>
          <button data-modal-autofocus className="library-button" type="button" onClick={() => { const items = pendingImport; setPendingImport(null); void ingest(items, true); }}>Keep subfolders as stashes</button></div>
      </div>
    </Modal> : null}
    {viewer}
    {settingsDialog}
  </div>);
}
