import * as React from 'react';
import { useStableCallback } from './useStableCallback';

const sessionSeen = new Set<string>();
const key = (id: string) => `folder-sort-starter:${id}`;
export const MAX_RANDOM_BATCH = 24;
export const clampBatch = (value: number, available: number) => Math.max(1, Math.min(MAX_RANDOM_BATCH, Math.max(1, available), Math.floor(Number.isFinite(value) ? value : 3)));

/** A project gets one welcome, never a second one after Undo or reopening. */
export function useRootIntake(projectId: string, occupied: boolean) {
  const [seen, setSeen] = React.useState(() => {
    try { return sessionSeen.has(projectId) || localStorage.getItem(key(projectId)) === 'done'; } catch { return sessionSeen.has(projectId); }
  });
  const [count, setCount] = React.useState(3);
  const dismiss = useStableCallback(() => {
    if (sessionSeen.has(projectId)) return;
    sessionSeen.add(projectId); setSeen(true);
    try { localStorage.setItem(key(projectId), 'done'); } catch { /* The session guard still works. */ }
  });
  React.useEffect(() => { if (occupied && !seen) dismiss(); }, [occupied, seen, dismiss]);
  return { seen, dismiss, count, setCount };
}

/** Partial Fisher–Yates: distinct candidates, never assigned images. */
export function randomBatch(ids: string[], count: number) {
  const copy = [...ids], size = Math.min(ids.length, clampBatch(count, ids.length));
  for (let i = 0; i < size; i++) { const other = i + Math.floor(Math.random() * (copy.length - i)); [copy[i], copy[other]] = [copy[other], copy[i]]; }
  return copy.slice(0, size);
}
