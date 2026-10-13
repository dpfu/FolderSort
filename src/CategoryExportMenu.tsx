import { FileJson, FileText } from 'lucide-react';
import ExportMenu from './ExportMenu';
import { categoryMarkdown, categorySystem } from './categoryExport';
import { download, safeFilename } from './download';
import type { LibraryCategory, LibraryImage } from './libraryStore';

export default function CategoryExportMenu({ projectName, categories, images, busy, compact, light, embedded }: {
  projectName: string; categories: LibraryCategory[]; images: LibraryImage[]; busy: boolean; compact?: boolean; light?: boolean; embedded?: boolean;
}) {
  const save = (format: 'md' | 'json') => {
    const system = categorySystem(projectName, categories, images);
    const content = format === 'md' ? categoryMarkdown(system) : `${JSON.stringify(system, null, 2)}\n`;
    download(new Blob([content], { type: format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8' }), `${safeFilename(projectName)}-stashes.${format}`);
  };
  const options = <>
    <p>Full hierarchy with image counts</p>
    <button type="button" disabled={busy} onClick={() => save('md')}><FileText size={17} /><span>Markdown<small>Readable, nested outline</small></span></button>
    <button type="button" disabled={busy} onClick={() => save('json')}><FileJson size={17} /><span>JSON<small>Structured stash tree</small></span></button>
  </>;
  return embedded ? options : <ExportMenu label="Export stashes" compact={compact} light={light}>{options}</ExportMenu>;
}
