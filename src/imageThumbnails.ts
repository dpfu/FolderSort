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
  private queue: string[] = [];
  private loading = new Map<string, number>();
  private listeners = new Set<() => void>();
  private version = 0;
  private frame: number | null = null;
  private disposed = false;
  private generation = 0;
  private worker: Worker | null = null;
  private triedWorker = false;
  private requestId = 0;
  private pending = new Map<number, { resolve: (blob: Blob) => void; reject: (error: Error) => void; timer: number }>();

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.version;

  activate() { this.disposed = false; }

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

  private changed() {
    if (this.disposed || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.version++;
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
      this.changed();
    } catch {
      if (!this.disposed && generation === this.generation) { this.failed.add(id); this.changed(); }
    }
  }

  private stopWorker(error: Error) {
    this.worker?.terminate(); this.worker = null;
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(error); }
    this.pending.clear();
  }

  private async resize(blob: Blob, generation: number): Promise<Blob> {
    if (!this.triedWorker) {
      this.triedWorker = true;
      try {
        this.worker = new Worker(new URL('./imageThumbnail.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (event: MessageEvent<{ requestId: number; blob: Blob; error?: string }>) => {
          const job = this.pending.get(event.data.requestId);
          if (!job) return;
          clearTimeout(job.timer); this.pending.delete(event.data.requestId);
          if (event.data.error) job.reject(new Error(event.data.error));
          else job.resolve(event.data.blob);
        };
        this.worker.onerror = () => this.stopWorker(new Error('Thumbnail worker unavailable'));
      } catch { /* The yielding browser decoder also handles SVG. */ }
    }
    if (this.worker) {
      try {
        return await new Promise<Blob>((resolve, reject) => {
          const requestId = ++this.requestId;
          const timer = window.setTimeout(() => this.stopWorker(new Error('Thumbnail decode timed out')), 15_000);
          this.pending.set(requestId, { resolve, reject, timer });
          this.worker!.postMessage({ requestId, blob, edge: THUMBNAIL_EDGE });
        });
      } catch { if (this.disposed || generation !== this.generation) throw cancelled(); }
    }
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (this.disposed || generation !== this.generation) throw cancelled();
    const url = URL.createObjectURL(blob), image = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('Image decode timed out')), 15_000);
        image.onload = () => { clearTimeout(timer); resolve(); };
        image.onerror = () => { clearTimeout(timer); reject(new Error('Image cannot be decoded')); };
        image.src = url;
      });
      if (this.disposed || generation !== this.generation) throw cancelled();
      const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Thumbnail unavailable')), 'image/webp', .86));
    } finally { image.src = ''; URL.revokeObjectURL(url); }
  }

  dispose() {
    this.disposed = true; this.generation++; this.queue = []; this.wanted.clear(); this.loading.clear();
    this.triedWorker = false;
    this.stopWorker(cancelled());
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls.clear();
    this.listeners.clear();
  }
}

export function useThumbnailCache() {
  const cache = React.useMemo(() => new ImageThumbnailCache(), []);
  React.useEffect(() => { cache.activate(); return () => cache.dispose(); }, [cache]);
  return cache;
}

const noSubscribe = () => () => {};
const zero = () => 0;
export function useThumbnails(cache: ImageThumbnailCache, ids: string[], enabled = true) {
  React.useSyncExternalStore(enabled ? cache.subscribe : noSubscribe, enabled ? cache.snapshot : zero);
  const key = ids.join(',');
  React.useEffect(() => { if (enabled) cache.setVisible(ids); }, [cache, key, enabled]);
  return cache;
}
