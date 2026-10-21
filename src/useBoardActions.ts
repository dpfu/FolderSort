import * as React from 'react';
import { placeImagesOnBoard, restoreImageStates, returnImagesToTray, type ImageRestoreState, type LibraryImage } from './libraryStore';
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
  const save = async (id: string, historyId: number, persist: () => Promise<void>, done: string) => {
    onSaving(count => count + 1); onMessage('Saving board…');
    try { await persist(); onMessage(done); }
    catch (cause) { invalidateFrom(historyId); onError(cause instanceof Error ? cause.message : String(cause)); await onRefresh(id).catch(() => {}); }
    finally { onSaving(count => count - 1); }
  };
  const place = useStableCallback((moves: BoardMove[]) => {
    if (!projectId || !moves.length) return;
    const changes = new Map(moves.map(move => [move.id, move]));
    const affected = current.current.filter(image => {
      const move = changes.get(image.id);
      return move && (image.placement !== 'board' || image.boardX !== Math.round(move.x) || image.boardY !== Math.round(move.y) || move.boardScope !== undefined && image.boardScope !== move.boardScope);
    });
    if (!affected.length) return;
    const states: ImageRestoreState[] = affected.map(image => ({ id: image.id, board: { placement: image.placement, boardScope: image.boardScope, boardX: image.boardX, boardY: image.boardY } }));
    const added = affected.some(image => image.placement === 'tray');
    const historyId = remember({ projectId, kind: 'layout', label: added ? 'Undo add to board' : 'Undo image move',
      message: `${added ? 'Added' : 'Moved'} ${affected.length} ${affected.length === 1 ? 'image' : 'images'} ${added ? 'to' : 'on'} the board.`,
      detail: 'Stashes are kept. Undo restores the previous placement.', restored: 'Previous image placement restored.', restore: () => restoreImageStates(projectId, states) });
    apply(image => { const move = changes.get(image.id); return move ? { ...image, placement: 'board', boardX: Math.round(move.x), boardY: Math.round(move.y), ...(move.boardScope !== undefined ? { boardScope: move.boardScope } : {}) } : image; });
    void save(projectId, historyId, () => placeImagesOnBoard(projectId, moves), 'Board saved.');
  });
  const clear = useStableCallback((ids: string[]) => {
    if (!projectId || !ids.length) return;
    const selected = new Set(ids);
    const affected = current.current.filter(image => selected.has(image.id) && image.placement !== 'tray');
    if (!affected.length) return;
    const states: ImageRestoreState[] = affected.map(image => ({ id: image.id, board: { placement: image.placement, boardScope: image.boardScope, boardX: image.boardX, boardY: image.boardY } }));
    const historyId = remember({ projectId, kind: 'clear', label: 'Undo clear', message: `Removed ${states.length} ${states.length === 1 ? 'image' : 'images'} from the board.`,
      detail: 'Images and stashes are kept. Undo restores their board positions.', restored: 'Previous board positions restored.', restore: () => restoreImageStates(projectId, states) });
    const clearing = new Set(affected.map(image => image.id));
    apply(image => clearing.has(image.id) ? { ...image, placement: 'tray', boardX: undefined, boardY: undefined, boardScope: undefined } : image);
    void save(projectId, historyId, () => returnImagesToTray(projectId, [...clearing]), 'Images removed from board.');
  });
  return { place, clear };
}
