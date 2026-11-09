import { useProjectTransfers } from './useProjectTransfers';
import { useProjectCommands } from './useProjectCommands';
import { useProjectSession } from './useProjectSession';
import { useForegroundOperations } from './useForegroundOperations';
import { useProjectLibrary } from './useProjectLibrary';
import { useActionHistory } from './useActionHistory';
import { useBoardActions } from './useBoardActions';
import * as React from 'react';
import ImageViewer from './ImageViewer';
import Modal from './Modal';
import UndoControl, { type UndoView } from './UndoControl';
import MenuBar from './MenuBar';
import ProjectScreen from './ProjectScreen';
import { effectiveBrowserWidth, readImageBrowserView } from './imageBrowserView';
import ProjectSettings from './ProjectSettings';
import { ContentIndexProvider } from './ContentIndex';
import { ActionButton } from './UiActions';
import './project-shell.css';
import { useThumbnailCache } from './imageThumbnails';
import { FolderInput, FolderOpen } from 'lucide-react';
import {
  createProject,
  isImageFile,
  removeImageWithUndo, restoreRemovedImage, renameProject, prepareStashBoard, setActiveProjectId, projectClipEnabled,
  type LibraryImage,
} from './libraryStore';
import { proposedSourceCategories, sourceCategoryForPath } from './folderCategories';
import { readBoardPreferences } from './categoryBoard';
import SortingWorkspace from './SortingWorkspace';
import FolderMoveDialog from './FolderMoveDialog';


