import * as React from 'react';
import { Download, FolderInput, FolderOpen, ImagePlus, Plus, Search, Tags, Trash2, Upload, X } from 'lucide-react';
import {
  addImages, assignImageCategory, assignImageCategories, cleanRelativePath, createCategory, createProject, exportProjectDirectory, exportProjectZip,
  exportSortedDirectory, exportSortedZip, getActiveProjectId, getImageBlob, isImageFile,
  importProjectDirectory, importProjectZip, listCategories, listImages, listProjects, placeImagesOnBoard,
  removeImage, renameCategory, renameProject, returnImagesToTray, setActiveProjectId,
  type CategoryAssignment, type IncomingImage, type LibraryCategory, type LibraryImage, type LibraryProject,
} from './libraryStore';
import { proposedSourceCategories, sourceCategoryForPath } from './folderCategories';
import { categoryDepth, imageInCategoryBranch } from './categoryTree';
import ImageTile from './ImageTile';
import SortingWorkspace from './SortingWorkspace';

type SortView = 'library' | 'sort';
const LIBRARY_PAGE_SIZE = 60;

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

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function safeFilename(name: string) {
  return name.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'folder-sort';
}

function nameFromIncomingFolder(items: IncomingImage[]): string {
  const roots = new Set(items.map((item) => cleanRelativePath(item.path).split('/')[0]));
  return roots.size === 1 && items.some((item) => item.path.includes('/')) ? [...roots][0] : 'Untitled project';
}

function ImageViewer({ image, categories, onAssign, onCreateAndAssign, onClose, onRemove }: {
  image: LibraryImage;
  categories: LibraryCategory[];
  onAssign: (categoryId: string | null) => void;
  onCreateAndAssign: (name: string) => Promise<void>;
  onClose: () => void;
  onRemove: () => void;
}) {
  const [url, setUrl] = React.useState<string>();
  const [newCategory, setNewCategory] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState('');
  React.useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void getImageBlob(image.id).then((blob) => {
      if (blob && active) {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }
    });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image.id]);
  React.useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);
  return <div className="library-viewer" role="dialog" aria-modal="true" aria-label={image.path}>
    <div className="library-viewer__header">
      <div><strong>{image.path.split('/').at(-1)}</strong><small>{image.path} · {(image.size / 1024).toFixed(0)} KiB</small></div>
      <div className="library-viewer__actions">
        <label className="library-viewer__category">Category <select aria-label="Image category" value={image.categoryId || ''} onChange={(event) => onAssign(event.target.value || null)}>
          <option value="">Unassigned</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select></label>
        <button type="button" className="library-button library-button--quiet" onClick={onRemove}><Trash2 size={17} /> Remove</button>
        <button type="button" className="library-icon-button" onClick={onClose} aria-label="Close image"><X /></button>
      </div>
    </div>
    <form className="library-viewer__create" onSubmit={(event) => {
      event.preventDefault();
      setCreating(true); setCreateError('');
      void onCreateAndAssign(newCategory).then(() => setNewCategory('')).catch((cause) => setCreateError(cause instanceof Error ? cause.message : String(cause))).finally(() => setCreating(false));
    }}>
      <span>Sort this image:</span>
      <input aria-label="New category for image" placeholder="New category name" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} />
      <button className="library-button" type="submit" disabled={creating || !newCategory.trim()}><Plus size={16} /> Create & assign</button>
      {createError ? <small role="alert">{createError}</small> : null}
    </form>
    <div className="library-viewer__image">{url ? <img src={url} alt={image.path} /> : <span>Loading image…</span>}</div>
  </div>;
}

