import type { LibraryCategory, LibraryImage } from './libraryStore';

export type BrowserFilter = 'all' | 'unsorted' | 'sorted';
export type BrowserView = {
  width: number; size: number; collapsed: boolean; filter: BrowserFilter;
  stash: string; onBoard: boolean; query: string; focus: number;
};
export const DEFAULT_BROWSER_VIEW: BrowserView = { width: 344, size: 96, collapsed: false, filter: 'all', stash: 'all', onBoard: false, query: '', focus: 0 };

export function readImageBrowserView(projectId: string): BrowserView {
  try {
    const value = JSON.parse(localStorage.getItem(`folder-sort-browser:${projectId}`) || 'null');
    if (!value || typeof value !== 'object') return { ...DEFAULT_BROWSER_VIEW };
    return {
      width: Number.isFinite(value.width) ? Math.max(260, Math.min(560, value.width)) : 344,
      size: Number.isFinite(value.size) ? Math.max(72, Math.min(200, value.size)) : 96,
      collapsed: value.collapsed === true,
      filter: ['all', 'unsorted', 'sorted'].includes(value.filter) ? value.filter : 'all',
      stash: typeof value.stash === 'string' ? value.stash : 'all', onBoard: value.onBoard === true,
      query: typeof value.query === 'string' ? value.query.slice(0, 500) : '',
      focus: [0, 1, 2, 3].includes(value.focus) ? value.focus : 0,
    };
  } catch { return { ...DEFAULT_BROWSER_VIEW }; }
}

/** Assignment, working placement and search are independent facets of one collection. */
export function filterBrowserImages(images: LibraryImage[], categories: LibraryCategory[], onBoard: ReadonlySet<string>, view: Pick<BrowserView, 'filter' | 'stash' | 'onBoard' | 'query'>) {
  const names = new Map(categories.map(stash => [stash.id, stash.name]));
  const branch = names.get(view.stash)?.toLocaleLowerCase();
  const query = view.query.trim().toLocaleLowerCase();
  return images.filter(image => {
    if (view.filter === 'unsorted' && image.categoryId || view.filter === 'sorted' && !image.categoryId) return false;
    if (view.onBoard && !onBoard.has(image.id)) return false;
    const name = (names.get(image.categoryId || '') || '').toLocaleLowerCase();
    if (view.stash !== 'all' && (!branch || name !== branch && !name.startsWith(`${branch}/`))) return false;
    return !query || image.path.toLocaleLowerCase().includes(query) || name.includes(query);
  });
}

export function browserGeometry(width: number, size: number, count: number) {
  const padding = 12;
  const columns = Math.max(1, Math.floor((Math.max(0, width) - padding * 2 + 12) / (size + 12)));
  const columnWidth = Math.max(size, (width - padding * 2) / columns);
  const rowHeight = size + 20;
  return { columns, columnWidth, rowHeight, padding, height: Math.ceil(count / columns) * rowHeight + padding * 2 };
}
