/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useContentAnalysis } from './useContentAnalysis';
import type { LibraryImage } from './libraryStore';
import { normalizeVector, packVector } from './contentSimilarity';
import * as React from 'react';
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), analyze: vi.fn(), dispose: vi.fn(), initialize: vi.fn(), cache: vi.fn(), labels: vi.fn() }));
vi.mock('./libraryStore', () => ({
  clearContentAnalysis: vi.fn(), getImageBlob: async () => new Blob(['image'], { type: 'image/png' }),
  listImages: mocks.read, saveImageMetadata: mocks.save,
}));
vi.mock('./clipClient', () => ({
  ClipError: class ClipError extends Error { constructor(message: string, readonly stage: string) { super(message); } },
  ClipClient: class {
    ready = false;
    cache = mocks.cache; labels = mocks.labels; initialize = async () => { if (!this.ready) { await mocks.initialize(); this.ready = true; } }; analyze = mocks.analyze; dispose = mocks.dispose;
  },
}));
const images: LibraryImage[] = [{ id: 'one', projectId: 'p', path: 'one.png', categoryId: null, mime: 'image/png', size: 1, addedAt: 1 }];
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue([]); mocks.save.mockResolvedValue(undefined); mocks.cache.mockResolvedValue(undefined); mocks.labels.mockResolvedValue([{ label: 'Cats', score: .5 }]); mocks.analyze.mockResolvedValue({ model: 'test', vector: 'embedding' }); });
afterEach(cleanup);
it('prepares both encoders when enabled, even before importing any images', async () => {
  const { result, rerender } = renderHook(({ enabled }) => useContentAnalysis([], enabled), { initialProps: { enabled: false } });
  expect(mocks.initialize).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await waitFor(() => expect(result.current.progress.phase).toBe('ready'));
  expect(mocks.initialize).toHaveBeenCalledOnce(); expect(mocks.analyze).not.toHaveBeenCalled();
  rerender({ enabled: false }); expect(mocks.dispose).toHaveBeenCalled();
});
it('sends saved embeddings to a preloaded worker when the project image list arrives later', async () => {
  const values = new Float32Array(512); values[0] = 1;
  const clip = packVector(normalizeVector(values));
  const stored = [{ ...images[0], clip }];
  const { result, rerender } = renderHook(({ loaded }) => useContentAnalysis(loaded), { initialProps: { loaded: [] as LibraryImage[] } });
  await waitFor(() => expect(result.current.progress.phase).toBe('ready'));
  mocks.read.mockResolvedValue(stored);
  rerender({ loaded: stored });
  await waitFor(() => expect(mocks.cache).toHaveBeenCalledWith([{ id: 'one', clip }]));
  await act(async () => { expect(await result.current.suggestNames(['one'], ['Cats'])).toEqual([{ label: 'Cats', score: .5 }]); });
  expect(mocks.labels).toHaveBeenCalledWith(['one'], ['Cats'], 3);
  expect(mocks.analyze).not.toHaveBeenCalled();
});
it('reports a failed index write and recomputes unsaved embeddings on retry', async () => {
  mocks.save.mockRejectedValueOnce(new Error('Storage full'));
  const { result } = renderHook(() => useContentAnalysis(images));
  await waitFor(() => expect(result.current.progress.phase).toBe('error'));
  expect(result.current.progress.done).toBe(0);
  expect(result.current.progress.error).toContain('Storage full');
  await act(async () => { await result.current.start(); });
  expect(result.current.progress.phase).toBe('ready');
  expect(result.current.progress.done).toBe(1);
  expect(mocks.analyze).toHaveBeenCalledTimes(2);
  expect(mocks.save).toHaveBeenCalledTimes(2);
});
it('can retry a failed cache read instead of retaining a rejected hydration promise', async () => {
  mocks.read.mockRejectedValueOnce(new Error('Temporary read failure'));
  const { result } = renderHook(() => useContentAnalysis(images));
  await waitFor(() => expect(result.current.progress.phase).toBe('error'));
  await act(async () => { await result.current.start(); });
  expect(result.current.progress.phase).toBe('ready');
  expect(mocks.analyze).toHaveBeenCalledTimes(1);
});

it('recovers from Strict Mode cleanup without publishing the old hydration or starting overlapping indexing', async () => {
  const { result } = renderHook(() => useContentAnalysis(images), { wrapper: React.StrictMode });
  await waitFor(() => expect(result.current.progress.phase).toBe('ready'));
  expect(mocks.analyze).toHaveBeenCalledOnce();
  expect(result.current.progress.done).toBe(1);
});

it('rejects pending references when paused during model loading and resumes after the old task drains', async () => {
  let loaded!: () => void;
  mocks.initialize.mockImplementationOnce(() => new Promise<void>(resolve => { loaded = resolve; }));
  const { result } = renderHook(() => useContentAnalysis(images));
  await waitFor(() => expect(result.current.progress.phase).toBe('loading'));
  let reference!: Promise<unknown>;
  await act(async () => { reference = result.current.ensureReferences(['one']).catch(cause => cause); });
  act(() => result.current.pause());
  expect(await reference).toMatchObject({ message: expect.stringContaining('paused') });
  expect(mocks.dispose).toHaveBeenCalledOnce(); expect(mocks.analyze).not.toHaveBeenCalled();
  await act(async () => { loaded(); await result.current.start(); });
  expect(result.current.progress.phase).toBe('ready'); expect(mocks.analyze).toHaveBeenCalledOnce();
});
