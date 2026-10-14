import * as React from 'react';
import ImageViewer from './ImageViewer';
import Modal from './Modal';
import UndoControl, { type UndoView } from './UndoControl';
import MenuBar from './MenuBar';
import ProjectScreen from './ProjectScreen';
import ProjectSettings from './ProjectSettings';
import { ActionButton } from './UiActions';
import './project-shell.css';
import { useThumbnailCache } from './imageThumbnails';
import { FolderInput, FolderOpen } from 'lucide-react';
import {
  addImages, assignImageCategories, cleanRelativePath, createCategory, createProject, exportProjectDirectory, exportProjectZip,
  exportSortedDirectory, exportSortedZip, getActiveProjectId, isImageFile,
  importProjectDirectory, importProjectZip, listCategories, listImages, listProjects, placeImagesOnBoard,
  createStashWithImages, undoStashCreation, removeImageWithUndo, restoreRemovedImage, restoreImageStates, renameCategory, renameProject, returnImagesToTray, setActiveProjectId, projectClipEnabled, setProjectClipEnabled,
  type CategoryAssignment, type ImageRestoreState, type IncomingImage, type LibraryCategory, type LibraryImage, type LibraryProject,
} from './libraryStore';
import { proposedSourceCategories, sourceCategoryForPath } from './folderCategories';
import SortingWorkspace from './SortingWorkspace';
import { download, safeFilename } from './download';

