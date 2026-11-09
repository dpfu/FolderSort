import { expect, it } from 'vitest';
import { resolveImageDrop, type ImageDragSource } from './imageDrop';

it('gives breadcrumbs and a completed grouping hold precedence over lower targets', () => {
  const hits = { source: { kind: 'board' } as const, staging: true, parent: { folderId: null }, groupingImageId: 'image', folderId: 'folder', overBrowser: true, boardPoint: { x: 1, y: 2 } };
  expect(resolveImageDrop(hits)).toEqual({ kind: 'parent', folderId: null });
  expect(resolveImageDrop({ ...hits, parent: undefined })).toEqual({ kind: 'group', imageId: 'image' });
  expect(resolveImageDrop({ ...hits, parent: undefined, groupingImageId: undefined })).toEqual({ kind: 'folder', folderId: 'folder' });
});

it('returns only staged cards to waiting and rejects extracting a preview into its own folder', () => {
  expect(resolveImageDrop({ source: { kind: 'board' }, staging: true, overBrowser: true })).toEqual({ kind: 'waiting' });
  expect(resolveImageDrop({ source: { kind: 'board' }, staging: false, overBrowser: true })).toEqual({ kind: 'reject' });
  expect(resolveImageDrop({ source: { kind: 'folder-preview', folderId: 'a' }, staging: true, folderId: 'a', boardPoint: { x: 5, y: 6 } })).toEqual({ kind: 'reject' });
});

it.each<ImageDragSource>([{ kind: 'board' }, { kind: 'browser' }, { kind: 'folder-preview', folderId: 'a' }])('keeps explicit board coordinates and rejects a missing destination for $kind', source => {
  const point = { x: 23.5, y: 180 };
  expect(resolveImageDrop({ source, staging: true, boardPoint: point })).toEqual({ kind: 'place', point });
  expect(resolveImageDrop({ source, staging: true })).toEqual({ kind: 'reject' });
});
