import { expect, it } from 'vitest';
import { consumePreview, emptyPreviewBatch, previewMoves, reconcilePreview, resizePreview, togglePreview } from './previewBatch';
import { PreviewSession } from './previewSession';
const pool = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }));
const points = [{ x: 11, y: 20 }, { x: 195, y: 20 }, { x: 379, y: 20 }];
const start = () => resizePreview({ ...emptyPreviewBatch<{ id: string }>(), pool }, points, () => true);

it('deselects without moving or replacing images and accepts only retained coordinates', () => {
  const batch = togglePreview(start(), 'b');
  expect(previewMoves(batch)).toEqual(points.map((point, i) => ({ ...point, id: pool[i].id })));
  expect(previewMoves(batch, true).map(move => move.id)).toEqual(['a', 'c']);
  expect(previewMoves(togglePreview(batch, 'b'), true)).toHaveLength(3);
});
it('refills exactly the consumed slot, preserving all other occupants and inclusion choices', () => {
  const batch = reconcilePreview(consumePreview(togglePreview(start(), 'b'), 'a'), id => id !== 'a');
  expect(batch.slots.map(slot => slot.item?.id)).toEqual(['d', 'b', 'c']);
  expect(batch.slots[1].included).toBe(false);
  expect(previewMoves(batch).map(({ x, y }) => ({ x, y }))).toEqual(points);
});
it('restores successive dropped occupants and their checkboxes on successive Undo updates', () => {
  let batch = reconcilePreview(consumePreview(togglePreview(start(), 'a'), 'a'), id => id !== 'a');
  batch = reconcilePreview(consumePreview(batch, 'd'), id => !['a', 'd'].includes(id));
  expect(batch.slots[0].item?.id).toBe('e');
  batch = reconcilePreview(batch, id => id !== 'a');
  expect(batch.slots[0].item?.id).toBe('d');
  batch = reconcilePreview(batch, () => true);
  expect(batch.slots[0]).toMatchObject({ item: { id: 'a' }, included: false, ...points[0] });
});
it('does not undo a drop before the optimistic membership change has been observed', () => {
  let batch = reconcilePreview(consumePreview(start(), 'a'), () => true);
  expect(batch.slots[0].item?.id).toBe('d');
  batch = reconcilePreview(batch, id => id !== 'a');
  expect(batch.slots[0].item?.id).toBe('d');
  expect(reconcilePreview(batch, () => true).slots[0].item?.id).toBe('a');
});
it('keeps exhausted slots vacant, avoids duplicates and preserves choices on quantity changes', () => {
  let batch = start();
  batch = reconcilePreview(consumePreview(batch, 'a'), () => false);
  expect(previewMoves(batch)).toEqual([]); expect(batch.slots.map(({ x, y }) => ({ x, y }))).toEqual(points);
  batch = resizePreview(togglePreview(start(), 'b'), [...points, { x: 11, y: 204 }], () => true);
  expect(batch.slots.map(slot => slot.item?.id)).toEqual(['a', 'b', 'c', 'd']);
  expect(batch.slots[1].included).toBe(false);
});
it('permits another placement after a partial commit and ignores its stale completion', () => {
  const session = new PreviewSession(start(), true), first = session.accept()!;
  expect(session.close(emptyPreviewBatch())).toBe(false);
  expect(session.resume(first, start())).toBe(true);
  const next = session.accept()!;
  expect(session.resume(first, emptyPreviewBatch())).toBe(false);
  expect(session.resolve(next, start())).toBe(true);
});
