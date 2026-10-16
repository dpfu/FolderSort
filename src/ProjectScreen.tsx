import * as React from 'react';
import { Download, Folder, FolderInput, FolderOpen, GalleryVerticalEnd, ImagePlus, LayoutDashboard, Pencil, Plus, Upload, CircleHelp } from 'lucide-react';
import ActionMenu from './ActionMenu';
import ExportActions, { StashExportActions } from './ExportActions';
import ProjectSettings from './ProjectSettings';
import { categoryColor, categoryCounts, categoryDepth } from './categoryTree';
import type { LibraryCategory, LibraryImage, LibraryProject } from './libraryStore';
import './project-screen.css';

type Props = {
  project?: LibraryProject; images: LibraryImage[]; categories: LibraryCategory[];
  clipEnabled: boolean; busy: boolean; progress: string; message: string; error: string; canFolder: boolean;
  onOpen: () => void; onBrowse: () => void; onAddFiles: () => void; onAddFolder: () => void;
  onDrop: (transfer: DataTransfer) => void; onClip: (enabled: boolean) => void;
  onRename: () => void; onRenameStash: (id: string, name: string) => Promise<void>;
  onCreateStash: (name: string, parentId: string | null) => Promise<void>;
  onCreateProject: (name: string) => Promise<boolean>; onImportZip: () => void; onImportFolder: () => void;
  onSorted: (format: 'zip' | 'folder') => void; onBackup: (format: 'zip' | 'folder') => void;
};

