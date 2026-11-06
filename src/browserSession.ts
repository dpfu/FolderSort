import type { BrowserView } from './imageBrowserView';

export type BrowserContext = { view: BrowserView; imported: boolean; saved: BrowserView };
type Event = { type: 'view'; update: (view: BrowserView) => BrowserView }
  | { type: 'filters'; patch: Partial<BrowserView> } | { type: 'leave-import' };
export function browserContext(saved: BrowserView, expanded: boolean, imported: boolean): BrowserContext {
  return { saved, imported, view: { ...saved, ...(expanded ? { collapsed: false } : {}),
    ...(imported ? { filter: 'all', stash: 'all', inFolder: false, query: '', scrollTop: 0 } : {}) } };
}
export function browserSession(state: BrowserContext, event: Event): BrowserContext {
  switch (event.type) {
    case 'view': return { ...state, view: event.update(state.view) };
    case 'filters': return { ...state, imported: false, view: { ...state.view, ...event.patch } };
    case 'leave-import': {
      const { filter, stash, inFolder, query } = state.saved;
      return { ...state, imported: false, view: { ...state.view, filter, stash, inFolder, query } };
    }
  }
}
export function persistedBrowserView(state: BrowserContext, scrollTop: number) {
  const { filter, stash, inFolder, query, collapsed, scrollTop: savedTop } = state.saved;
  return { ...state.view, scrollTop, ...(state.imported ? { filter, stash, inFolder, query, collapsed, scrollTop: savedTop } : {}), version: 2 };
}

/** Scroll intent survives DOM removal, reflow and virtualization separately from filters. */
export class BrowserScroll {
  last: number;
  restore: number | null;
  anchor?: { id: string; offset: number };
  focus?: string;
  returning: number | null = null;
  private collapsed: boolean;
  private browseKey?: string;
  constructor(view: BrowserView) { this.last = this.restore = view.scrollTop; this.collapsed = view.collapsed; }
  visibility(collapsed: boolean) {
    if (this.collapsed && !collapsed) this.restore = this.last;
    this.collapsed = collapsed;
  }
  browse(key: string) {
    if (this.browseKey === undefined) { this.browseKey = key; return false; }
    if (this.browseKey === key) return false;
    this.browseKey = key; this.restore = this.returning; this.last = this.returning ?? 0; this.returning = null;
    return true;
  }
  restored(actual: number) { this.last = actual; this.restore = null; }
}
