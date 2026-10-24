import type { LibraryCategory, LibraryImage } from './libraryStore';

export type BrowserFilter = 'all' | 'unsorted' | 'sorted';
export type BrowserView = {
  width: number; size: number; collapsed: boolean; filter: BrowserFilter;
  stash: string; inFolder: boolean; query: string; focus: number; scrollTop: number;
};
const defaultWidth = () => typeof window === 'undefined' ? 440 : Math.max(300, Math.min(560, Math.round(window.innerWidth * .34)));
export const DEFAULT_BROWSER_VIEW: BrowserView = { width: 440, size: 120, collapsed: false, filter: 'all', stash: 'all', inFolder: false, query: '', focus: 0, scrollTop: 0 };

export function readImageBrowserView(projectId: string): BrowserView {
  try {
    const value = JSON.parse(localStorage.getItem(`folder-sort-browser:${projectId}`) || 'null');
    if (!value || typeof value !== 'object') return { ...DEFAULT_BROWSER_VIEW, width: defaultWidth() };
    return {
      width: Number.isFinite(value.width) && !(value.version !== 2 && value.width === 344) ? Math.max(260, Math.min(560, value.width)) : defaultWidth(),
      size: Number.isFinite(value.size) && !(value.version !== 2 && value.size === 96) ? Math.max(72, Math.min(200, value.size)) : 120,
      collapsed: value.collapsed === true,
      filter: ['all', 'unsorted', 'sorted'].includes(value.filter) ? value.filter : 'all',
      stash: typeof value.stash === 'string' ? value.stash : 'all', inFolder: (value.inFolder ?? value.onBoard) === true,
      query: typeof value.query === 'string' ? value.query.slice(0, 500) : '',
      focus: [0, 1, 2, 3].includes(value.focus) ? value.focus : 0,
      scrollTop: Number.isFinite(value.scrollTop) ? Math.max(0, Math.min(10_000_000, value.scrollTop)) : 0,
    };
  } catch { return { ...DEFAULT_BROWSER_VIEW, width: defaultWidth() }; }
}

/** Folder membership and search filter the project-wide collection without moving images. */
export function filterBrowserImages(images: LibraryImage[], categories: LibraryCategory[], scopeId: string | null, view: Pick<BrowserView, 'filter' | 'stash' | 'inFolder' | 'query'>) {
  const names = new Map(categories.map(stash => [stash.id, stash.name]));
  const branch = names.get(view.stash)?.toLocaleLowerCase();
  const query = view.query.trim().toLocaleLowerCase();
  return images.filter(image => {
    if (view.filter === 'unsorted' && image.categoryId || view.filter === 'sorted' && !image.categoryId) return false;
    if (view.inFolder && image.categoryId !== scopeId) return false;
    const name = (names.get(image.categoryId || '') || '').toLocaleLowerCase();
    if (view.stash !== 'all' && (!branch || name !== branch && !name.startsWith(`${branch}/`))) return false;
    return !query || image.path.toLocaleLowerCase().includes(query) || name.includes(query);
  });
}

export function browserGeometry(width: number, size: number, count: number) {
  const padding = 16, gap = 12;
  const columns = Math.max(1, Math.floor((Math.max(0, width) - padding * 2 + 12) / (size + 12)));
  const columnWidth = Math.max(size + gap, (width - padding * 2 + gap) / columns);
  const imageWidth = columnWidth - gap, imageHeight = imageWidth * .7;
  const rowHeight = imageHeight + 36;
  return { columns, columnWidth, imageWidth, imageHeight, rowHeight, padding, height: Math.ceil(count / columns) * rowHeight + padding * 2 };
}