type SortView = 'library' | 'sort';
type UndoAction = { id: number; projectId: string; kind: 'category' | 'clear' | 'delete' | 'stash'; stashId?: string; message: string; detail: string; label: string; restored: string; restore: () => Promise<void> };

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
  const [projects, setProjects] = React.useState<LibraryProject[]>([]);
  const [activeId, setActiveId] = React.useState<string>();
  const [images, setImages] = React.useState<LibraryImage[]>([]);
  const [categories, setCategories] = React.useState<LibraryCategory[]>([]);
  const [pendingImport, setPendingImport] = React.useState<IncomingImage[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState('');
  const [boardSaves, setBoardSaves] = React.useState(0);
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  const [view, setView] = React.useState<SortView>('library');
  const [selected, setSelected] = React.useState<LibraryImage>();
  const [reviewContext, setReviewContext] = React.useState<{ ids: string[]; parentId: string | null }>();
  const [initialBrowser, setInitialBrowser] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const settingsLock = React.useRef(false);
  const [undoEntry, setUndoAction] = React.useState<UndoAction | null>(null);
  const undoSequence = React.useRef(0);
  const undoAction = undoEntry?.projectId === activeId ? undoEntry : null;
  const undoLock = React.useRef(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const folderInput = React.useRef<HTMLInputElement>(null);
  const importZipInput = React.useRef<HTMLInputElement>(null);
  const importFolderInput = React.useRef<HTMLInputElement>(null);
  const active = projects.find((project) => project.id === activeId);
  React.useEffect(() => { setUndoAction(null); }, [activeId]);

  React.useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const found = await listProjects();
        const stored = await getActiveProjectId();
        if (!current) return;
        // A first import can create/select a project before this startup read
        // finishes. Keep that newer selection and project list.
        setProjects((latest) => latest.length ? latest : found);
        setActiveId((latest) => latest || (found.some((project) => project.id === stored) ? stored : found[0]?.id));
      } catch (cause) { if (current) setError(String(cause)); }
    })();
    return () => { current = false; };
  }, []);

  React.useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '');
    importFolderInput.current?.setAttribute('webkitdirectory', '');
  }, [view]);

  React.useEffect(() => {
    if (!activeId) { setImages([]); setCategories([]); return; }
    let current = true;
    void Promise.all([listImages(activeId), listCategories(activeId)])
      .then(([foundImages, foundCategories]) => { if (current) { setImages(foundImages); setCategories(foundCategories); } })
      .catch((cause) => setError(String(cause)));
    return () => { current = false; };
  }, [activeId]);

  const refresh = async (id = activeId) => {
    setProjects(await listProjects());
    if (id) {
      const [foundImages, foundCategories] = await Promise.all([listImages(id), listCategories(id)]);
      setImages(foundImages);
      setCategories(foundCategories);
      setSelected(current => current ? foundImages.find(image => image.id === current.id) : undefined);
      return foundImages;
    }
  };

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
        setUndoAction(null); setMessage(undoAction.restored);
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

  const rememberCategoryChange = (projectId: string, previous: LibraryImage[], assignments: CategoryAssignment[]) => {
    const byId = new Map(assignments.map(item => [item.id, item.categoryId]));
    const changed = previous.filter(image => byId.has(image.id) && byId.get(image.id) !== image.categoryId);
    if (!changed.length) return;
    const states: ImageRestoreState[] = changed.map(image => ({ id: image.id, categoryId: image.categoryId, boardScope: image.boardScope }));
    const removing = changed.every(image => byId.get(image.id) === null);
    setUndoAction({ id: ++undoSequence.current, projectId, kind: 'category',
      message: removing ? `Moved to Unsorted: ${changed.length === 1 ? 'this image' : `${changed.length.toLocaleString()} images`}.` : `Stash changed for ${changed.length === 1 ? 'this image' : `${changed.length.toLocaleString()} images`}.`,
      detail: 'Images are kept. Undo restores their previous stashes.', label: removing ? 'Undo removal' : 'Undo stash move', restored: 'Previous stashes restored.',
      restore: () => restoreImageStates(projectId, states),
    });
  };

  const ingest = async (items: IncomingImage[], useSourceFolders = false) => {
    await run('Adding images…', async () => {
      const projectId = activeId || (await createProject(nameFromIncomingFolder(items))).id;
      if (!activeId) setActiveId(projectId);
      const initialCategoryByPath = new Map<string, string>();
      if (useSourceFolders) {
        const existing = await listCategories(projectId);
        for (const name of proposedSourceCategories(items)) {
          let category = existing.find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
          if (!category) {
            category = await createCategory(projectId, name);
            existing.push(category);
          }
        }
        for (const item of items) {
          const name = sourceCategoryForPath(item.path);
          const category = existing.find((candidate) => candidate.name.toLocaleLowerCase() === name?.toLocaleLowerCase());
          if (category) initialCategoryByPath.set(cleanRelativePath(item.path), category.id);
        }
      }
      const result = await addImages(projectId, items, (done, total) => setProgress(`Adding images… ${done}/${total}`), initialCategoryByPath);
      const imported = await refresh(projectId);
      setMessage(`${result.added} image${result.added === 1 ? '' : 's'} added${result.skipped ? `; ${result.skipped} skipped (duplicate path or unsupported type)` : ''}. Saved locally.`);
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
    setView('library'); setInitialBrowser(false); setReviewContext(undefined); setSettingsOpen(false);
  };

  const openView = () => {
    setInitialBrowser(false);
    setView('sort');
    setError(''); setMessage('');
    window.requestAnimationFrame(() => window.scrollTo(0, 0));
  };

  React.useEffect(() => {
    if (view !== 'sort') return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      document.querySelector<HTMLElement>('.sorting-workspace')?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view]);

  const saveAssignments = async (assignments: CategoryAssignment[]) => {
    if (!activeId) throw new Error('Create a project first');
    setBusy(true); setError(''); setMessage('');
    try {
      await assignImageCategories(activeId, assignments);
      const updates = new Map(assignments.map(assignment => [assignment.id, assignment]));
      const update = (image: LibraryImage) => {
        const change = updates.get(image.id);
        return change ? { ...image, categoryId: change.categoryId, boardScope: change.boardScope === undefined ? change.categoryId : change.boardScope, ...(change.boardPosition ? {
          placement: 'board' as const, boardX: Math.round(change.boardPosition.x), boardY: Math.round(change.boardPosition.y),
        } : {}) } : image;
      };
      setImages(current => current.map(update));
      setSelected(current => current ? update(current) : current);
      setProjects(current => current.map(project => project.id === activeId ? { ...project, updatedAt: Date.now() } : project));
      setMessage(assignments.length === 1 ? assignments[0].boardPosition ? 'Image assigned and added to board.' : 'Stash membership saved.' : `${assignments.length.toLocaleString()} images assigned.`);
      rememberCategoryChange(activeId, images, assignments);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally { setBusy(false); }
  };

  const createStash = async (ids: string[], parentId: string | null, name?: string) => {
    if (!activeId || busy || boardSaves) throw new Error('Wait for the board to finish saving.');
    setBusy(true); setError('');
    try {
      const result = await createStashWithImages(activeId, ids, parentId, name, true);
      await refresh(activeId);
      setMessage(`Stash created · ${ids.length} images.`);
      setUndoAction({ id: ++undoSequence.current, projectId: activeId, kind: 'stash', stashId: result.category.id, message: `Created ${result.category.name.split('/').at(-1)} with ${ids.length} ${ids.length === 1 ? 'image' : 'images'}.`,
        detail: 'Undo restores the previous stashes and exact image positions.', label: 'Undo create stash', restored: 'Stash creation undone.', restore: () => undoStashCreation(activeId, result.category.id, result.states) });
      return result.category;
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); throw cause; }
    finally { setBusy(false); }
  };

  const createAndAssign = async (image: LibraryImage, name: string) => { await createStash([image.id], reviewContext?.parentId || null, name); };

  const create = async (name: string) => run('Creating project…', async () => {
    const project = await createProject(name || 'Untitled project');
    resetViews(); setSelected(undefined); setPendingImport(null);
    setActiveId(project.id); await refresh(project.id);
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
      setActiveId(project.id); resetViews(); setSelected(undefined); setPendingImport(null);
      await refresh(project.id);
      setMessage('Project imported and saved locally.');
    });
  };

  const importFolder = async (files: File[]) => {
    if (!files.length) return;
    await run('Importing project folder…', async () => {
      const project = await importProjectDirectory(files);
      setActiveId(project.id); resetViews(); setSelected(undefined); setPendingImport(null);
      await refresh(project.id);
      setMessage('Project folder imported and saved locally.');
    });
  };

  const thumbnails = useThumbnailCache();
  const canExportFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  const pendingImageCount = pendingImport?.filter((item) => isImageFile(item.file)).length || 0;

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
      setUndoAction({ id: ++undoSequence.current, projectId: snapshot.image.projectId, kind: 'delete', message: `Deleted ${selected.path.split('/').at(-1)} from this project.`, detail: 'Your original file is kept. Undo restores the image and its stash and position.', label: 'Undo delete', restored: 'Image restored to the project.', restore: () => restoreRemovedImage(snapshot) });
    });
  }} /> : null;

  const settingsDialog = active && settingsOpen ? <Modal label="Project settings" className="project-settings-dialog" onClose={() => setSettingsOpen(false)}>
    <header><strong>{active.name}</strong><ActionButton icon="close" label="Close project settings" autoFocus onClick={() => setSettingsOpen(false)} /></header>
    <ProjectSettings enabled={projectClipEnabled(active)} busy={busy} onChange={enabled => void changeClipEnabled(enabled)} />
    {error && <p role="alert">{error}</p>}
  </Modal> : null;

  if (active && view !== 'library') return <>
    <SortingWorkspace key={active.id} projectId={active.id} projectName={active.name} clipEnabled={projectClipEnabled(active)} onSettings={() => setSettingsOpen(true)} images={images} categories={categories} busy={busy} saving={boardSaves > 0} thumbnailCache={thumbnails} progress={progress} message={message} error={error} canExportFolder={canExportFolder}
      onExport={format => void exportSorted(format)}
      onBack={() => { setView('library'); setSelected(undefined); setMessage(''); window.requestAnimationFrame(() => window.scrollTo(0, 0)); }}
      onOpenImage={(image, context) => { setReviewContext(context); setSelected(image); }}
      onBackup={format => void exportBackup(format)} initialBrowser={initialBrowser}
      onAssign={saveAssignments} undo={!selected ? undoView : undefined}
      onCreateStash={createStash}
      onRenameStash={async (id, name) => {
        setBusy(true); setError('');
        try { await renameCategory(id, name); await refresh(activeId); setUndoAction(current => current?.kind === 'stash' && current.stashId === id ? { ...current, message: `Created ${name.split('/').at(-1)} with ${current.message.split(' with ').at(-1)}` } : current); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); throw cause; }
        finally { setBusy(false); }
      }}
      onPlaceOnBoard={(moves) => {
        if (!activeId) return;
        const byId = new Map(moves.map((move) => [move.id, move]));
        setImages((current) => current.map((item) => {
          const move = byId.get(item.id);
          return move ? { ...item, placement: 'board', boardX: Math.round(move.x), boardY: Math.round(move.y), ...(move.boardScope !== undefined ? { boardScope: move.boardScope } : {}) } : item;
        }));
        setBoardSaves(count => count + 1);
        setMessage('Saving board…');
        void placeImagesOnBoard(activeId, moves).then(() => setMessage('Board saved.')).catch((cause) => {
          setError(cause instanceof Error ? cause.message : String(cause));
          void refresh(activeId);
        }).finally(() => setBoardSaves(count => count - 1));
      }}
      onReturnToPile={(ids) => {
        if (!activeId || busy) return;
        const selected = new Set(ids);
        const affected = images.filter(image => selected.has(image.id) && image.placement !== 'tray');
        const states: ImageRestoreState[] = affected.map(image => ({ id: image.id, board: { placement: image.placement, boardX: image.boardX, boardY: image.boardY, boardScope: image.boardScope } }));
        if (!states.length) return;
        const clearing = new Set(affected.map(image => image.id));
        setImages((current) => current.map((item) => clearing.has(item.id)
          ? { ...item, placement: 'tray', boardX: undefined, boardY: undefined, boardScope: undefined } : item));
        setBoardSaves(count => count + 1);
        setMessage('Saving board…');
        void returnImagesToTray(activeId, [...clearing]).then(() => {
          setMessage('Images returned to the pile.');
          setUndoAction({ id: ++undoSequence.current, projectId: activeId, kind: 'clear', message: states.length === images.filter(image => image.placement !== 'tray').length ? 'Board cleared.' : `${states.length.toLocaleString()} ${states.length === 1 ? 'image moved' : 'images moved'} back to the pile.`, detail: 'Images and stashes are kept. Undo restores their board positions.', label: 'Undo clear', restored: 'Previous board positions restored.', restore: () => restoreImageStates(activeId, states) });
        }).catch((cause) => {
          setError(cause instanceof Error ? cause.message : String(cause));
          void refresh(activeId);
        }).finally(() => setBoardSaves(count => count - 1));
      }} />
    {viewer}
    {settingsDialog}
  </>;

  return <div className="library-app">
    <MenuBar light label="Project menu bar" leading={<div className="library-brand" title="Folder Sort"><FolderOpen aria-hidden="true" /></div>}
      context={<select aria-label="Project" value={activeId || ''} disabled={busy || !projects.length} onChange={(event) => {
            const id = event.target.value;
            setActiveId(id); setImages([]); setCategories([]); setSelected(undefined); resetViews(); setPendingImport(null); setError(''); setMessage('');
            void setActiveProjectId(id).catch((cause) => setError(String(cause)));
          }}>
            {!projects.length ? <option value="">No projects yet</option> : null}
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>}>
      <UndoControl action={undoView} />
    </MenuBar>

    <ProjectScreen key={active?.id || "new"} project={active} images={images} categories={categories} busy={busy} progress={progress} message={message} error={error}
      clipEnabled={projectClipEnabled(active)} canFolder={canExportFolder} onClip={enabled => void changeClipEnabled(enabled)}
      onOpen={openView} onBrowse={() => { setInitialBrowser(true); setView('sort'); }} onRename={renameActiveProject}
      onAddFiles={() => fileInput.current?.click()} onAddFolder={() => folderInput.current?.click()}
      onDrop={transfer => { void droppedFiles(transfer).then(beginImport).catch(cause => setError(String(cause))); }}
      onCreateProject={create} onImportZip={() => importZipInput.current?.click()} onImportFolder={() => importFolderInput.current?.click()}
      onCreateStash={async (name, parentId) => { await createStash([], parentId, name); }}
      onRenameStash={async (id, name) => { await run('Renaming stash…', async () => { await renameCategory(id, name); await refresh(activeId); setMessage('Stash renamed.'); }); }}
      onSorted={format => void exportSorted(format)} onBackup={format => void exportBackup(format)} />

    <input ref={fileInput} className="library-hidden-input" type="file" accept="image/*" multiple onChange={(event) => { beginImport([...event.target.files || []].map((file) => ({ file, path: file.name }))); event.target.value = ''; }} />
    <input ref={folderInput} className="library-hidden-input" type="file" multiple onChange={(event) => { beginImport([...event.target.files || []].map((file) => ({ file, path: file.webkitRelativePath || file.name }))); event.target.value = ''; }} />
    <input ref={importZipInput} className="library-hidden-input" type="file" accept=".zip,application/zip" onChange={(event) => { void importZip(event.target.files?.[0]); event.target.value = ''; }} />
    <input ref={importFolderInput} className="library-hidden-input" type="file" multiple onChange={(event) => { void importFolder([...event.target.files || []]); event.target.value = ''; }} />
    {pendingImport ? <Modal className="library-import-overlay" label="Choose starting stashes" onClose={() => setPendingImport(null)}>
      <div className="library-import-dialog"><div className="library-import-dialog__icon"><FolderInput size={26} /></div><h2>Your folder already has some order.</h2>
        <p>{pendingImageCount} {pendingImageCount === 1 ? 'image is' : 'images are'} inside {proposedSourceCategories(pendingImport).length} nested folder {proposedSourceCategories(pendingImport).length === 1 ? 'path' : 'paths'}. Keep those paths as starting stashes, or start fresh with every image unsorted. Each image can be moved into one stash later. Original folder paths are kept for reference either way; other file types are skipped.</p>
        <div className="library-import-dialog__examples">{proposedSourceCategories(pendingImport).slice(0, 6).map((name) => <span key={name}>{name}</span>)}</div>
        <div className="library-import-dialog__actions"><button className="library-button library-button--quiet" type="button" onClick={() => setPendingImport(null)}>Cancel</button>
          <button className="library-button library-button--quiet" type="button" onClick={() => { const items = pendingImport; setPendingImport(null); void ingest(items); }}>Start fresh · ignore subfolders</button>
          <button data-modal-autofocus className="library-button" type="button" onClick={() => { const items = pendingImport; setPendingImport(null); void ingest(items, true); }}>Keep subfolders as stashes</button></div>
      </div>
    </Modal> : null}
    {viewer}
    {settingsDialog}
  </div>;
}
