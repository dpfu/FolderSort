import { describe, expect, it } from 'vitest';
import { browserContext, browserSession, BrowserRangeSelection, BrowserScroll, persistedBrowserView } from './browserSession';
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

it('extends and shrinks ranges without losing separately selected images', () => {
  const range = new BrowserRangeSelection();
  const order = ['a', 'b', 'c', 'd', 'e'];
  range.pick('a', false, order, new Set());
  expect(new Set(range.pick('e', true, order, new Set(['a', 'other'])))).toEqual(new Set([...order, 'other']));
  expect(new Set(range.pick('c', true, order, new Set([...order, 'other'])))).toEqual(new Set(['a', 'b', 'c', 'other']));
});

it('uses filtered/reversed order and resets a missing range anchor', () => {
  const range = new BrowserRangeSelection();
  range.pick('e', false, ['e', 'd', 'c', 'b', 'a'], new Set());
  expect(range.pick('a', true, ['e', 'c', 'a'], new Set(['e']))).toEqual(['e', 'c', 'a']);
  expect(range.pick('b', true, ['b', 'd'], new Set())).toBeUndefined();
  expect(range.pick('d', true, ['b', 'd'], new Set(['b']))).toEqual(['b', 'd']);
});

it('does not restore a previously selected range after external deselection', () => {
  const range = new BrowserRangeSelection(), order = ['a', 'b', 'c', 'd'];
  range.pick('a', false, order, new Set());
  expect(range.pick('c', true, order, new Set(['a']))).toEqual(['a', 'b', 'c']);
  expect(range.pick('d', true, order, new Set())).toBeUndefined();
  expect(range.pick('c', true, order, new Set(['d']))).toEqual(['d', 'c']);
});
