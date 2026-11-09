import * as React from 'react';
import { useAsyncTask } from './useAsyncTask';
import { RequestOwner } from './requestOwner';
import type { PileOrder } from './imageAnalysis';
import type { LibraryImage } from './libraryStore';
import type { ImageAnalysis } from './useImageAnalysis';
import type { ContentIndex } from './useContentAnalysis';
export function usePreparedImageOrder(
  order: PileOrder,
  imageKey: string,
  images: React.MutableRefObject<LibraryImage[]>,
  analysis: Pick<ImageAnalysis, 'ensure' | 'client' | 'hashes'>,
  content: Pick<ContentIndex, 'order' | 'orderRevision'>,
  enabled: boolean,
  dragging: boolean,
  notice: (message: string) => void,
) {
  const { task, running } = useAsyncTask();
  const [semantic] = React.useState(() => new RequestOwner());
  const [similarityIds, setSimilarityIds] = React.useState<string[]>([]),
    [contentIds, setContentIds] = React.useState<string[]>([]);
  const { ensure, client, hashes } = analysis,
    { order: orderContent, orderRevision } = content;
  React.useEffect(() => {
    semantic.activate();
    return () => semantic.deactivate();
  }, [semantic]);
  React.useEffect(() => {
    if (!['similarity', 'modified', 'resolution', 'aspect'].includes(order)) {
      task.cancel();
      return;
    }
    const ticket = task.begin('replace')!;
    notice('');
    void (async () => {
      await ensure(order === 'modified' ? 'dates' : 'visual');
      if (!task.owns(ticket)) return;
      if (order === 'similarity') {
        const ids = await client().order(hashes(images.current));
        if (task.owns(ticket)) setSimilarityIds(ids);
      }
    })()
      .catch((cause) => {
        if (task.owns(ticket))
          notice(cause instanceof Error ? cause.message : 'Could not prepare image order.');
      })
      .finally(() => task.complete(ticket));
    return () => task.cancel();
  }, [order, imageKey, ensure, client, hashes, task]);
  React.useEffect(() => {
    if (!enabled || order !== 'semantic' || dragging) return;
    const ticket = semantic.begin();
    void orderContent(images.current.map((image) => image.id))
      .then((ids) => {
        if (semantic.owns(ticket)) setContentIds(ids);
      })
      .catch((cause) => {
        if (
          semantic.owns(ticket) &&
          !(cause instanceof DOMException && cause.name === 'AbortError')
        )
          notice(cause instanceof Error ? cause.message : 'Could not order by subject similarity.');
      });
    return () => semantic.invalidate();
  }, [enabled, order, imageKey, orderRevision, dragging, orderContent, semantic]);
  return { similarityIds, contentIds, preparingOrder: running };
}
