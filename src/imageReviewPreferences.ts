import * as React from 'react';

export type ImageReviewPreferences = { open: boolean; nextAfterMove: boolean; expanded: string[]; shortcuts: Record<string, string> };
export const reviewDestinationKey = (id: string | null) => id === null ? 'staging' : `folder:${id}`;
export const displayReviewKey = (key: string) => key.toUpperCase();
/** Printable keys only. Navigation, whitespace, modifiers and IME composition stay native. */
export function reviewKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const key = value.normalize('NFC').toLowerCase();
  return Array.from(key).length === 1 && !/[\s\p{C}]/u.test(key) ? key : undefined;
}
const storageKey = (projectId: string) => `folder-sort-image-review:${projectId}`;
const initial = (): ImageReviewPreferences => ({ open: true, nextAfterMove: false, expanded: [], shortcuts: {} });
export function readImageReviewPreferences(projectId: string): ImageReviewPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(projectId)) || 'null');
    if (!value || typeof value !== 'object') return initial();
    const shortcuts: Record<string, string> = {}, used = new Set<string>();
    for (const [destination, saved] of Object.entries(value.shortcuts || {})) {
      const key = reviewKey(saved);
      if (key && (destination === 'staging' || destination.startsWith('folder:')) && !used.has(key)) { shortcuts[destination] = key; used.add(key); }
    }
    return { open: value.open !== false, nextAfterMove: value.nextAfterMove === true,
      expanded: Array.isArray(value.expanded) ? [...new Set<string>(value.expanded.filter((id: unknown): id is string => typeof id === 'string'))] : [], shortcuts };
  } catch { return initial(); }
}

// Presentation state is deliberately outside project records and export formats.
// A shared store lets Undo restore a shortcut after the reviewer has been closed.
function createStore(projectId: string) {
  let value = readImageReviewPreferences(projectId);
  const listeners = new Set<() => void>();
  return {
    snapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update: (change: (previous: ImageReviewPreferences) => ImageReviewPreferences) => {
      value = change(value);
      try { localStorage.setItem(storageKey(projectId), JSON.stringify(value)); } catch { /* Sorting also works without preference storage. */ }
      listeners.forEach(listener => listener());
    },
  };
}
const stores = new Map<string, ReturnType<typeof createStore>>();
function storeFor(projectId: string) {
  let store = stores.get(projectId);
  if (!store) { store = createStore(projectId); stores.set(projectId, store); }
  return store;
}
export function updateImageReviewPreferences(projectId: string, change: (previous: ImageReviewPreferences) => ImageReviewPreferences) { storeFor(projectId).update(change); }
export function useImageReviewPreferences(projectId: string) {
  const store = storeFor(projectId);
  return [React.useSyncExternalStore(store.subscribe, store.snapshot), store.update] as const;
}
