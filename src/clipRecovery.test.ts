import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const key = 'foldersort:clip-active';
let saved: Map<string, string>;
beforeEach(() => {
  saved = new Map();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => saved.get(key), setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) });
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it('holds the marker until all model owners release their workers', async () => {
  const recovery = await import('./clipRecovery');
  const one = {}, two = {};
  recovery.retainClipModels(one); recovery.retainClipModels(two);
  expect(saved.get(key)).toBe('1');
  recovery.releaseClipModels(one); expect(saved.get(key)).toBe('1');
  recovery.releaseClipModels(two); expect(saved.has(key)).toBe(false);
});
it('blocks restored model loading until explicit retry without touching other storage', async () => {
  saved.set(key, '1'); saved.set('project', 'keep');
  const recovery = await import('./clipRecovery');
  expect(() => recovery.retainClipModels({})).toThrow('CLIP was interrupted');
  recovery.releaseClipModels({}); // Disposing a cache-only worker must not erase recovery.
  expect(saved.has(key)).toBe(true);
  recovery.retryClipModels(); expect(saved.has(key)).toBe(false);
  const owner = {}; recovery.retainClipModels(owner); recovery.releaseClipModels(owner);
  expect(saved.get('project')).toBe('keep');
});
it('clears normal navigation and restores the marker for a page restored from the back-forward cache', async () => {
  const recovery = await import('./clipRecovery');
  const owner = {}; recovery.retainClipModels(owner);
  window.dispatchEvent(new Event('pagehide')); expect(saved.has(key)).toBe(false);
  window.dispatchEvent(new Event('pageshow')); expect(saved.get(key)).toBe('1');
  recovery.releaseClipModels(owner);
});
it('keeps sorting available when browser storage is restricted', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('Denied'); }, setItem: () => { throw new Error('Denied'); }, removeItem: () => { throw new Error('Denied'); } });
  const recovery = await import('./clipRecovery');
  const owner = {};
  expect(() => { recovery.retainClipModels(owner); recovery.releaseClipModels(owner); recovery.retryClipModels(); }).not.toThrow();
});