/** Project contents, entry points and administration. Sorting belongs to the board. */
export default function ProjectScreen(props: Props) {
  const [dragging, setDragging] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [stashName, setStashName] = React.useState(''), [parentId, setParentId] = React.useState('');
  const counts = React.useMemo(() => categoryCounts(props.images, props.categories), [props.images, props.categories]);
  const assigned = props.images.filter(image => !!image.categoryId).length;
  const total = props.images.length;
  const renameStash = (stash: LibraryCategory) => {
    const name = window.prompt('Stash path', stash.name);
    if (name !== null && name.trim() !== stash.name) void props.onRenameStash(stash.id, name).catch(() => {});
  };
  return <main className="project-screen">
    <header className="project-screen__heading">
      <div><h1>{props.project?.name || 'Folder Sort'}</h1><p>{props.project ? 'Stored in this browser' : 'Add an image folder to start a project.'}</p></div>
      {props.project && <button type="button" className="project-screen__rename" aria-label="Rename project" title="Rename project" disabled={props.busy} onClick={props.onRename}><Pencil size={18} /></button>}
    </header>
    {props.error && <p className="project-screen__error" role="alert">{props.error}</p>}
    {props.busy ? <p className="project-screen__status" role="status">{props.progress || 'Saving…'}</p> : props.message && <p className="project-screen__status" role="status">{props.message}</p>}
    {props.project && <>
      <div className="project-screen__counts" aria-label="Project contents">
        <span><strong>{total.toLocaleString()}</strong> images</span>
        <span><strong>{(total - assigned).toLocaleString()}</strong> unsorted</span>
        <span><strong>{props.categories.length.toLocaleString()}</strong> stashes</span>
      </div>
      <div className="project-screen__entry">
        <button type="button" className="library-button" aria-label="Open sorting workspace" disabled={props.busy || !total} onClick={props.onOpen}><LayoutDashboard size={18} />Open board</button>
        <button type="button" className="library-button library-button--quiet" aria-label="Explore project images" disabled={props.busy || !total} onClick={props.onBrowse}><GalleryVerticalEnd size={18} />Browse images</button>
        <ActionMenu label="Export project" className="project-export" trigger={<><Download size={18} /><span>Export</span></>}>
          <ExportActions projectName={props.project.name} images={props.images} categories={props.categories} busy={props.busy} canFolder={props.canFolder} onSorted={props.onSorted} onBackup={props.onBackup} />
        </ActionMenu>
      </div>
    </>}
    <section className={`project-intake${dragging ? ' is-dragging' : ''}`} aria-label="Add images"
      onDragEnter={event => { event.preventDefault(); setDragging(true); }}
      onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragging(true); }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
      onDrop={event => { event.preventDefault(); setDragging(false); if (!props.busy) props.onDrop(event.dataTransfer); }}>
      <ImagePlus size={24} aria-hidden="true" /><div><h2>{total ? 'Add images' : 'Drop an image folder here'}</h2><p>{total ? 'Drop a folder here, or choose files.' : 'Subfolders can become starting stashes.'}</p></div>
      <div className="project-intake__actions"><button type="button" className="library-button library-button--quiet" disabled={props.busy} onClick={props.onAddFiles}><Plus size={17} />Add files</button><button type="button" className="library-button library-button--quiet" disabled={props.busy} onClick={props.onAddFolder}><FolderOpen size={17} />Add folder</button></div>
      <small>PNG · JPEG · GIF · WebP · AVIF · SVG</small>
    </section>
    {props.project && <ProjectSettings enabled={props.clipEnabled} busy={props.busy} onChange={props.onClip} />}
    {props.project && <details className="project-stashes"><summary><Folder size={17} />Stashes <span>{props.categories.length}</span></summary>
      <section className="project-stashes__body" aria-label="Stashes">
        <div className="project-stashes__tools"><h2>Stashes</h2><ActionMenu label="Export stash hierarchy" icon="export"><StashExportActions projectName={props.project.name} categories={props.categories} images={props.images} busy={props.busy} /></ActionMenu></div>
        <form onSubmit={event => { event.preventDefault(); if (stashName.trim()) void props.onCreateStash(stashName.trim(), parentId || null).then(() => { setStashName(''); setParentId(''); }).catch(() => {}); }}>
          <select aria-label="Parent stash" disabled={props.busy} value={parentId} onChange={event => setParentId(event.target.value)}><option value="">Top level</option>{props.categories.map(stash => <option key={stash.id} value={stash.id}>{stash.name}</option>)}</select>
          <input aria-label="New stash name" placeholder="Stash name" value={stashName} disabled={props.busy} onChange={event => setStashName(event.target.value)} />
          <button type="submit" className="library-button library-button--quiet" disabled={props.busy || !stashName.trim()}><Plus size={17} />Create stash</button>
        </form>
        {props.categories.length > 0 && <div className="project-stashes__list">{props.categories.map(stash => <button key={stash.id} type="button" disabled={props.busy} title={`Rename ${stash.name}`} onClick={() => renameStash(stash)} style={{ '--category-depth': Math.min(5, categoryDepth(stash.name)), '--category-color': categoryColor(stash.name) } as React.CSSProperties}><Folder size={16} />{stash.name}<span title="Including sub-stashes">{counts.get(stash.id) || 0}</span></button>)}</div>}
      </section>
    </details>}
    <details className="library-project-management project-management" open={!total}>
      <summary><FolderInput size={17} />Project management</summary><section aria-label="Project management">
        <form onSubmit={event => { event.preventDefault(); void props.onCreateProject(newName).then(saved => { if (saved) setNewName(''); }); }}>
          <input aria-label="New project name" placeholder="Project name" value={newName} disabled={props.busy} onChange={event => setNewName(event.target.value)} />
          <button type="submit" className="library-button library-button--quiet" disabled={props.busy}><Plus size={17} />New project</button>
        </form>
        <div className="project-management__restore"><span>Restore a backup</span><button type="button" className="library-link-button" aria-label="Import project ZIP" disabled={props.busy} onClick={props.onImportZip}><Upload size={17} />ZIP</button><button type="button" className="library-link-button" aria-label="Import project folder" disabled={props.busy} onClick={props.onImportFolder}><FolderInput size={17} />Folder</button></div>
      </section>
    </details>
    <details className="project-help"><summary><CircleHelp size={17} />Help</summary><section aria-label="How Folder Sort works">
      <p>Place each image in one stash or sub-stash. Drag images together to create a stash, or select them and use Move to stash.</p>
      <p>Sorted exports contain the original images in stash folders and a CSV. Backups also keep project settings and image positions.</p>
    </section></details>
  </main>;
}
