import { WorkerRequests } from './workerRequests';
import { decodeImage } from './decodeImage';
import * as React from 'react';
import { getImageBlob, getImageThumbnail, saveImageThumbnail } from './libraryStore';

const THUMBNAIL_EDGE = 512;
const CACHE_LIMIT = 240;
const CONCURRENCY = 2;
const cancelled = () => new DOMException('Thumbnail cancelled', 'AbortError');

/** Shared by the strip, overview and board. Pending work follows the viewport;
 * decoded previews and object URLs are bounded, while small blobs persist in IDB. */
export class ImageThumbnailCache {
  readonly urls = new Map<string, string>();
  readonly failed = new Set<string>();
  private wanted = new Set<string>();
  private interests = new Map<symbol, string[]>();
  private queue: string[] = [];
  private loading = new Map<string, number>();
  private listeners = new Set<() => void>();
  private imageListeners = new Map<string, Set<() => void>>();
  private changedImages = new Set<string>();
  private version = 0;
  private frame: number | null = null;
  private disposed = false;
  private generation = 0;
  private worker: Worker | null = null;
  private triedWorker = false;
  private pending = new WorkerRequests<Blob>();
  private decodeAbort = new AbortController();

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.version;
  subscribeImage = (id: string, listener: () => void) => {
    const listeners = this.imageListeners.get(id) || new Set<() => void>();
    listeners.add(listener); this.imageListeners.set(id, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.imageListeners.delete(id); };
  };

  activate() { if (this.decodeAbort.signal.aborted) this.decodeAbort = new AbortController(); this.disposed = false; this.updateInterests(); }

  /** Concurrent browser/board views retain their own visible thumbnail demand. */
  setInterest(owner: symbol, ids: string[]) {
    if (ids.length) this.interests.set(owner, ids); else this.interests.delete(owner);
    this.updateInterests();
  }
  private updateInterests() { this.setVisible([...new Set([...this.interests.values()].flat())]); }

  setVisible(ids: string[]) {
    if (this.disposed) return;
    this.wanted = new Set(ids);
    // Touch retained entries so eviction follows recent viewport use.
    for (const id of ids) {
      const url = this.urls.get(id);
      if (url) { this.urls.delete(id); this.urls.set(id, url); }
    }
    this.queue = ids.filter(id => !this.urls.has(id) && !this.loading.has(id) && !this.failed.has(id));
    this.evict();
    this.pump();
  }

  private changed(id: string) {
    this.changedImages.add(id);
    if (this.disposed || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.version++;
      const ids = [...this.changedImages]; this.changedImages.clear();
      const notified = new Set<() => void>();
      for (const id of ids) for (const listener of this.imageListeners.get(id) || []) notified.add(listener);
      notified.forEach(listener => listener());
      this.listeners.forEach(listener => listener());
    });
  }

  private evict() {
    const limit = Math.max(CACHE_LIMIT, this.wanted.size + 24);
    for (const [id, url] of this.urls) {
      if (this.urls.size <= limit) break;
      if (this.wanted.has(id)) continue;
      this.urls.delete(id);
      URL.revokeObjectURL(url);
      this.changed(id);
    }
  }

  private pump() {
    if (this.disposed) return;
    while (this.loading.size < CONCURRENCY && this.queue.length) {
      const id = this.queue.shift()!;
      const generation = this.generation;
      this.loading.set(id, generation);
      void this.load(id, generation).finally(() => {
        if (this.loading.get(id) !== generation) return;
        this.loading.delete(id);
        if (this.wanted.has(id) && !this.urls.has(id) && !this.failed.has(id)) this.queue.push(id);
        this.pump();
      });
    }
  }

  private async load(id: string, generation: number) {
    try {
      let blob = await getImageThumbnail(id);
      if (this.disposed || generation !== this.generation || !this.wanted.has(id)) return;
      if (!blob) {
        const original = await getImageBlob(id);
        if (this.disposed || generation !== this.generation || !this.wanted.has(id)) return;
        if (!original) throw new Error('Image unavailable');
        blob = await this.resize(original, generation);
        if (this.disposed || generation !== this.generation) return;
        // Cache storage is optional (for example if the browser quota is full).
        void saveImageThumbnail(id, blob).catch(() => {});
      }
      if (this.disposed || generation !== this.generation) return;
      this.urls.set(id, URL.createObjectURL(blob));
      this.evict();
      this.changed(id);
    } catch {
      if (!this.disposed && generation === this.generation) { this.failed.add(id); this.changed(id); }
    }
  }

  private stopWorker(error: Error) {
    this.worker?.terminate(); this.worker = null;
    this.pending.rejectAll(error);
  }

  private async resize(blob: Blob, generation: number): Promise<Blob> {
    if (!this.triedWorker) {
      this.triedWorker = true;
      try {
        this.worker = new Worker(new URL('./imageThumbnail.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (event: MessageEvent<{ requestId: number; blob: Blob; error?: string }>) => {
          this.pending.settle(event.data.requestId, event.data.blob, event.data.error ? new Error(event.data.error) : undefined);
        };
        this.worker.onerror = () => this.stopWorker(new Error('Thumbnail worker unavailable'));
      } catch { /* The yielding browser decoder also handles SVG. */ }
    }
    if (this.worker) {
      try {
        return await this.pending.request(requestId => this.worker!.postMessage({ requestId, blob, edge: THUMBNAIL_EDGE }), 15_000,
          () => this.stopWorker(new Error('Thumbnail decode timed out')));
      } catch { if (this.disposed || generation !== this.generation) throw cancelled(); }
    }
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (this.disposed || generation !== this.generation) throw cancelled();
    const decoded = await decodeImage(blob, this.decodeAbort.signal);
    const { image } = decoded;
    try {
      if (this.disposed || generation !== this.generation) throw cancelled();
      const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Thumbnail unavailable')), 'image/webp', .86));
    } finally { decoded.release(); }
  }

  dispose() {
    this.disposed = true; this.decodeAbort.abort(); this.generation++; this.queue = []; this.wanted.clear(); this.loading.clear(); this.interests.clear();
    this.triedWorker = false;
    this.stopWorker(cancelled());
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls.clear();
    this.listeners.clear(); this.imageListeners.clear(); this.changedImages.clear();
  }
}

export function useThumbnailCache() {
  const cache = React.useMemo(() => new ImageThumbnailCache(), []);
  React.useEffect(() => { cache.activate(); return () => cache.dispose(); }, [cache]);
  return cache;
}

const noSubscribe = () => () => {};
const zero = () => 0;
export function useThumbnails(cache: ImageThumbnailCache, ids: string[], enabled = true, listen = true) {
  React.useSyncExternalStore(enabled && listen ? cache.subscribe : noSubscribe, enabled && listen ? cache.snapshot : zero);
  const key = ids.join(',');
  const owner = React.useRef(Symbol('visible thumbnails'));
  React.useEffect(() => { cache.setInterest(owner.current, enabled ? ids : []); }, [cache, key, enabled]);
  React.useEffect(() => () => cache.setInterest(owner.current, []), [cache]);
  return cache;
}
