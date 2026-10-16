import * as React from 'react';
import type { ImageThumbnailCache } from './imageThumbnails';

/** Subscribe photo-sized UI to its own URLs. Loading a thumbnail must not
 * rebuild the project, layout or the rest of a large collection. */
export function useThumbnailUrls(cache: ImageThumbnailCache | undefined, ids: string[]) {
  const key = ids.join(',');
  const subscribe = React.useCallback((listener: () => void) => {
    const remove = ids.map(id => cache?.subscribeImage(id, listener));
    return () => remove.forEach(unsubscribe => unsubscribe?.());
  }, [cache, key]);
  const snapshot = React.useCallback(() => ids.map(id => cache?.urls.get(id) || (cache?.failed.has(id) ? 'failed' : '')).join('\n'), [cache, key]);
  React.useSyncExternalStore(subscribe, snapshot);
}
