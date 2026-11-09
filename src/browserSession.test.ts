import { describe, expect, it } from 'vitest';
import { browserContext, browserSession, BrowserScroll, persistedBrowserView } from './browserSession';
import { DEFAULT_BROWSER_VIEW } from './imageBrowserView';

describe('temporary import browsing', () => {
  it('preserves saved filters until explicitly leaving or choosing another view', () => {
    const saved = { ...DEFAULT_BROWSER_VIEW, query: 'hands', scrollTop: 720, collapsed: true };
    let state = browserContext(saved, true, true);
    expect(state.view.query).toBe('');
    expect(persistedBrowserView(state, 40)).toMatchObject({ query: 'hands', scrollTop: 720, collapsed: true });
    state = browserSession(state, { type: 'leave-import' });
    expect(state).toMatchObject({ imported: false, view: { query: 'hands', collapsed: false } });
    state = browserSession(browserContext(saved, true, true), { type: 'filters', patch: { query: 'peace' } });
    expect(persistedBrowserView(state, 40)).toMatchObject({ query: 'peace', scrollTop: 40, collapsed: false });
  });
  it('restores the prior scroll on return and after a collapsed DOM is remounted', () => {
    const scroll = new BrowserScroll({ ...DEFAULT_BROWSER_VIEW, collapsed: false, scrollTop: 720 });
    scroll.browse('imported'); scroll.restored(0); scroll.returning = 720;
    expect(scroll.browse('normal')).toBe(true); expect(scroll.restore).toBe(720);
    scroll.restored(700); scroll.visibility(true); scroll.visibility(false);
    expect(scroll.restore).toBe(700); expect(scroll.browse('normal')).toBe(false);
  });
});