export default function LibraryApp() {
  const [projects, setProjects] = React.useState<LibraryProject[]>([]);
  const [activeId, setActiveId] = React.useState<string>();
  const [images, setImages] = React.useState<LibraryImage[]>([]);
  const [categories, setCategories] = React.useState<LibraryCategory[]>([]);
  const [categoryName, setCategoryName] = React.useState('');
  const [parentCategoryId, setParentCategoryId] = React.useState('');
  const [categoryFilter, setCategoryFilter] = React.useState('all');
  const [pendingImport, setPendingImport] = React.useState<IncomingImage[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  const [newName, setNewName] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [view, setView] = React.useState<SortView>('library');
  const [libraryPage, setLibraryPage] = React.useState(0);
  const [selected, setSelected] = React.useState<LibraryImage>();
  const [dragging, setDragging] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const folderInput = React.useRef<HTMLInputElement>(null);
  const importZipInput = React.useRef<HTMLInputElement>(null);
  const importFolderInput = React.useRef<HTMLInputElement>(null);
  const active = projects.find((project) => project.id === activeId);

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
    }
  };

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage(''); setProgress(label);
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); setProgress(''); }
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
      await refresh(projectId);
      setMessage(`${result.added} image${result.added === 1 ? '' : 's'} added${result.skipped ? `; ${result.skipped} skipped (duplicate path or unsupported type)` : ''}. Saved locally.`);
    });
  };

  const beginImport = (items: IncomingImage[]) => {
    if (!items.length) return;
    if (!items.some((item) => isImageFile(item.file))) { setError('No supported images found. Try PNG, JPG/JPEG, GIF, WebP, AVIF, or SVG files.'); return; }
    if (proposedSourceCategories(items).length) setPendingImport(items);
    else void ingest(items);
  };

  const resetViews = () => {
    setView('library'); setSearch(''); setCategoryFilter('all'); setLibraryPage(0);
  };

  const openView = () => {
    setView('sort');
    setError(''); setMessage('');
    window.requestAnimationFrame(() => window.scrollTo(0, 0));
  };

  const saveAssignment = (image: LibraryImage, categoryId: string | null, boardPosition?: { x: number; y: number }) => run('Saving category…', async () => {
    await assignImageCategory(image.id, categoryId, boardPosition);
    const changes = { categoryId, ...(boardPosition ? {
      placement: 'board' as const, boardX: Math.round(boardPosition.x), boardY: Math.round(boardPosition.y),
    } : {}) };
    setImages((current) => current.map((item) => item.id === image.id ? { ...item, ...changes } : item));
    setSelected((current) => current?.id === image.id ? { ...current, ...changes } : current);
    setProjects((current) => current.map((project) => project.id === image.projectId
      ? { ...project, updatedAt: Date.now() } : project));
    setMessage(boardPosition ? 'Image assigned and added to board.' : 'Category assignment saved.');
  });

  const saveAssignments = async (assignments: CategoryAssignment[]) => {
    if (!activeId) throw new Error('Create a project first');
    setBusy(true); setError(''); setMessage('');
    try {
      await assignImageCategories(activeId, assignments);
      const updates = new Map(assignments.map(assignment => [assignment.id, assignment]));
      const update = (image: LibraryImage) => {
        const change = updates.get(image.id);
        return change ? { ...image, categoryId: change.categoryId, ...(change.boardPosition ? {
          placement: 'board' as const, boardX: Math.round(change.boardPosition.x), boardY: Math.round(change.boardPosition.y),
        } : {}) } : image;
      };
      setImages(current => current.map(update));
      setSelected(current => current ? update(current) : current);
      setProjects(current => current.map(project => project.id === activeId ? { ...project, updatedAt: Date.now() } : project));
      setMessage(assignments.length === 1 ? assignments[0].boardPosition ? 'Image assigned and added to board.' : 'Category assignment saved.' : `${assignments.length.toLocaleString()} images assigned.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally { setBusy(false); }
  };

  const createAndAssign = async (image: LibraryImage, name: string) => {
    if (!activeId) throw new Error('Create a project first');
    const category = await createCategory(activeId, name);
    await assignImageCategory(image.id, category.id);
    setImages((current) => current.map((item) => item.id === image.id ? { ...item, categoryId: category.id } : item));
    setSelected((current) => current?.id === image.id ? { ...current, categoryId: category.id } : current);
    const [foundCategories, foundProjects] = await Promise.all([listCategories(activeId), listProjects()]);
    setCategories(foundCategories);
    setProjects(foundProjects);
    setMessage('Category created and assigned.');
  };

  const saveCategory = () => {
    if (!activeId) return;
    void run('Creating category…', async () => {
      const parent = categories.find((category) => category.id === parentCategoryId);
      await createCategory(activeId, parent ? `${parent.name}/${categoryName}` : categoryName);
      setCategoryName(''); setParentCategoryId(''); await refresh(activeId); setMessage('Category created.');
    });
  };

  const create = async () => run('Creating project…', async () => {
    const project = await createProject(newName || 'Untitled project');
    setNewName(''); resetViews(); setSelected(undefined); setPendingImport(null);
    setActiveId(project.id);
    await refresh(project.id);
    setMessage('Project created and saved locally.');
  });

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

  const categoryById = new Map(categories.map((category) => [category.id, category.name]));
  const filtered = images.filter((image) =>
    image.path.toLowerCase().includes(search.toLowerCase()) &&
    (categoryFilter === 'all' || (categoryFilter === 'unassigned' ? !image.categoryId : imageInCategoryBranch(image, categoryFilter, categoryById))));
  const pages = Math.max(1, Math.ceil(filtered.length / LIBRARY_PAGE_SIZE));
  const currentPage = Math.min(libraryPage, pages - 1);
  const visibleLibrary = filtered.slice(currentPage * LIBRARY_PAGE_SIZE, (currentPage + 1) * LIBRARY_PAGE_SIZE);
  const codedCount = images.filter((image) => Boolean(image.categoryId)).length;
  const canExportFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  const pendingImageCount = pendingImport?.filter((item) => isImageFile(item.file)).length || 0;

  const viewer = selected ? <ImageViewer image={selected} categories={categories} onAssign={(categoryId) => void saveAssignment(selected, categoryId)} onCreateAndAssign={(name) => createAndAssign(selected, name)} onClose={() => setSelected(undefined)} onRemove={() => {
    if (!window.confirm(`Remove ${selected.path} from this project? The source file on your computer will stay unchanged.`)) return;
    void run('Removing image…', async () => { await removeImage(selected.id); setSelected(undefined); await refresh(activeId); setMessage('Image removed from this project.'); });
  }} /> : null;

  if (active && view !== 'library') return <>
    <SortingWorkspace key={active.id} projectId={active.id} projectName={active.name} images={images} categories={categories} busy={busy} message={message} error={error}
      onBack={() => { setView('library'); setSelected(undefined); window.requestAnimationFrame(() => window.scrollTo(0, 0)); }}
      onOpenImage={setSelected}
      onAssign={saveAssignments}
      onCreateCategory={async (name) => {
        if (!activeId) throw new Error('Create a project first');
        const category = await createCategory(activeId, name);
        setCategories(await listCategories(activeId)); setMessage('Category created.');
        return category;
      }}
      onPlaceOnBoard={(moves) => {
        if (!activeId) return;
        const byId = new Map(moves.map((move) => [move.id, move]));
        setImages((current) => current.map((item) => {
          const move = byId.get(item.id);
          return move ? { ...item, placement: 'board', boardX: Math.round(move.x), boardY: Math.round(move.y) } : item;
        }));
        setMessage('Saving board…');
        void placeImagesOnBoard(activeId, moves).then(() => setMessage('Board saved.')).catch((cause) => {
          setError(cause instanceof Error ? cause.message : String(cause));
          void refresh(activeId);
        });
      }}
      onReturnToPile={(ids) => {
        if (!activeId) return;
        const selected = new Set(ids);
        setImages((current) => current.map((item) => selected.has(item.id)
          ? { ...item, placement: 'tray', boardX: undefined, boardY: undefined } : item));
        setMessage('Saving board…');
        void returnImagesToTray(activeId, ids).then(() => setMessage('Images returned to the pile.')).catch((cause) => {
          setError(cause instanceof Error ? cause.message : String(cause));
          void refresh(activeId);
        });
      }} />
    {viewer}
  </>;

  return <div className="library-app">
    <header className="library-header">
      <div className="library-brand"><FolderOpen aria-hidden="true" /><span>Folder <strong>Sort</strong></span></div>
      <div className="library-header__right">
        <label className="library-project-picker">Project
          <select aria-label="Project" value={activeId || ''} disabled={busy || !projects.length} onChange={(event) => {
            const id = event.target.value;
            setActiveId(id); setSelected(undefined); resetViews(); setPendingImport(null); setError(''); setMessage('');
            void setActiveProjectId(id).catch((cause) => setError(String(cause)));
          }}>
            {!projects.length ? <option value="">No projects yet</option> : null}
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
      </div>
    </header>

    <main className="library-main">
      <div className="library-heading">
        <div><h1>{active?.name || 'Folder Sort'}</h1><p>{active ? `${images.length} images · stored in this browser` : 'Add an image folder to create a project, or make an empty project first.'}</p></div>
        {active ? <div className="library-heading__actions">
          <button className="library-button library-button--quiet" type="button" disabled={busy} onClick={() => {
            const name = window.prompt('Project name', active.name);
            if (name === null || name.trim() === active.name) return;
            void run('Renaming project…', async () => { await renameProject(active.id, name); await refresh(active.id); setMessage('Project renamed.'); });
          }}>Rename</button>
          <button className="library-button" type="button" disabled={busy} onClick={() => void run('Preparing ZIP…', async () => {
            download(await exportProjectZip(active.id), `${safeFilename(active.name)}.zip`);
            setMessage('Project ZIP is ready to download.');
          })}><Download size={17} /> Backup ZIP</button>
          {canExportFolder ? <button className="library-button library-button--quiet" type="button" disabled={busy} onClick={() => void run('Exporting folder…', async () => {
            const picker = (window as unknown as { showDirectoryPicker: (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
            const parent = await picker({ mode: 'readwrite' });
            const folderName = `${safeFilename(active.name)}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
            const folder = await parent.getDirectoryHandle(folderName, { create: true });
            await exportProjectDirectory(active.id, folder);
            setMessage(`Project saved in the ${folderName} folder.`);
          })}><FolderOpen size={17} /> Backup folder</button> : null}
        </div> : null}
      </div>

      <section className="library-premise" aria-label="How Folder Sort works">
        <strong>Folders in. Sorted folders out.</strong>
        <p>Add a folder of images. If it has subfolders, choose whether they become starting categories or begin with every image unassigned. Put each image in one category or subcategory, then export the original images into matching folders.</p>
      </section>

      <section className="library-project-tools" aria-label="Project management">
        <form onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <input aria-label="New project name" placeholder="New project name" value={newName} onChange={(event) => setNewName(event.target.value)} disabled={busy} />
          <button type="submit" className="library-button library-button--quiet" disabled={busy}><Plus size={17} /> New project</button>
        </form>
        <span className="library-tools-divider" aria-hidden="true" />
        <button type="button" className="library-link-button" disabled={busy} onClick={() => importZipInput.current?.click()}><Upload size={16} /> Import project ZIP</button>
        <button type="button" className="library-link-button" disabled={busy} onClick={() => importFolderInput.current?.click()}><FolderInput size={16} /> Import project folder</button>
      </section>

      {error ? <div className="library-notice library-notice--error" role="alert">{error}</div> : null}
      {message ? <div className="library-notice" role="status">{message}</div> : null}
      {busy ? <div className="library-notice" role="status">{progress}</div> : null}

      {active && images.length ? <section className="library-view-choices" aria-label="Ways to sort">
          <div className="library-view-choices__heading"><h2>Start sorting</h2><p>{codedCount} assigned · {images.length - codedCount} unassigned</p></div>
          <div className="library-view-choices__buttons">
            <button type="button" className="library-view-choice" onClick={openView}><ImagePlus size={20} /><span><strong>Open sorting workspace</strong><small>Add random images from the pile, arrange them, and sort them into categories.</small></span></button>
          </div>
        </section> : null}
        <section className={`library-dropzone${dragging ? ' library-dropzone--dragging' : ''}`} aria-label="Add images"
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragging(true); }}
          onDragLeave={(event) => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
          onDrop={(event) => {
            event.preventDefault(); setDragging(false);
            if (busy) return;
            const promise = droppedFiles(event.dataTransfer);
            void promise.then(beginImport).catch((cause) => setError(String(cause)));
          }}>
          <ImagePlus size={30} aria-hidden="true" />
          <div><strong>Drop an image folder here</strong><span>Or add files. Images stay on this device; source folder paths are kept for reference.</span><span>Common formats: PNG, JPG/JPEG, GIF, WebP, AVIF, SVG. Other image formats depend on your browser.</span></div>
          <div className="library-dropzone__buttons">
            <button className="library-button" type="button" disabled={busy} onClick={() => fileInput.current?.click()}><Plus size={17} /> Add files</button>
            <button className="library-button library-button--quiet" type="button" disabled={busy} onClick={() => folderInput.current?.click()}><FolderOpen size={17} /> Add folder</button>
          </div>
        </section>

      {active ? <>
        <section className="library-categories" aria-label="Categories">
          <div className="library-categories__intro"><Tags size={21} aria-hidden="true" /><div><h2>Categories and subcategories</h2><p>Each image has one direct category. Add a category inside another to make a subcategory. Parent counts include their subcategories; source paths stay unchanged.</p></div></div>
          <form onSubmit={(event) => { event.preventDefault(); saveCategory(); }}>
            <select aria-label="Parent category" value={parentCategoryId} disabled={busy} onChange={(event) => setParentCategoryId(event.target.value)}>
              <option value="">Top level</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <input aria-label="New category name" placeholder="New category" value={categoryName} disabled={busy} onChange={(event) => setCategoryName(event.target.value)} />
            <button className="library-button library-button--quiet" type="submit" disabled={busy || !categoryName.trim()}><Plus size={16} /> Add category</button>
          </form>
          {categories.length ? <div className="library-categories__list">{categories.map((category) =>
            <button key={category.id} type="button" disabled={busy} title={`Rename ${category.name}`} onClick={() => {
              const name = window.prompt('Category name', category.name);
              if (name === null || name.trim() === category.name) return;
              void run('Renaming category…', async () => { await renameCategory(category.id, name); await refresh(activeId); setMessage('Category renamed.'); });
            }} style={{ '--category-depth': Math.min(4, categoryDepth(category.name)) } as React.CSSProperties}>{category.name} <span>{images.filter((image) => imageInCategoryBranch(image, category.id, categoryById)).length}</span></button>
          )}</div> : null}
          {images.length ? <div className="library-categories__export">
            <button className="library-button" type="button" disabled={busy} onClick={() => void run('Preparing sorted ZIP…', async () => {
              download(await exportSortedZip(active.id), `${safeFilename(active.name)}-sorted.zip`);
              setMessage('Sorted ZIP is ready to download.');
            })}><Download size={17} /> Export sorted ZIP</button>
            {canExportFolder ? <button className="library-button library-button--quiet" type="button" disabled={busy} onClick={() => void run('Exporting sorted folder…', async () => {
              const picker = (window as unknown as { showDirectoryPicker: (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
              const parent = await picker({ mode: 'readwrite' });
              const folderName = `${safeFilename(active.name)}-sorted-${new Date().toISOString().replace(/[:.]/g, '-')}`;
              const folder = await parent.getDirectoryHandle(folderName, { create: true });
              await exportSortedDirectory(active.id, folder);
              setMessage(`Sorted images saved in the ${folderName} folder.`);
            })}><FolderOpen size={17} /> Export sorted folder</button> : null}
          </div> : null}
        </section>

        {images.length ? <section aria-label="Library images">
          <div className="library-browserbar"><h2>Images</h2><label><Search size={17} aria-hidden="true" /><input type="search" aria-label="Search images" placeholder="Search filenames or paths" value={search} onChange={(event) => { setSearch(event.target.value); setLibraryPage(0); }} /></label>
            <select aria-label="Filter by category" value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setLibraryPage(0); }}>
              <option value="all">All categories</option><option value="unassigned">Unassigned</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name} ({images.filter((image) => imageInCategoryBranch(image, category.id, categoryById)).length})</option>)}
            </select><span>{filtered.length} shown</span></div>
          {visibleLibrary.length ? <div className="library-grid">{visibleLibrary.map((image) => <ImageTile key={image.id} image={image} category={image.categoryId ? categoryById.get(image.categoryId) : undefined} onOpen={() => setSelected(image)} />)}</div> : <p className="library-empty">No images match this view.</p>}
          {pages > 1 ? <nav className="library-pagination" aria-label="Image pages"><button type="button" disabled={currentPage <= 0} onClick={() => setLibraryPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {pages}</span><button type="button" disabled={currentPage >= pages - 1} onClick={() => setLibraryPage(currentPage + 1)}>Next</button></nav> : null}
        </section> : <p className="library-empty">No images yet. Add files or drop a folder to begin.</p>}
      </> : null}
    </main>

    <input ref={fileInput} className="library-hidden-input" type="file" accept="image/*" multiple onChange={(event) => { beginImport([...event.target.files || []].map((file) => ({ file, path: file.name }))); event.target.value = ''; }} />
    <input ref={folderInput} className="library-hidden-input" type="file" multiple onChange={(event) => { beginImport([...event.target.files || []].map((file) => ({ file, path: file.webkitRelativePath || file.name }))); event.target.value = ''; }} />
    <input ref={importZipInput} className="library-hidden-input" type="file" accept=".zip,application/zip" onChange={(event) => { void importZip(event.target.files?.[0]); event.target.value = ''; }} />
    <input ref={importFolderInput} className="library-hidden-input" type="file" multiple onChange={(event) => { void importFolder([...event.target.files || []]); event.target.value = ''; }} />
    {pendingImport ? <div className="library-import-overlay" role="dialog" aria-modal="true" aria-label="Choose starting categories">
      <div className="library-import-dialog"><h2>How should Folder Sort use these subfolders?</h2>
        <p>{pendingImageCount} {pendingImageCount === 1 ? 'image is' : 'images are'} inside {proposedSourceCategories(pendingImport).length} nested folder {proposedSourceCategories(pendingImport).length === 1 ? 'path' : 'paths'}. Keep those paths as starting categories, or start fresh with every image unassigned. Each image can be moved to one category later. Original folder paths are kept for reference either way; other file types are skipped.</p>
        <div className="library-import-dialog__examples">{proposedSourceCategories(pendingImport).slice(0, 6).map((name) => <span key={name}>{name}</span>)}</div>
        <div className="library-import-dialog__actions"><button className="library-button library-button--quiet" type="button" onClick={() => setPendingImport(null)}>Cancel</button>
          <button className="library-button library-button--quiet" type="button" onClick={() => { const items = pendingImport; setPendingImport(null); void ingest(items); }}>Start fresh · ignore subfolders</button>
          <button className="library-button" type="button" onClick={() => { const items = pendingImport; setPendingImport(null); void ingest(items, true); }}>Keep subfolders as categories</button></div>
      </div>
    </div> : null}
    {viewer}
  </div>;
}
