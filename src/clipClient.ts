import { WorkerRequests } from './workerRequests';
import { decodeImage } from './decodeImage';
import type { ClipJob, ClipProgress, ClipResult, ContentAnalysis, ContentMatch, LabelMatch } from './contentSimilarity';
import { retainClipModels, releaseClipModels } from './clipRecovery';

export class ClipError extends Error {
  constructor(message: string, readonly stage: string) { super(message); }
}

/** The ML bundle is reachable only from this lazily constructed worker. No
 * inference fallback runs on the UI thread if workers/WASM are unavailable. */
export class ClipClient {
  private worker: Worker;
  private pending = new WorkerRequests<ClipResult>();
  private decodeAbort = new AbortController();
  private disposed = false;
  private initialization: Promise<void> | null = null;
  ready = false;
  constructor(onProgress: (progress: ClipProgress) => void) {
    if (typeof Worker === 'undefined') throw new Error('CLIP needs browser workers. Try a current Safari, Chrome, or Firefox.');
    this.worker = new Worker(new URL('./clip.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<{ requestId: number; result: ClipResult; error?: string; stage?: string; progress?: ClipProgress }>) => {
      if (this.disposed) return;
      if (event.data.progress) { onProgress(event.data.progress); return; }
      this.pending.settle(event.data.requestId, event.data.result, event.data.error ? new ClipError(event.data.error, event.data.stage || 'model') : undefined);
    };
    this.worker.onerror = () => this.stop(new Error('CLIP could not start. Check your connection and try again.'));
  }
  private stop(cause: Error) {
    if (this.disposed) return;
    this.disposed = true; this.decodeAbort.abort();
    this.worker.terminate();
    releaseClipModels(this);
    this.pending.rejectAll(cause);
  }
  dispose() { this.stop(new DOMException('CLIP cancelled', 'AbortError')); }
  private request(job: ClipJob): Promise<ClipResult> {
    if (this.disposed) return Promise.reject(new DOMException('CLIP cancelled', 'AbortError'));
    // Cache/ranking operations need no models and remain usable after recovery.
    if (['init', 'embed', 'pixels', 'search', 'labels'].includes(job.kind)) {
      try { retainClipModels(this); } catch (cause) { return Promise.reject(cause); }
    }
    return this.pending.request(requestId => this.worker.postMessage({ ...job, requestId }),
      ['init', 'search', 'labels'].includes(job.kind) ? 180_000 : 60_000,
      () => this.stop(new Error('CLIP timed out. Check your connection and retry; cached results are kept.')));
  }
  async initialize() {
    if (!this.initialization) this.initialization = this.request({ kind: 'init' }).then(() => { this.ready = true; }).catch(cause => { this.initialization = null; throw cause; });
    await this.initialization;
  }
  async cache(images: Array<{ id: string; clip: ContentAnalysis }>) { if (images.length) await this.request({ kind: 'cache', images }); }
  async analyze(id: string, blob: Blob): Promise<ContentAnalysis> {
    try { return await this.request({ kind: 'embed', id, blob }) as ContentAnalysis; }
    catch (cause) {
      if (!(cause instanceof ClipError) || cause.stage !== 'image' || this.disposed) throw cause;
      // Safari worker decoding can reject SVG. Rasterize just this small sample
      // with the browser decoder, then send bounded pixels back to the worker.
      const decoded = await decodeImage(blob, this.decodeAbort.signal, () => new ClipError('Image could not be decoded', 'image'));
      const { image } = decoded;
      try {
        const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new ClipError('Image canvas unavailable', 'image');
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return await this.request({ kind: 'pixels', id, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height }) as ContentAnalysis;
      } finally { decoded.release(); }
    }
  }
  async order(ids: string[]) { return await this.request({ kind: 'order', ids }) as string[]; }
  async similar(candidates: string[], references: string[], limit: number) { return await this.request({ kind: 'similar', candidates, references, limit }) as ContentMatch[]; }
  async search(candidates: string[], query: string, limit: number) { return await this.request({ kind: 'search', candidates, query: query.trim().slice(0, 300), limit }) as ContentMatch[]; }
  async labels(references: string[], labels: string[], limit: number) { return await this.request({ kind: 'labels', references, labels, limit }) as LabelMatch[]; }
}
