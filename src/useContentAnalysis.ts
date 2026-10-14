import * as React from 'react';
import { clearContentAnalysis, getImageBlob, imageIsOnBoard, listImages, saveImageMetadata, type LibraryImage } from './libraryStore';
import { CLIP_CACHE_KEY, hasCurrentContent, type ContentAnalysis } from './contentSimilarity';
import { ClipClient, ClipError } from './clipClient';

export type ContentIndexProgress = {
  phase: 'idle' | 'loading' | 'indexing' | 'paused' | 'ready' | 'error' | 'rebuilding';
  done: number; total: number; failed: number; percent?: number; error?: string;
};
const cancelled = () => new DOMException('CLIP cancelled', 'AbortError');
const yieldWork = () => new Promise<void>((resolve) => setTimeout(resolve, 8));

/** Project-scoped, resumable indexing. Live vector updates stay out of React state: progress renders
 * once a second, not once per inference. Cache writes merge into live records. */
export function useContentAnalysis(images: LibraryImage[], enabled = true) {
  const enabledRef = React.useRef(enabled); enabledRef.current = enabled;
  const requireEnabled = () => { if (!enabledRef.current) throw new Error("Content matching is off in project settings."); };
  const imagesRef = React.useRef(images);
  imagesRef.current = images;
  const cacheRef = React.useRef(new Map<string, ContentAnalysis>());
  const failedRef = React.useRef(new Set<string>());
  const priorityRef = React.useRef(new Set<string>());
  const waitersRef = React.useRef(new Map<string, { promise: Promise<void>; resolve: () => void; reject: (cause: Error) => void }>());
  const activeRef = React.useRef(true);
  const stopRef = React.useRef(false);
  const rebuildingRef = React.useRef(false);
  const interactingRef = React.useRef(false);
  const hydratedRef = React.useRef<Promise<void> | null>(null);
  const runningRef = React.useRef<Promise<void> | null>(null);
  const clientRef = React.useRef<ClipClient | null>(null);
  const syncRef = React.useRef<Promise<void> | null>(null);
  const phaseRef = React.useRef<ContentIndexProgress['phase']>('idle');
  const [revision, setRevision] = React.useState(0);
  const [orderRevision, setOrderRevision] = React.useState(0);
  const [progress, setProgress] = React.useState<ContentIndexProgress>({ phase: 'idle', done: 0, total: images.length, failed: 0 });

  const report = React.useCallback((patch: Partial<ContentIndexProgress>) => {
    if (!activeRef.current) return;
    if (patch.phase) phaseRef.current = patch.phase;
    setProgress((current) => ({ ...current, ...patch }));
  }, []);
  const counts = React.useCallback(() => ({
    done: imagesRef.current.filter((image) => cacheRef.current.has(image.id)).length,
    total: imagesRef.current.length, failed: imagesRef.current.filter(image => failedRef.current.has(image.id)).length,
  }), []);
  const hydrate = React.useCallback(async () => {
    if (!imagesRef.current.length) return;
    if (!hydratedRef.current) hydratedRef.current = (async () => {
      const projectId = imagesRef.current[0]?.projectId;
      if (!projectId) return;
      const stored = await listImages(projectId);
      if (!activeRef.current) throw cancelled();
      let lastYield = performance.now();
      for (const image of stored) {
        if (hasCurrentContent(image.clip)) cacheRef.current.set(image.id, image.clip);
        else if (image.clipSkipped === CLIP_CACHE_KEY) failedRef.current.add(image.id);
        // Validating a large restored cache is also work. Break it into short
        // slices so choosing CLIP remains responsive even before the worker runs.
        if (performance.now() - lastYield > 8) {
          await yieldWork();
          if (!activeRef.current) throw cancelled();
          lastYield = performance.now();
        }
      }
      report(counts()); setRevision((value) => value + 1);
    })();
    await hydratedRef.current;
  }, [counts, report]);
  const client = React.useCallback(async () => {
    requireEnabled();
    await hydrate();
    requireEnabled();
    if (!activeRef.current) throw cancelled();
    if (!clientRef.current) {
      clientRef.current = new ClipClient((event) => {
        if (!stopRef.current && event.phase === 'loading') report({ phase: 'loading', percent: event.percent });
        if (!stopRef.current && event.phase === 'ready' && phaseRef.current === 'loading') report({ phase: 'indexing', percent: undefined });
      });
      syncRef.current = clientRef.current.cache([...cacheRef.current].map(([id, clip]) => ({ id, clip })));
    }
    await syncRef.current;
    return clientRef.current!;
  }, [hydrate, report]);
  const rejectWaiters = React.useCallback((cause: Error) => {
    for (const waiter of waitersRef.current.values()) waiter.reject(cause);
    waitersRef.current.clear();
  }, []);
  const pause = React.useCallback(() => {
    if (!runningRef.current) return;
    stopRef.current = true;
    // A first download can take longer than an inference. Stop it immediately;
    // already completed files and image embeddings remain cached for Resume.
    if (phaseRef.current === 'loading') { clientRef.current?.dispose(); clientRef.current = null; syncRef.current = null; }
    report({ phase: 'paused' });
    rejectWaiters(new Error('CLIP is paused. Resume indexing to analyze this reference.'));
  }, [rejectWaiters, report]);
  const deactivate = React.useCallback(() => {
    pause();
    // Turning content matching off releases model and GPU/worker memory. The
    // persistent image cache remains available without another model download.
    clientRef.current?.dispose(); clientRef.current = null; syncRef.current = null;
  }, [pause]);

  React.useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false; stopRef.current = true;
      clientRef.current?.dispose(); clientRef.current = null;
      rejectWaiters(cancelled());
    };
  }, [rejectWaiters]);

  React.useEffect(() => { if (!enabled) deactivate(); }, [enabled, deactivate]);

  const start = React.useCallback(async (): Promise<void> => {
    requireEnabled();
    if (runningRef.current) {
      if (!stopRef.current) return runningRef.current;
      await runningRef.current.catch(() => {});
    }
    requireEnabled();
    if (!activeRef.current) throw cancelled();
    stopRef.current = false;
    const run = async () => {
      let patches: Array<{ id: string; clip?: ContentAnalysis; clipSkipped?: string }> = [];
      const projectId = imagesRef.current[0]?.projectId;
      if (!projectId) return;
      const flush = async () => {
        if (patches.length) { const pending = patches; patches = []; await saveImageMetadata(projectId, pending); }
      };
      try {
        await hydrate();
        if (stopRef.current || !activeRef.current) return;
        const source = imagesRef.current;
        let queued = source.filter((image) => !cacheRef.current.has(image.id) && !failedRef.current.has(image.id));
        if (!queued.length) { report({ phase: 'ready', ...counts(), error: undefined }); return; }
        report({ phase: 'loading', ...counts(), percent: undefined, error: undefined });
        const worker = await client();
        await worker.initialize();
        if (stopRef.current || !activeRef.current) return;
        report({ phase: 'indexing', percent: undefined });
        // Put board references first, then continue in source order. Newly
        // selected references can jump the queue without starting another model.
        queued.sort((a, b) => Number(imageIsOnBoard(b)) - Number(imageIsOnBoard(a)));
        let index = 0, lastReport = performance.now(), lastOrderReport = lastReport;
        while (true) {
          // Pick up imports that arrive while this run is already indexing.
          if (index >= queued.length) {
            queued = imagesRef.current.filter(image => !cacheRef.current.has(image.id) && !failedRef.current.has(image.id));
            index = 0;
            if (!queued.length && !priorityRef.current.size) break;
          }
          if (stopRef.current || !activeRef.current) break;
          if (interactingRef.current) { await yieldWork(); continue; }
          const priorityId = priorityRef.current.values().next().value as string | undefined;
          if (priorityId) priorityRef.current.delete(priorityId);
          const image = priorityId ? imagesRef.current.find(image => image.id === priorityId) : queued[index++];
          if (!image) {
            if (priorityId) { waitersRef.current.get(priorityId)?.resolve(); waitersRef.current.delete(priorityId); }
            continue;
          }
          if (cacheRef.current.has(image.id) || failedRef.current.has(image.id)) { waitersRef.current.get(image.id)?.resolve(); waitersRef.current.delete(image.id); continue; }
          try {
            const blob = await getImageBlob(image.id);
            if (!activeRef.current || stopRef.current) break;
            if (!blob) throw new ClipError('Missing original image', 'image');
            const sourceBlob = blob.type === image.mime ? blob : new Blob([blob], { type: image.mime });
            const clip = await worker.analyze(image.id, sourceBlob);
            cacheRef.current.set(image.id, clip);
            patches.push({ id: image.id, clip });
          } catch (cause) {
            if (!activeRef.current || stopRef.current) break;
            if (!(cause instanceof ClipError) || cause.stage !== 'image') throw cause;
            failedRef.current.add(image.id);
            patches.push({ id: image.id, clipSkipped: CLIP_CACHE_KEY });
          }
          waitersRef.current.get(image.id)?.resolve(); waitersRef.current.delete(image.id);
          if (patches.length >= 32 || performance.now() - lastReport > 1000) {
            await flush();
            if (performance.now() - lastReport > 1000) { report(counts()); setRevision(value => value + 1); lastReport = performance.now(); }
            // Ranking a large collection is more work than refreshing counts or
            // one preview. Limit whole-pile reordering while inference continues.
            if (performance.now() - lastOrderReport > 5000) { setOrderRevision(value => value + 1); lastOrderReport = performance.now(); }
          }
          await yieldWork();
        }
        await flush();
        if (!activeRef.current) return;
        report({ phase: stopRef.current ? 'paused' : 'ready', ...counts() });
        setRevision((value) => value + 1);
        setOrderRevision(value => value + 1);
      } catch (cause) {
        if (activeRef.current && !stopRef.current) {
          const error = new Error(cause instanceof Error ? cause.message : 'CLIP could not index these images.');
          clientRef.current?.dispose(); clientRef.current = null; syncRef.current = null;
          report({ phase: 'error', ...counts(), error: `CLIP unavailable: ${error.message}` });
          setRevision((value) => value + 1);
          rejectWaiters(error);
          throw error;
        }
      } finally {
        // Keep finished work even if the user closes the workspace mid-inference.
        await flush();
        if (activeRef.current && stopRef.current && !rebuildingRef.current) { report({ phase: 'paused', ...counts() }); setRevision((value) => value + 1); }
      }
    };
    const task = run(); runningRef.current = task;
    try { await task; }
    finally { if (runningRef.current === task) runningRef.current = null; }
  }, [client, counts, hydrate, rejectWaiters, report]);

  const ensureReferences = React.useCallback(async (ids: string[]) => {
    await hydrate();
    if (['paused', 'error'].includes(phaseRef.current) && ids.some(id => !cacheRef.current.has(id) && !failedRef.current.has(id))) {
      throw new Error(phaseRef.current === 'paused' ? 'Content indexing is paused. Resume it in project settings.' : 'Content indexing failed. Retry it in project settings.');
    }
    const waits = ids.filter((id) => !cacheRef.current.has(id) && !failedRef.current.has(id)).map((id) => {
      priorityRef.current.add(id);
      let waiter = waitersRef.current.get(id);
      if (!waiter) {
        let resolve!: () => void, reject!: (cause: Error) => void;
        const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
        waiter = { promise, resolve, reject }; waitersRef.current.set(id, waiter);
      }
      return waiter.promise;
    });
    if (waits.length) { void start().catch(() => {}); await Promise.all(waits); }
    return ids.filter((id) => cacheRef.current.has(id));
  }, [hydrate, start]);
  const order = React.useCallback(async (ids: string[]) => {
    await hydrate();
    if (!cacheRef.current.size) return [];
    return (await client()).order(ids);
  }, [client, hydrate]);
  const similar = React.useCallback(async (candidates: string[], references: string[], limit: number) =>
    (await client()).similar(candidates, references, limit), [client]);
  const setInteracting = React.useCallback((value: boolean) => { interactingRef.current = value; }, []);
  const retrySkipped = React.useCallback(async () => { failedRef.current.clear(); await start(); }, [start]);
  const rebuild = React.useCallback(async () => {
    requireEnabled();
    if (rebuildingRef.current) return;
    const projectId = imagesRef.current[0]?.projectId;
    if (!projectId) return;
    rebuildingRef.current = true;
    pause(); report({ phase: 'rebuilding', error: undefined });
    try {
      await runningRef.current?.catch(() => {});
      clientRef.current?.dispose(); clientRef.current = null; syncRef.current = null;
      await clearContentAnalysis(projectId);
      cacheRef.current.clear(); failedRef.current.clear(); priorityRef.current.clear(); hydratedRef.current = null;
      report({ phase: 'idle', ...counts() }); setRevision(value => value + 1);
    } catch (cause) {
      report({ phase: 'error', error: cause instanceof Error ? cause.message : 'Could not rebuild the content index.' });
      throw cause;
    } finally { rebuildingRef.current = false; }
    if (enabledRef.current && activeRef.current) await start();
  }, [pause, report, counts, start]);

  const ids = React.useMemo(() => images.map(image => image.id).join(','), [images]);
  React.useEffect(() => { void hydrate().then(() => report(counts())).catch(() => {}); }, [ids, hydrate, report, counts]);
  // An explicit enable resumes a paused/failed index. Ordinary image changes
  // keep a user's Pause in place; otherwise missing/new images index themselves.
  React.useEffect(() => { if (enabled && imagesRef.current.length) void start().catch(() => {}); }, [enabled, start]);
  React.useEffect(() => {
    if (enabled && imagesRef.current.length && !rebuildingRef.current && !['paused', 'error', 'rebuilding'].includes(phaseRef.current)) void start().catch(() => {});
  }, [enabled, ids, progress.phase, start]);
  React.useEffect(() => {
    const retryOnline = () => { if (enabledRef.current && phaseRef.current === 'error') void start().catch(() => {}); };
    window.addEventListener('online', retryOnline);
    return () => window.removeEventListener('online', retryOnline);
  }, [start]);
  return { progress, revision, orderRevision, start, pause, deactivate, retrySkipped, rebuild, ensureReferences, order, similar, setInteracting };
}

export type ContentIndex = ReturnType<typeof useContentAnalysis>;
