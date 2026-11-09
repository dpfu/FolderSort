import * as React from 'react';
import { placeImagesOnBoard, removeImagesFromBoard, restoreImageStates, type ImageRestoreState, type LibraryImage } from './libraryStore';
import type { BoardEdit, BoardSaveOutcome } from './boardEdit';
import type { BoardMove } from './useImageIntake';
import type { ProjectAction } from './useActionHistory';
import { useStableCallback } from './useStableCallback';

/** Save optimistic layout changes through the same history as stash mutations. */
export function useBoardActions({ projectId, images, setImages, onRefresh, onError, onMessage, onSaving, remember, invalidateFrom }: {
  projectId?: string; images: LibraryImage[]; setImages: React.Dispatch<React.SetStateAction<LibraryImage[]>>;
  onRefresh: (id: string) => Promise<unknown>; onError: (error: string) => void; onMessage: (message: string) => void;
  onSaving: React.Dispatch<React.SetStateAction<number>>;
  remember: (action: ProjectAction) => number; invalidateFrom: (id: number) => void;
}) {
  const current = React.useRef(images); current.current = images;
  const apply = (update: (image: LibraryImage) => LibraryImage) => {
    current.current = current.current.map(update); setImages(previous => previous.map(update));
  };
  const save = async (id: string, historyId: number, persist: () => Promise<LibraryImage[]>, done: string, optimisticOrders: Map<string, number | undefined>): Promise<BoardSaveOutcome> => {
    onSaving(count => count + 1); onMessage('Saving board…');
    try {
      const saved = await persist(), byId = new Map(saved.map(image => [image.id, image]));
      apply(image => { const next = byId.get(image.id);
        return next && image.categoryId === next.categoryId && image.stashOrder === optimisticOrders.get(image.id) ? { ...image, stashOrder: next.stashOrder } : image;
      });
      onMessage(done);
      return { status: 'saved' };
    }
    catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      invalidateFrom(historyId); onError(error); await onRefresh(id).catch(() => {});
      return { status: 'failed', error };
    }
    finally { onSaving(count => count - 1); }
  };
  const place = useStableCallback((moves: BoardMove[]): BoardEdit => {
    if (!projectId || !moves.length) return { status: 'unchanged' };
    const changes = new Map(moves.map(move => [move.id, move]));
    const affected = current.current.filter(image => {
      const move = changes.get(image.id);
      return move && (image.rootOnBoard === false || image.placement !== 'board' || image.boardX !== Math.round(move.x) || image.boardY !== Math.round(move.y) || move.boardScope !== undefined && image.categoryId !== move.boardScope);
    });
    if (!affected.length) return { status: 'unchanged' };
    const states: ImageRestoreState[] = affected.map(image => ({ id: image.id, categoryId: image.categoryId, stashOrder: image.stashOrder, board: { placement: image.placement, boardScope: image.boardScope, boardX: image.boardX, boardY: image.boardY, rootOnBoard: image.rootOnBoard } }));
    const added = affected.some(image => !image.categoryId && image.rootOnBoard === false);
    const movedFolder = affected.some(image => { const move = changes.get(image.id)!; return move.boardScope !== undefined && move.boardScope !== image.categoryId; });
    const movedToStaging = movedFolder && affected.every(image => changes.get(image.id)?.boardScope === null);
    const historyId = remember({ projectId, kind: movedFolder ? 'category' : 'layout', label: movedFolder ? 'Undo image move' : added ? 'Undo add images' : 'Undo image move',
      message: movedFolder ? `Moved ${affected.length} ${affected.length === 1 ? 'image' : 'images'} ${movedToStaging ? 'to Staging' : 'into this folder'}.` : `${added ? 'Added' : 'Arranged'} ${affected.length} ${affected.length === 1 ? 'image' : 'images'}.`,
      detail: 'Undo restores their previous folders and positions.', restored: 'Previous folders and positions restored.', restore: () => restoreImageStates(projectId, states) });
    let sequence = current.current.reduce((max, image) => Math.max(max, image.stashOrder || 0), 0);
    const optimisticOrders = new Map<string, number | undefined>();
    const optimistic = new Map(current.current.map(image => {
      const move = changes.get(image.id); if (!move) return [image.id, image] as const;
      const categoryId = move.boardScope === undefined ? image.categoryId : move.boardScope;
      const stashOrder = categoryId ? categoryId === image.categoryId ? image.stashOrder : ++sequence : undefined;
      optimisticOrders.set(image.id, stashOrder);
      return [image.id, { ...image, categoryId, stashOrder, rootOnBoard: categoryId ? undefined : true, placement: 'board' as const, boardX: Math.round(move.x), boardY: Math.round(move.y), boardScope: categoryId }] as const;
    }));
    apply(image => optimistic.get(image.id) || image);
    return { status: 'accepted', completion: save(projectId, historyId, () => placeImagesOnBoard(projectId, moves), movedFolder ? movedToStaging ? 'Images moved to Staging.' : 'Images moved into this folder.' : 'Board saved.', optimisticOrders) };
  });
  const removeFromBoard = useStableCallback((ids: string[], sourceId: string | null, sourceName = 'Staging'): BoardEdit => {
    if (!projectId || !ids.length) return { status: 'unchanged' };
    const selected = new Set(ids);
    const affected = current.current.filter(image => selected.has(image.id) && image.categoryId === sourceId && (sourceId !== null || image.rootOnBoard !== false));
    if (!affected.length) return { status: 'unchanged' };
    const states: ImageRestoreState[] = affected.map(image => ({ id: image.id, categoryId: image.categoryId, stashOrder: image.stashOrder,
      board: { placement: image.placement, boardScope: image.boardScope, boardX: image.boardX, boardY: image.boardY, rootOnBoard: image.rootOnBoard } }));
    const count = affected.length.toLocaleString(), noun = affected.length === 1 ? 'image' : 'images';
    const message = `${count} ${noun} returned to the waiting queue.`;
    const historyId = remember({ projectId, kind: sourceId ? 'category' : 'layout', label: sourceId ? 'Undo remove from folder' : 'Undo remove from staging', message,
      detail: `Images stay in the project. Undo restores them to ${sourceName} and their previous positions.`, restored: `Images restored to ${sourceName}.`,
      restore: () => restoreImageStates(projectId, states) });
    const removed = new Set(affected.map(image => image.id));
    apply(image => removed.has(image.id) ? { ...image, categoryId: null, boardScope: null, stashOrder: undefined, rootOnBoard: false } : image);
    return { status: 'accepted', completion: save(projectId, historyId, () => removeImagesFromBoard(projectId, [...removed], sourceId), message,
      new Map(affected.map(image => [image.id, undefined]))) };
  });
  return { place, removeFromBoard };
}
