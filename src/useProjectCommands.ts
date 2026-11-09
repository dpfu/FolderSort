import * as React from 'react';
import type { ActionHistory, RenameStash } from './useActionHistory';
import type { ForegroundOperations, ForegroundKind, ForegroundTask } from './foregroundOperations';
import type { ProjectLibrary } from './useProjectLibrary';
import {
  assignImageCategories,
  createStashWithImages,
  undoStashCreation,
  listCategories,
  removeEmptyStash,
  restoreEmptyStash,
  moveFolder as moveFolderTree,
  restoreFolderMove,
  restoreImageStates,
  renameCategory,
  projectClipEnabled,
  setProjectClipEnabled,
  type CategoryAssignment,
  type ImageRestoreState,
  type LibraryImage,
} from './libraryStore';
import { planStashAssignments } from './stashPlacement';
import { readBoardPreferences } from './categoryBoard';

type Options = {
  library: Pick<
    ProjectLibrary,
    'activeId' | 'projects' | 'images' | 'categories' | 'setImages' | 'setProjects'
  >;
  operations: ForegroundOperations;
  history: Pick<ActionHistory, 'current' | 'remember' | 'pop' | 'updateLatest'>;
  boardSaves: number;
  setSelected: React.Dispatch<React.SetStateAction<LibraryImage | undefined>>;
  refresh: (id?: string) => Promise<LibraryImage[] | undefined>;
  setError: (message: string) => void;
  setMessage: (message: string) => void;
};
export type RunForeground = (
  label: string,
  action: (task: ForegroundTask) => Promise<void>,
  kind?: ForegroundKind,
) => Promise<boolean>;
/** Durable project mutations and their inverses share one foreground owner. */
export function useProjectCommands({
  library,
  operations,
  history,
  boardSaves,
  setSelected,
  refresh,
  setError,
  setMessage,
}: Options) {
  const { activeId, images, categories, setImages, setProjects, projects } = library;
  const active = projects.find((project) => project.id === activeId);
  const undoAction = history.current,
    busy = operations.busy;
  const run: RunForeground = async (label, action, kind = 'command') => {
    const task = operations.begin(kind, label);
    setError('');
    setMessage('');
    try {
      await action(task);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      operations.finish(task);
    }
  };

  const undoRecent = async () => {
    if (!undoAction || operations.busy || boardSaves) return;
    await run(
      'Restoring your last change…',
      async () => {
        await undoAction.restore();
        await refresh(activeId);
        history.pop(undoAction.id);
        setMessage(undoAction.restored);
      },
      'undo',
    );
  };
  React.useEffect(() => {
    const undoKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !undoAction ||
        busy ||
        boardSaves ||
        event.shiftKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 'z'
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest('input, textarea, select, [contenteditable="true"]')
      )
        return;
      event.preventDefault();
      void undoRecent();
    };
    document.addEventListener('keydown', undoKey);
    return () => document.removeEventListener('keydown', undoKey);
  }, [undoAction, busy, boardSaves, activeId]);

  const rememberCategoryChange = (
    projectId: string,
    previous: LibraryImage[],
    assignments: CategoryAssignment[],
    saved: LibraryImage[],
  ) => {
    const byId = new Map(assignments.map((item) => [item.id, item.categoryId]));
    const updates = new Map(saved.map((image) => [image.id, image]));
    const changed = previous.filter((image) => {
      const next = updates.get(image.id);
      return (
        next &&
        (next.categoryId !== image.categoryId ||
          next.stashOrder !== image.stashOrder ||
          next.boardScope !== image.boardScope ||
          next.placement !== image.placement ||
          next.rootOnBoard !== image.rootOnBoard ||
          next.boardX !== image.boardX ||
          next.boardY !== image.boardY)
      );
    });
    if (!changed.length) return;
    const states: ImageRestoreState[] = changed.map((image) => ({
      id: image.id,
      categoryId: image.categoryId,
      stashOrder: image.stashOrder,
      board: {
        placement: image.placement,
        boardScope: image.boardScope,
        boardX: image.boardX,
        boardY: image.boardY,
        rootOnBoard: image.rootOnBoard,
      },
    }));
    const removing = changed.every((image) => byId.get(image.id) === null);
    history.remember({
      projectId,
      kind: 'category',
      message: removing
        ? `Moved ${changed.length === 1 ? 'this image' : `${changed.length.toLocaleString()} images`} to Staging.`
        : `Moved ${changed.length === 1 ? 'this image' : `${changed.length.toLocaleString()} images`} into a folder.`,
      detail: 'Undo restores their previous folders and positions.',
      label: 'Undo image move',
      restored: 'Previous folders and positions restored.',
      restore: () => restoreImageStates(projectId, states),
    });
  };

  const saveAssignments = async (assignments: CategoryAssignment[]) => {
    if (!activeId) throw new Error('Create a project first');
    const task = operations.begin('assignment');
    setError('');
    setMessage('');
    try {
      const changes = planStashAssignments(
        images,
        categories,
        assignments,
        window.innerWidth,
        readBoardPreferences(activeId).anchors,
      );
      const saved = await assignImageCategories(activeId, changes);
      const updates = new Map(saved.map((image) => [image.id, image]));
      const update = (image: LibraryImage) => updates.get(image.id) || image;
      setImages((current) => current.map(update));
      setSelected((current) => (current ? update(current) : current));
      setProjects((current) =>
        current.map((project) =>
          project.id === activeId ? { ...project, updatedAt: Date.now() } : project,
        ),
      );
      const destination =
        categories.find((stash) => stash.id === assignments[0].categoryId)?.name || 'Staging';
      setMessage(
        assignments.length === 1
          ? `Image moved ${assignments[0].categoryId ? 'into' : 'to'} ${destination}.`
          : `${assignments.length.toLocaleString()} images moved.`,
      );
      rememberCategoryChange(activeId, images, assignments, saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally {
      operations.finish(task);
    }
  };

  const createStash = async (ids: string[], parentId: string | null, name?: string) => {
    if (!activeId || operations.busy || boardSaves)
      throw new Error('Wait for the board to finish saving.');
    const task = operations.begin('create-folder');
    setError('');
    try {
      const result = await createStashWithImages(activeId, ids, parentId, name);
      await refresh(activeId);
      setMessage(`Folder created · ${ids.length} ${ids.length === 1 ? 'image' : 'images'}.`);
      history.remember({
        projectId: activeId,
        kind: 'stash',
        stashId: result.category.id,
        imageCount: ids.length,
        message: `Created ${result.category.name.split('/').at(-1)} with ${ids.length} ${ids.length === 1 ? 'image' : 'images'}.`,
        detail: 'Undo restores the previous folders and exact image positions.',
        label: 'Undo create folder',
        restored: 'Folder creation undone.',
        restore: () => undoStashCreation(activeId, result.category.id, result.states),
      });
      return result.category;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally {
      operations.finish(task);
    }
  };

  const renameStash: RenameStash = async (id, name, options) => {
    if (!activeId) return;
    const task = operations.begin('rename-folder');
    setError('');
    try {
      const previousFolder = (await listCategories(activeId)).find((stash) => stash.id === id);
      const previous = previousFolder?.name;
      await renameCategory(id, name);
      await refresh(activeId);
      if (
        options?.initialNaming &&
        history.current?.kind === 'stash' &&
        history.current.stashId === id
      ) {
        history.updateLatest((current) => ({
          ...current,
          message: `Created ${name.split('/').at(-1)} with ${current.imageCount || 0} ${(current.imageCount || 0) === 1 ? 'image' : 'images'}.`,
        }));
      } else if (previous && previous !== name) {
        history.remember({
          projectId: activeId,
          kind: 'rename',
          stashId: id,
          message: 'Folder renamed.',
          detail: 'Undo restores its previous name.',
          label: 'Undo rename',
          restored: 'Previous folder name restored.',
          restore: () =>
            renameCategory(id, previous, {
              unnamed: previousFolder?.unnamed,
              namingPrompted: previousFolder?.namingPrompted,
            }).then(() => {}),
        });
      }
      if (!options?.initialNaming) setMessage('Folder renamed.');
    } finally {
      // Rename forms own their errors, including storage failures. Keep focus and
      // feedback there instead of opening an unrelated global actions menu.
      operations.finish(task);
    }
  };

  const deleteEmptyStash = async (id: string) => {
    if (!activeId || operations.busy || boardSaves) return;
    const task = operations.begin('delete-folder');
    setError('');
    try {
      const snapshot = await removeEmptyStash(activeId, id);
      await refresh(activeId);
      const name = snapshot.category.name.split('/').at(-1)!;
      history.remember({
        projectId: activeId,
        kind: 'delete',
        stashId: id,
        message: `Deleted empty folder ${name}.`,
        detail: 'Images are kept. Undo restores the folder and its position.',
        label: 'Undo delete folder',
        restored: `Restored folder ${name}.`,
        restore: () => restoreEmptyStash(snapshot),
      });
      setMessage(`Deleted empty folder ${name}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally {
      operations.finish(task);
    }
  };

  const moveFolder = async (id: string, parentId: string | null) => {
    if (!activeId || operations.busy || boardSaves) throw new Error('Wait for the board to finish saving.');
    const task = operations.begin('move-folder', 'Moving folder…');
    setError('');
    try {
      const snapshot = await moveFolderTree(activeId, id, parentId);
      if (!snapshot) return;
      await refresh(activeId);
      history.remember({
        projectId: activeId, kind: 'folder-move', stashId: id,
        message: 'Folder moved.', detail: 'Its images and subfolders stay together. Undo restores its previous location.',
        label: 'Undo folder move', restored: 'Previous folder location restored.',
        restore: () => restoreFolderMove(snapshot),
      });
      setMessage('Folder moved.');
    } finally { operations.finish(task); }
  };

  const changeClipEnabled = async (enabled: boolean) => {
    if (!activeId || operations.busy) return;
    const id = activeId,
      previous = projectClipEnabled(active);
    const task = operations.begin('settings', 'Saving settings…');
    setError('');
    // Stop background work immediately; roll back the setting if persistence fails.
    setProjects((current) =>
      current.map((project) =>
        project.id === id
          ? { ...project, settings: { ...project.settings, clipEnabled: enabled } }
          : project,
      ),
    );
    try {
      const updated = await setProjectClipEnabled(id, enabled);
      setProjects((current) => current.map((project) => (project.id === id ? updated : project)));
    } catch (cause) {
      setProjects((current) =>
        current.map((project) =>
          project.id === id
            ? { ...project, settings: { ...project.settings, clipEnabled: previous } }
            : project,
        ),
      );
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      operations.finish(task);
    }
  };

  return {
    run,
    undoRecent,
    saveAssignments,
    createStash,
    renameStash,
    deleteEmptyStash,
    moveFolder,
    changeClipEnabled,
  };
}