export default function LibraryApp() {
  const [error, setError] = React.useState('');
  const library = useProjectLibrary(setError);
  const { projects, activeId, selectProject, images, setImages, categories, refresh: refreshCollection } = library;
  const { operations, busy, progress } = useForegroundOperations();
  const [boardSaves, setBoardSaves] = React.useState(0);
  const [message, setMessage] = React.useState('');
  const [movingFolderId, setMovingFolderId] = React.useState<string | null>(null);
  React.useEffect(() => setMovingFolderId(null), [activeId]);
  const session = useProjectSession();
  const { view, selected, reviewContext, initialBrowser, initialStashId, recentImport, importedImageIds, settingsOpen,
    setSelected, reviewImage, openWorkspace, showProject, resetViews, setSettingsOpen } = session;
  const history = useActionHistory(activeId);
  const undoAction = history.current;
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

  const { run, undoRecent, saveAssignments, createStash, renameStash, deleteEmptyStash, moveFolder, changeClipEnabled } = useProjectCommands({
    library, operations, history, boardSaves, setSelected, refresh, setError, setMessage });

  const { pendingImport, setPendingImport, ingest, beginImport, drop, importZip, importFolder, exportSorted, exportBackup } = useProjectTransfers({
    library, session, run, operations, refresh, setError, setMessage });

  const openView = () => {
    openWorkspace();
    setError(''); setMessage('');
    window.requestAnimationFrame(() => window.scrollTo(0, 0));
  };

  const openStash = (id: string) => {
    if (!activeId || !categories.some(stash => stash.id === id)) return;
    void run('Opening folder…', async () => {
      const browser = readImageBrowserView(activeId);
      const width = window.innerWidth <= 700 ? window.innerWidth : window.innerWidth - effectiveBrowserWidth(browser.collapsed ? 48 : browser.width, window.innerWidth);
      if (await prepareStashBoard(activeId, id, width, readBoardPreferences(activeId).anchors)) await refresh(activeId);
      openWorkspace({ folderId: id });
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
  const thumbnails = useThumbnailCache();
  const canExportFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  const pendingImageCount = pendingImport?.filter((item) => isImageFile(item.file)).length || 0;
  const pendingNestedCount = pendingImport?.filter(item => isImageFile(item.file) && sourceCategoryForPath(item.path)).length || 0;
  const pendingFolderCount = pendingImport ? proposedSourceCategories(pendingImport).length : 0;

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
      history.remember({ projectId: snapshot.image.projectId, kind: 'delete', message: `Deleted ${selected.path.split('/').at(-1)} from this project.`, detail: 'Your original file is kept. Undo restores the image and its folder and position.', label: 'Undo delete', restored: 'Image restored to the project.', restore: () => restoreRemovedImage(snapshot) });
    });
  }} /> : null;

  const settingsDialog = active && settingsOpen ? <Modal label="Project settings" className="project-settings-dialog" onClose={() => setSettingsOpen(false)}>
    <header><strong>{active.name}</strong><ActionButton icon="close" label="Close project settings" autoFocus onClick={() => setSettingsOpen(false)} /></header>
    <ProjectSettings enabled={projectClipEnabled(active)} busy={busy} onChange={enabled => void changeClipEnabled(enabled)} />
    {error && <p role="alert">{error}</p>}
  </Modal> : null;

  const scopedIndexImages = React.useMemo(() => images.filter(image => image.projectId === activeId), [images, activeId]);
  const movingFolder = categories.find(folder => folder.id === movingFolderId);
  const folderMoveDialog = movingFolder && <FolderMoveDialog key={movingFolder.id} folder={movingFolder} categories={categories} busy={busy || boardSaves > 0}
    onChoose={id => moveFolder(movingFolder.id, id)} onClose={() => setMovingFolderId(null)} />;
  const projectSession = (children: React.ReactNode) => <ContentIndexProvider key={activeId || 'empty'} images={scopedIndexImages} enabled={!!active && projectClipEnabled(active)}>{children}</ContentIndexProvider>;

  if (active && view !== 'library') return projectSession(<>
    <SortingWorkspace key={active.id} projectId={active.id} projectName={active.name} clipEnabled={projectClipEnabled(active)} onSettings={() => setSettingsOpen(true)} images={images} categories={categories} busy={busy} saving={boardSaves > 0} thumbnailCache={thumbnails} progress={progress} message={message} error={error} canExportFolder={canExportFolder}
      onExport={format => void exportSorted(format)}
      onBack={() => { showProject(); setMessage(''); window.requestAnimationFrame(() => window.scrollTo(0, 0)); }}
      onOpenImage={(image, context) => { reviewImage(image, context); }}
      onBackup={format => void exportBackup(format)} initialBrowser={initialBrowser} initialStashId={initialStashId} importedImageIds={importedImageIds}
      onAssign={saveAssignments} onRememberAction={history.remember} undo={!selected ? undoView : undefined}
      onCreateStash={createStash}
      onPrepareStash={async (id, width) => {
        const task = operations.begin('prepare-folder', 'Arranging folder…');
        try { if (await prepareStashBoard(active.id, id, width, readBoardPreferences(active.id).anchors)) await refresh(active.id); }
        finally { operations.finish(task); }
      }}
      onRenameStash={renameStash}
      onMoveFolder={moveFolder} onRequestFolderMove={setMovingFolderId}
      onDeleteEmptyStash={deleteEmptyStash}
      onPlaceOnBoard={boardActions.place} onRemoveFromBoard={boardActions.removeFromBoard} />
    {viewer}
    {settingsDialog}
    {folderMoveDialog}
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
      onOpen={openView} onOpenStash={openStash} onBrowse={() => { openWorkspace({ browser: true }); }} onRename={renameActiveProject}
      importedCount={importedCount}
      onShowImported={() => { if (!recentImport || recentImport.projectId !== activeId) return; openWorkspace({ browser: true, importedIds: recentImport.ids }); setMessage(''); }}
      onAddFiles={() => fileInput.current?.click()} onAddFolder={() => folderInput.current?.click()}
      onDrop={transfer => { void drop(transfer); }}
      onCreateProject={create} onImportZip={() => importZipInput.current?.click()} onImportFolder={() => importFolderInput.current?.click()}
      onCreateStash={async (name, parentId) => { await createStash([], parentId, name); }}
      onRenameStash={renameStash}
      onMoveFolder={setMovingFolderId}
      onDeleteEmptyStash={deleteEmptyStash}
      onSorted={format => void exportSorted(format)} onBackup={format => void exportBackup(format)} />

    <input ref={fileInput} className="library-hidden-input" type="file" accept="image/*" multiple onChange={(event) => { beginImport([...event.target.files || []].map((file) => ({ file, path: file.name }))); event.target.value = ''; }} />
    <input ref={folderInput} className="library-hidden-input" type="file" multiple onChange={(event) => { beginImport([...event.target.files || []].map((file) => ({ file, path: file.webkitRelativePath || file.name }))); event.target.value = ''; }} />
    <input ref={importZipInput} className="library-hidden-input" type="file" accept=".zip,application/zip" onChange={(event) => { void importZip(event.target.files?.[0]); event.target.value = ''; }} />
    <input ref={importFolderInput} className="library-hidden-input" type="file" multiple onChange={(event) => { void importFolder([...event.target.files || []]); event.target.value = ''; }} />
    {pendingImport ? <Modal className="library-import-overlay" label="Choose starting folders" onClose={() => setPendingImport(null)}>
      <div className="library-import-dialog"><div className="library-import-dialog__icon"><FolderInput size={26} /></div><h2>Import subfolders</h2>
        <p>{pendingImageCount} {pendingImageCount === 1 ? 'image' : 'images'} total. {pendingNestedCount} {pendingNestedCount === 1 ? 'image is' : 'images are'} in {pendingFolderCount} {pendingFolderCount === 1 ? 'subfolder' : 'subfolders'}{pendingImageCount > pendingNestedCount ? `; ${pendingImageCount - pendingNestedCount} ${pendingImageCount - pendingNestedCount === 1 ? 'is' : 'are'} in the main folder` : ''}. Keep this structure, or start with every image unsorted. Original folder paths are kept either way; other file types are skipped.</p>
        <div className="library-import-dialog__examples">{proposedSourceCategories(pendingImport).slice(0, 6).map((name) => <span key={name}>{name}</span>)}</div>
        <div className="library-import-dialog__actions"><button className="library-button library-button--quiet" type="button" onClick={() => setPendingImport(null)}>Cancel</button>
          <button className="library-button library-button--quiet" type="button" onClick={() => { const items = pendingImport; setPendingImport(null); void ingest(items); }}>Start unsorted</button>
          <button data-modal-autofocus className="library-button" type="button" onClick={() => { const items = pendingImport; setPendingImport(null); void ingest(items, true); }}>Keep subfolders</button></div>
      </div>
    </Modal> : null}
    {viewer}
    {settingsDialog}
    {folderMoveDialog}
  </div>);
}
