import * as React from 'react';

export type ProjectAction = {
  projectId: string;
  kind: 'category' | 'clear' | 'delete' | 'stash' | 'layout' | 'rename';
  stashId?: string;
  imageCount?: number;
  message: string;
  detail: string;
  label: string;
  restored: string;
  restore: () => Promise<void>;
};
export type HistoryEntry = ProjectAction & { id: number };
/** Only the creation form may group its first name with the creation action. */
export type RenameStash = (id: string, name: string, options?: { initialNaming?: boolean }) => Promise<void>;

/** One bounded history for project mutations; inverses restore only changed fields. */
export function useActionHistory(projectId?: string) {
  const [entries, setEntries] = React.useState<HistoryEntry[]>([]);
  const latest = React.useRef(entries);
  const project = React.useRef(projectId); project.current = projectId;
  const sequence = React.useRef(0);
  const replace = React.useCallback((next: HistoryEntry[]) => { latest.current = next; setEntries(next); }, []);
  React.useEffect(() => replace([]), [projectId, replace]);
  const remember = React.useCallback((action: ProjectAction) => {
    if (action.projectId !== project.current) return 0;
    const entry = { ...action, id: ++sequence.current };
    replace([...latest.current, entry].slice(-50));
    return entry.id;
  }, [replace]);
  const pop = React.useCallback((id: number) => {
    if (latest.current.at(-1)?.id === id) replace(latest.current.slice(0, -1));
  }, [replace]);
  const updateLatest = React.useCallback((update: (entry: HistoryEntry) => HistoryEntry) => {
    const entry = latest.current.at(-1);
    if (entry) replace([...latest.current.slice(0, -1), update(entry)]);
  }, [replace]);
  // A failed optimistic write invalidates inverses based on that unsaved state.
  const invalidateFrom = React.useCallback((id: number) => { if (id) replace(latest.current.filter(entry => entry.id < id)); }, [replace]);
  const last = entries.at(-1);
  return { current: last && last.projectId === projectId ? last : null, remember, pop, updateLatest, invalidateFrom };
}
