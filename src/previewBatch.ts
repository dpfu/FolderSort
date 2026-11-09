import type { BoardMove } from './useImageIntake';
import type { LibraryImage } from './libraryStore';
import type { BoardEdit } from './boardEdit';

export type PreviewPlace = (id: string, point: { x: number; y: number }, anchor: { x: number; y: number }) => BoardEdit;

export type PreviewItem = { id: string };
type Previous<T> = { item: T; included: boolean; seenAway: boolean };
export type PreviewSlot<T> = { x: number; y: number; item?: T; included: boolean; history: Previous<T>[] };
export type PreviewBatch<T> = { slots: PreviewSlot<T>[]; pool: T[] };
export const emptyPreviewBatch = <T>(): PreviewBatch<T> => ({ slots: [], pool: [] });

/** Refill only vacant slots. Undo restores the previous occupant and its choice. */
export function reconcilePreview<T extends PreviewItem>(batch: PreviewBatch<T>, allowed: (id: string) => boolean): PreviewBatch<T> {
  const slots = batch.slots.map(slot => {
    const history = slot.history.map(entry => !entry.seenAway && !allowed(entry.item.id) ? { ...entry, seenAway: true } : entry);
    const last = history.at(-1);
    if (last?.seenAway && allowed(last.item.id)) return { ...slot, item: last.item, included: last.included, history: history.slice(0, -1) };
    return { ...slot, history, item: slot.item && allowed(slot.item.id) ? slot.item : undefined };
  });
  const reserved = new Set(slots.flatMap(slot => [...(slot.item ? [slot.item.id] : []), ...slot.history.map(entry => entry.item.id)]));
  let next = 0;
  for (const slot of slots) {
    if (slot.item) continue;
    while (next < batch.pool.length && (reserved.has(batch.pool[next].id) || !allowed(batch.pool[next].id))) next++;
    if (next === batch.pool.length) continue;
    slot.item = batch.pool[next++]; slot.included = true; reserved.add(slot.item.id);
  }
  return { ...batch, slots };
}

export function resizePreview<T extends PreviewItem>(batch: PreviewBatch<T>, points: { x: number; y: number }[], allowed: (id: string) => boolean): PreviewBatch<T> {
  return reconcilePreview({ ...batch, slots: points.map((point, index) => batch.slots[index] || { ...point, included: true, history: [] }) }, allowed);
}
export function togglePreview<T extends PreviewItem>(batch: PreviewBatch<T>, id: string): PreviewBatch<T> {
  return { ...batch, slots: batch.slots.map(slot => slot.item?.id === id ? { ...slot, included: !slot.included } : slot) };
}
export function consumePreview<T extends PreviewItem>(batch: PreviewBatch<T>, id: string): PreviewBatch<T> {
  return { ...batch, slots: batch.slots.map(slot => slot.item?.id === id ? {
    ...slot, item: undefined, included: true, history: [...slot.history, { item: slot.item, included: slot.included, seenAway: false }],
  } : slot) };
}
export function previewMoves<T extends PreviewItem>(batch: PreviewBatch<T>, retainedOnly = false): BoardMove[] {
  return batch.slots.flatMap(slot => slot.item && (!retainedOnly || slot.included) ? [{ id: slot.item.id, x: slot.x, y: slot.y }] : []);
}

/** Explicit destinations share the same durable single-preview placement as a drag. */
export type PreviewPlacementActions = {
  onPlaceInto: (id: string, destination: string | null, point?: { x: number; y: number }) => BoardEdit;
  onViewPreview: (id: string) => void;
  onMovePreview: (id: string, place: (destination: string | null) => Promise<boolean>) => void;
};

/** A placed image can remain eligible for a different board. Track its original
 * location so Undo, rather than general candidate eligibility, restores its slot. */
export function previewLocation(image: LibraryImage): string {
  return JSON.stringify([image.categoryId, image.boardScope, image.rootOnBoard, image.boardX, image.boardY, image.placement]);
}
