import * as React from 'react';
import { useStableCallback } from './useStableCallback';

export const MAX_RANDOM_BATCH = 24;
export const clampBatch = (value: number, available: number) => Math.max(1, Math.min(MAX_RANDOM_BATCH, Math.max(1, available), Math.floor(Number.isFinite(value) ? value : 3)));

/** Dismiss an empty-board prompt until images/folders have occupied Staging again. */
export function useRootIntake(projectId: string, occupied: boolean) {
  const [episode, setEpisode] = React.useState(0);
  const [seen, setSeen] = React.useState(false);
  const [firstWelcome, setFirstWelcome] = React.useState(!occupied);
  const previous = React.useRef({ projectId, occupied });
  const [count, setCount] = React.useState(3);
  const dismiss = useStableCallback(() => { setSeen(true); setFirstWelcome(false); });
  React.useEffect(() => {
    if (previous.current.projectId !== projectId) {
      setSeen(false); setFirstWelcome(!occupied); setCount(3); setEpisode(value => value + 1);
    } else if (previous.current.occupied && !occupied) { setSeen(false); setEpisode(value => value + 1); }
    if (occupied) setFirstWelcome(false);
    previous.current = { projectId, occupied };
  }, [projectId, occupied]);
  return { seen, dismiss, firstWelcome, episode, count, setCount };
}

/** Partial Fisher–Yates: distinct candidates, never assigned images. */
export function randomBatch(ids: string[], count: number) {
  const copy = [...ids], size = Math.min(ids.length, clampBatch(count, ids.length));
  for (let i = 0; i < size; i++) { const other = i + Math.floor(Math.random() * (copy.length - i)); [copy[i], copy[other]] = [copy[other], copy[i]]; }
  return copy.slice(0, size);
}
