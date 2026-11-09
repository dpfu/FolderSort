import * as React from 'react';
import { useStableCallback } from './useStableCallback';

const sessionSeen = new Set<string>();
const sessionCounts = new Map<string, number>();
const countKey = (id: string, kind: string) => `folder-sort-preview-count:${id}:${kind}`;
const key = (id: string) => `folder-sort-starter:${id}`;
export const MAX_RANDOM_BATCH = 24;
export const clampBatch = (value: number, available: number) => Math.max(1, Math.min(MAX_RANDOM_BATCH, Math.max(1, available), Math.floor(Number.isFinite(value) ? value : 3)));

export function usePreviewCount(projectId: string, kind: 'random' | 'related', maximum: number) {
  const preference = countKey(projectId, kind);
  const [count, updateCount] = React.useState(() => {
    const remembered = sessionCounts.get(preference);
    if (remembered !== undefined) return remembered;
    try { const saved = localStorage.getItem(preference); return clampBatch(saved === null ? 3 : Number(saved), maximum); }
    catch { return 3; }
  });
  const setCount = useStableCallback((value: number) => {
    const next = clampBatch(value, maximum);
    sessionCounts.set(preference, next); updateCount(next);
    try { localStorage.setItem(preference, String(next)); } catch { /* Retain the session preference. */ }
  });
  return { count, setCount };
}

/** A project gets one welcome, never a second one after Undo or reopening. */
export function useRootIntake(projectId: string, occupied: boolean) {
  const [seen, setSeen] = React.useState(() => {
    try { return sessionSeen.has(projectId) || localStorage.getItem(key(projectId)) === 'done'; } catch { return sessionSeen.has(projectId); }
  });
  const { count, setCount } = usePreviewCount(projectId, 'random', MAX_RANDOM_BATCH);
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
