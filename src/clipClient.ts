import type { ClipJob, ClipProgress, ClipResult, ContentAnalysis, ContentMatch } from './contentSimilarity';

export class ClipError extends Error {
  constructor(message: string, readonly stage: string) { super(message); }
}

/** The ML bundle is reachable only from this lazily constructed worker. No
 * inference fallback runs on the UI thread if workers/WASM are unavailable. */
export class ClipClient {
  private worker: Worker;
  private pending = new Map<number, { resolve: (value: ClipResult) => void; reject: (cause: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private nextId = 0;
  private disposed = false;
  constructor(onProgress: (progress: ClipProgress) => void) {
    if (typeof Worker === 'undefined') throw new Error('CLIP needs browser workers. Try a current Safari, Chrome, or Firefox.');
    this.worker = new Worker(new URL('./clip.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<{ requestId: number; result: ClipResult; error?: string; stage?: string; progress?: ClipProgress }>) => {
      if (event.data.progress) { onProgress(event.data.progress); return; }
      const request = this.pending.get(event.data.requestId);
      if (!request) return;
      clearTimeout(request.timer); this.pending.delete(event.data.requestId);
      if (event.data.error) request.reject(new ClipError(event.data.error, event.data.stage || 'model'));
      else request.resolve(event.data.result);
    };
    this.worker.onerror = () => this.stop(new Error('CLIP could not start. Check your connection and try again.'));
  }
  private stop(cause: Error) {
    this.disposed = true;
    this.worker.terminate();
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(cause); }
    this.pending.clear();
  }
  dispose() { this.stop(new DOMException('CLIP cancelled', 'AbortError')); }
  private request(job: ClipJob): Promise<ClipResult> {
    if (this.disposed) return Promise.reject(new DOMException('CLIP cancelled', 'AbortError'));
    const requestId = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stop(new Error('CLIP timed out. Check your connection and retry; cached results are kept.')), job.kind === 'init' ? 180_000 : 60_000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.worker.postMessage({ ...job, requestId });
    });
  }
  async initialize() { await this.request({ kind: 'init' }); }
  async cache(images: Array<{ id: string; clip: ContentAnalysis }>) { if (images.length) await this.request({ kind: 'cache', images }); }
  async analyze(id: string, blob: Blob): Promise<ContentAnalysis> {
    try { return await this.request({ kind: 'embed', id, blob }) as ContentAnalysis; }
    catch (cause) {
      if (!(cause instanceof ClipError) || cause.stage !== 'image' || this.disposed) throw cause;
      // Safari worker decoding can reject SVG. Rasterize just this small sample
      // with the browser decoder, then send bounded pixels back to the worker.
      const image = new Image();
      const url = URL.createObjectURL(blob);
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new ClipError('Image could not be decoded', 'image')), 15_000);
          image.onload = () => { clearTimeout(timer); resolve(); };
          image.onerror = () => { clearTimeout(timer); reject(new ClipError('Image could not be decoded', 'image')); };
          image.src = url;
        });
        const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new ClipError('Image canvas unavailable', 'image');
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return await this.request({ kind: 'pixels', id, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height }) as ContentAnalysis;
      } finally { image.src = ''; URL.revokeObjectURL(url); }
    }
  }
  async order(ids: string[]) { return await this.request({ kind: 'order', ids }) as string[]; }
  async similar(candidates: string[], references: string[], limit: number) { return await this.request({ kind: 'similar', candidates, references, limit }) as ContentMatch[]; }
}
