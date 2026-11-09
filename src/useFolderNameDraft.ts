import * as React from 'react';
import { usePreviewSession } from './usePreviewSession';
import { useAsyncTask } from './useAsyncTask';
import { useContentIndex } from './ContentIndex';
import { FOLDER_LABELS } from './folderLabels';
import { imageInCategoryBranch } from './categoryTree';
import { markFolderNamingPrompted, type LibraryCategory, type LibraryImage } from './libraryStore';
import type { RenameStash } from './useActionHistory';

type Draft = { name: string; names: string[]; selected: number; edited: boolean };
export function useFolderNameDraft(
  folder: LibraryCategory,
  images: LibraryImage[],
  categories: LibraryCategory[],
  enabled: boolean,
  busy: boolean,
  rename: RenameStash,
) {
  const { suggestNames } = useContentIndex();
  const { session, state } = usePreviewSession<Draft>(
    { name: '', names: [], selected: 0, edited: false },
    !folder.namingPrompted,
  );
  const { task: journal, state: journalState } = useAsyncTask();
  const [attempt, setAttempt] = React.useState(0),
    prompted = React.useRef(false);
  const categoryById = new Map(categories.map((category) => [category.id, category.name]));
  const referenceKey = images
    .filter((image) => imageInCategoryBranch(image, folder.id, categoryById))
    .map((image) => image.id)
    .join(',');
  const parent = folder.name.split('/').slice(0, -1).join('/');
  const unavailable = new Set(
    categories
      .filter(
        (category) =>
          category.id !== folder.id && category.name.split('/').slice(0, -1).join('/') === parent,
      )
      .map((category) => category.name.split('/').at(-1)!.toLocaleLowerCase()),
  );
  const candidateKey = FOLDER_LABELS.filter(
    (label) => !unavailable.has(label.toLocaleLowerCase()),
  ).join('|');
  const open = state.phase !== 'closed',
    saving = state.phase === 'accepting',
    loading = state.phase === 'loading';
  React.useEffect(() => {
    if (!open || prompted.current) return;
    const ticket = journal.begin();
    if (!ticket) return;
    prompted.current = true;
    void markFolderNamingPrompted(folder.id)
      .then(() => journal.complete(ticket))
      .catch(() => {
        prompted.current = false;
        journal.fail(ticket, 'Could not save this prompt’s state. It may appear again next time.');
      });
  }, [open, folder.id, journal]);
  React.useEffect(() => {
    if (!open || !enabled || !referenceKey || !candidateKey) {
      session.update((draft) => ({ ...draft, names: [] }));
      return;
    }
    session.update((draft) => ({ ...draft, names: [] }));
    const ticket = session.load();
    if (!ticket) return;
    void suggestNames(referenceKey.split(','), candidateKey.split('|'), 3)
      .then((result) => {
        const names = result.map((match) => match.label),
          draft = session.current.data;
        session.resolve(ticket, {
          ...draft,
          names,
          selected: draft.edited ? -1 : 0,
          name: draft.edited ? draft.name : names[0] || '',
        });
      })
      .catch((cause) =>
        session.reject(
          ticket,
          cause instanceof Error
            ? cause.message
            : 'Could not suggest names. You can still type your own.',
        ),
      );
    return () => session.cancel(ticket);
  }, [open, enabled, referenceKey, candidateKey, suggestNames, attempt, session]);
  const save = async () => {
    const name = session.current.data.name.trim();
    if (busy || !name) return false;
    const ticket = session.accept({ supersedeLoading: true });
    if (!ticket) return false;
    try {
      await rename(folder.id, parent ? `${parent}/${name}` : name);
      if (session.resolve(ticket, session.current.data)) session.close(session.current.data);
      return true;
    } catch (cause) {
      session.reject(ticket, cause instanceof Error ? cause.message : 'Could not save this name.');
      return false;
    }
  };
  return {
    ...state.data,
    open,
    saving,
    loading,
    error: state.notice || journalState.error,
    referenceKey,
    save,
    close: () => session.close(session.current.data),
    toggle: () =>
      session.open ? session.close(session.current.data) : session.show(session.current.data),
    edit: (name: string) =>
      session.update((draft) => ({ ...draft, name, selected: -1, edited: true }), true),
    choose: (index: number) =>
      session.update(
        (draft) => ({ ...draft, selected: index, name: draft.names[index], edited: true }),
        true,
      ),
    retry: () => setAttempt((value) => value + 1),
  };
}
