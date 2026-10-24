import * as React from 'react';
import type { PileOrder } from './imageAnalysis';

const orders: PileOrder[] = ['random', 'similarity', 'semantic', 'modified', 'bytes', 'resolution', 'aspect', 'name'];
const key = (projectId: string) => `folder-sort-browser-order:${projectId}`;

export function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const other = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[other]] = [copy[other], copy[i]];
  }
  return copy;
}

function readOrder(projectId: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(key(projectId)) || 'null');
    return {
      order: orders.includes(saved?.order) ? saved.order as PileOrder : 'random' as PileOrder,
      reversed: saved?.reversed === true,
      ids: Array.isArray(saved?.ids) ? [...new Set<string>(saved.ids.filter((id: unknown) => typeof id === 'string'))] : [],
    };
  } catch { return { order: 'random' as PileOrder, reversed: false, ids: [] as string[] }; }
}

/** Retain the random sequence as well as the chosen ordering between workspace mounts. */
export function useBrowserOrder(projectId: string, imageIds: string[]) {
  const [saved] = React.useState(() => readOrder(projectId));
  const [order, setOrder] = React.useState(saved.order);
  const [reversed, setReversed] = React.useState(saved.reversed);
  const [ids, setIds] = React.useState(() => reconcile(saved.ids, imageIds));
  const imageKey = React.useMemo(() => imageIds.join(','), [imageIds]);
  React.useEffect(() => { setIds(current => reconcile(current, imageIds)); }, [imageKey]);
  React.useEffect(() => {
    try { localStorage.setItem(key(projectId), JSON.stringify({ order, reversed, ids })); }
    catch { /* Sorting remains available when preference storage is full. */ }
  }, [projectId, order, reversed, ids]);
  return { order, setOrder, reversed, setReversed, ids, setIds };
}

function reconcile(current: string[], imageIds: string[]) {
  const available = new Set(imageIds), kept = current.filter(id => available.has(id)), known = new Set(kept);
  const added = imageIds.filter(id => !known.has(id));
  return kept.length === current.length && !added.length ? current : [...kept, ...shuffled(added)];
}
