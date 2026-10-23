import type { ReactNode } from 'react';
import { FileJson, FileText, FolderOutput, Image as ImageIcon } from 'lucide-react';
import { categoryMarkdown, categorySystem } from './categoryExport';
import { download, safeFilename } from './download';
import type { LibraryCategory, LibraryImage } from './libraryStore';
import type { BoardExportScope } from './boardExport';
import { MenuItem } from './UiActions';

export function StashExportActions({ projectName, categories, images, busy }: {
  projectName: string; categories: LibraryCategory[]; images: LibraryImage[]; busy: boolean;
}) {
  const save = (format: 'md' | 'json') => {
    const system = categorySystem(projectName, categories, images);
    download(new Blob([format === 'md' ? categoryMarkdown(system) : `${JSON.stringify(system, null, 2)}\n`], {
      type: format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8',
    }), `${safeFilename(projectName)}-stashes.${format}`);
  };
  return <><button type="button" className="action-menu__item" data-close-menu disabled={busy} onClick={() => save('md')}><FileText size={18} /><span>Markdown</span></button>
    <button type="button" className="action-menu__item" data-close-menu disabled={busy} onClick={() => save('json')}><FileJson size={18} /><span>JSON</span></button></>;
}

export default function ExportActions({ projectName, boardName, categories, images, busy, canFolder, onSorted, onBackup, onBoardPng, exportingImage, boardFeedback }: {
  boardName?: string;
  projectName: string; categories: LibraryCategory[]; images: LibraryImage[]; busy: boolean; canFolder: boolean;
  onSorted: (format: 'zip' | 'folder') => void; onBackup?: (format: 'zip' | 'folder') => void;
  onBoardPng?: (scope: BoardExportScope) => void; exportingImage?: boolean; boardFeedback?: ReactNode;
}) {
  return <>
    <h3>Entire project · images + CSV</h3>
    <p>{images.length.toLocaleString()} images · {images.filter(image => !image.categoryId).length.toLocaleString()} unsorted</p>
    <MenuItem icon="export" label="Download ZIP" aria-label="Export sorted ZIP" disabled={busy || !images.length} onClick={() => onSorted('zip')} />
    {canFolder && <button type="button" className="action-menu__item" data-close-menu aria-label="Export sorted folder" disabled={busy || !images.length} onClick={() => onSorted('folder')}><FolderOutput size={18} /><span>Save to folder</span></button>}
    <p>Originals in stash folders. Unsorted images go in _Unassigned.</p>
    {onBoardPng && <><h3>Current board · {boardName}</h3>{boardFeedback}
      <button type="button" className="action-menu__item" data-close-menu aria-label="Save visible board" disabled={busy || exportingImage} onClick={() => onBoardPng('view')}><ImageIcon size={18} /><span>Visible board PNG</span></button>
      <button type="button" className="action-menu__item" data-close-menu aria-label="Save whole board" disabled={busy || exportingImage} onClick={() => onBoardPng('all')}><ImageIcon size={18} /><span>Whole board PNG</span></button></>}
    <h3>Stash hierarchy</h3><StashExportActions {...{ projectName, categories, images, busy }} />
    {onBackup && <><h3>Project backup</h3>
      <MenuItem icon="export" label="Backup ZIP" disabled={busy} onClick={() => onBackup('zip')} />
      {canFolder && <button type="button" className="action-menu__item" data-close-menu disabled={busy} onClick={() => onBackup('folder')}><FolderOutput size={18} /><span>Backup folder</span></button>}</>}
  </>;
}
