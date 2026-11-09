// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useFolderNameDraft } from './useFolderNameDraft';
import type { LibraryCategory, LibraryImage } from './libraryStore';
const mocks = vi.hoisted(() => ({ suggestNames: vi.fn(), markFolderNamingPrompted: vi.fn() }));
vi.mock('./ContentIndex', () => ({ useContentIndex: () => ({ suggestNames: mocks.suggestNames }) }));
vi.mock('./libraryStore', () => ({ markFolderNamingPrompted: mocks.markFolderNamingPrompted }));
const folder = { id: 'f', name: 'Untitled folder', unnamed: true, namingPrompted: false } as LibraryCategory;
const images = [{ id: 'a', categoryId: 'f' }] as LibraryImage[];
beforeEach(() => { vi.resetAllMocks(); mocks.markFolderNamingPrompted.mockResolvedValue(undefined); });
it('keeps an edited label when suggestions complete later', async () => {
  let resolve!: (value: { label: string }[]) => void; mocks.suggestNames.mockReturnValue(new Promise(done => { resolve = done; }));
  const { result, unmount } = renderHook(() => useFolderNameDraft(folder, images, [folder], true, false, vi.fn()));
  act(() => result.current.edit('Handshakes'));
  await act(async () => resolve([{ label: 'Hands' }]));
  expect(result.current.name).toBe('Handshakes'); expect(result.current.names).toEqual(['Hands']); unmount();
});
it('can save while suggestions load, prevents a duplicate save and ignores their late completion', async () => {
  let suggestions!: (value: { label: string }[]) => void, saved!: () => void;
  mocks.suggestNames.mockReturnValue(new Promise(done => { suggestions = done; }));
  const rename = vi.fn().mockReturnValue(new Promise<void>(done => { saved = done; }));
  const { result, unmount } = renderHook(() => useFolderNameDraft(folder, images, [folder], true, false, rename));
  act(() => result.current.edit('Handshakes')); let pending!: Promise<boolean>;
  act(() => { pending = result.current.save(); });
  await act(async () => { expect(await result.current.save()).toBe(false); suggestions([{ label: 'Hands' }]); });
  expect(result.current.name).toBe('Handshakes'); expect(rename).toHaveBeenCalledOnce();
  await act(async () => { saved(); await pending; }); expect(result.current.open).toBe(false); unmount();
});
