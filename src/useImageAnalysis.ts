import * as React from 'react';
import { getImageBlob, listImages, saveImageMetadata, type LibraryImage } from './libraryStore';
import { hasCurrentAnalysis, isColorHistogram, type ColoredImage, type HashedImage, type ImageMetadata } from './imageAnalysis';
import { ImageAnalysisClient } from './imageAnalysisClient';

type Progress = { running: boolean; done: number; total: number; failed: number };
type Need = 'dates' | 'visual' | 'color';
const aborted = () => new DOMException('Analysis cancelled', 'AbortError');

/** Start only on request. One decode at a time limits memory for large originals;
 * metadata is saved in batches, not by rewriting the whole project per image. */
export function useImageAnalysis(images: LibraryImage[]) {
  const imagesRef = React.useRef(images);
  imagesRef.current = images;
  const metadataRef = React.useRef(new Map<string, ImageMetadata>());
  const failedRef = React.useRef(new Set<string>());
  const clientRef = React.useRef<ImageAnalysisClient | null>(null);
  const activeRef = React.useRef(true);
  const hydratedRef = React.useRef(false);
  const runningRef = React.useRef<Promise<void> | null>(null);
  const [metadata, setMetadata] = React.useState(() => new Map<string, ImageMetadata>(images.map((image) => [image.id, image])));
  const [progress, setProgress] = React.useState<Progress>({ running: false, done: 0, total: 0, failed: 0 });

  React.useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; clientRef.current?.dispose(); clientRef.current = null; };
  }, []);

  const client = React.useCallback(() => {
    if (!activeRef.current) throw aborted();
    return clientRef.current ||= new ImageAnalysisClient();
  }, []);

  const ensure = React.useCallback(async (need: Need = 'visual'): Promise<Map<string, ImageMetadata>> => {
    // A visual request following a date-only request waits, then fills the gaps.
    while (runningRef.current) await runningRef.current;
    if (!activeRef.current) throw aborted();
    const projectId = imagesRef.current[0]?.projectId;
    if (!projectId) return metadataRef.current;
    const run = async () => {
      if (!hydratedRef.current) {
        // Parent React state can predate an earlier visit's analysis cache.
        const stored = await listImages(projectId);
        if (!activeRef.current) throw aborted();
        metadataRef.current = new Map(stored.map((image) => [image.id, image]));
        hydratedRef.current = true;
      }
      const source = imagesRef.current;
      const missing = source.filter((image) => {
        const meta = metadataRef.current.get(image.id);
        return meta?.fileModifiedAt === undefined || (need !== 'dates' && (!hasCurrentAnalysis(meta?.visual) || (need === 'color' && !isColorHistogram(meta?.visual?.color))) && !failedRef.current.has(image.id));
      });
      const initialDone = source.length - missing.length;
      if (missing.length) setProgress({ running: true, done: initialDone, total: source.length, failed: failedRef.current.size });
      let patches: Array<ImageMetadata & { id: string }> = [];
      let lastUpdate = performance.now();
      const flush = async (done: number) => {
        if (patches.length) { await saveImageMetadata(projectId, patches); patches = []; }
        if (!activeRef.current) throw aborted();
        setProgress({ running: true, done, total: source.length, failed: failedRef.current.size });
        lastUpdate = performance.now();
      };
      for (let index = 0; index < missing.length; index++) {
        if (!activeRef.current) throw aborted();
        const image = missing[index];
        const meta: ImageMetadata = { ...metadataRef.current.get(image.id) };
        const patch: ImageMetadata & { id: string } = { id: image.id };
        const blob = await getImageBlob(image.id);
        if (!activeRef.current) throw aborted();
        if (meta.fileModifiedAt === undefined) {
          // Legacy assets retain their File date; restored Blobs may have none.
          meta.fileModifiedAt = blob instanceof File && Number.isFinite(blob.lastModified) ? blob.lastModified : null;
          patch.fileModifiedAt = meta.fileModifiedAt;
        }
        if (need !== 'dates' && (!hasCurrentAnalysis(meta.visual) || (need === 'color' && !isColorHistogram(meta.visual?.color))) && !failedRef.current.has(image.id)) {
          try {
            if (!blob) throw new Error('Missing original');
            const sourceBlob = blob.type === image.mime ? blob : new Blob([blob], { type: image.mime });
            meta.visual = await client().analyze(sourceBlob);
            patch.visual = meta.visual;
          } catch (cause) {
            if (!activeRef.current) throw aborted();
            failedRef.current.add(image.id);
          }
        }
        metadataRef.current.set(image.id, meta);
        patches.push(patch);
        if (patches.length >= 32 || performance.now() - lastUpdate > 250) await flush(initialDone + index + 1);
      }
      if (patches.length) await flush(source.length);
      if (!activeRef.current) throw aborted();
      setMetadata(new Map(metadataRef.current));
      setProgress({ running: false, done: source.length, total: source.length, failed: failedRef.current.size });
    };
    const task = run();
    runningRef.current = task;
    try { await task; return metadataRef.current; }
    finally { if (runningRef.current === task) runningRef.current = null;
      if (activeRef.current) setProgress((current) => ({ ...current, running: false })); }
  }, [client]);

  const hashes = React.useCallback((source: LibraryImage[]): HashedImage[] => source.flatMap((image) => {
    const visual = metadataRef.current.get(image.id)?.visual;
    return hasCurrentAnalysis(visual) ? [{ id: image.id, hash: visual.hash }] : [];
  }), []);

  const colors = React.useCallback((source: LibraryImage[]): ColoredImage[] => source.flatMap(image => {
    const color = metadataRef.current.get(image.id)?.visual?.color;
    return isColorHistogram(color) ? [{ id: image.id, color }] : [];
  }), []);

  return { metadata, progress, ensure, client, hashes, colors };
}
