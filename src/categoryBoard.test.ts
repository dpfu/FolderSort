import { afterEach, expect, it, vi } from 'vitest';
import { readBoardPreferences } from './categoryBoard';
import { readStashView } from './stashView';
afterEach(() => vi.unstubAllGlobals());
it('retains legacy view preferences and saved stash anchors', () => {
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ mode: 'linked', anchors: { old: { x: 280, y: 170 } }, expanded: ['old'], autoNext: true }) });
  expect(readBoardPreferences('p')).toEqual({ mode: 'linked', anchors: { old: { x: 280, y: 170 } }, expanded: ['old'], autoNext: true });
});
it('ignores invalid camera records without losing valid navigation', () => {
  vi.stubGlobal('localStorage', { getItem: () => '{"active":"stash","cameras":{"root":{"x":20,"y":40,"zoom":1},"broken":{"x":1e400,"y":20,"zoom":1},"old":{"x":20,"y":40,"zoom":100},"__proto__":{"x":1,"y":1,"zoom":1}}}' });
  expect(readStashView('p')).toEqual({ active: 'stash', cameras: { root: { x: 20, y: 40, zoom: 1 } } });
});
it('recovers from blocked storage, malformed JSON and non-object camera maps', () => {
  for (const value of ['null', '{}', '{', '{"cameras":"broken"}', '{"cameras":[]}']) {
    vi.stubGlobal('localStorage', { getItem: () => value });
    expect(readStashView('p')).toEqual({ active: null, cameras: {} });
  }
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Blocked'); } });
  expect(readStashView('p')).toEqual({ active: null, cameras: {} });
  expect(readBoardPreferences('p').anchors).toEqual({});
});
