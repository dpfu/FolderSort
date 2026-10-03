import { ANALYSIS_VERSION, HASH_SAMPLE_SIZE, findSimilar, perceptualHash, similarityOrder,
  type AnalysisJob, type AnalysisResult, type HashedImage, type SimilarMatch, type VisualAnalysis } from './imageAnalysis';

const yieldWork = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));
const cancelled = () => new DOMException('Analysis cancelled', 'AbortError');

export class ImageAnalysisClient {
  private worker: Worker | null = null;
  private disposed = false;
  private requestId = 0;
  private pending = new Map<number, { resolve: (value: AnalysisResult) => void; reject: (reason: Error) => void; timer: number }>();

  constructor() {
    try {
      this.worker = new Worker(new URL('./imageAnalysis.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<{ requestId: number; result: AnalysisResult; error?: string }>) => {
        const pending = this.pending.get(event.data.requestId);
        if (!pending) return;
        window.clearTimeout(pending.timer);
        this.pending.delete(event.data.requestId);
        if (event.data.error) pending.reject(new Error(event.data.error));
        else pending.resolve(event.data.result);
      };
      this.worker.onerror = () => this.stopWorker(new Error('Image worker unavailable'));
    } catch { /* Older browsers use a yielding canvas fallback. */ }
  }

  private stopWorker(reason: Error) {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) { window.clearTimeout(pending.timer); pending.reject(reason); }
    this.pending.clear();
  }

  dispose() { this.disposed = true; this.stopWorker(cancelled()); }

  private request<T extends AnalysisResult>(job: AnalysisJob): Promise<T> {
    if (this.disposed) return Promise.reject(cancelled());
    if (!this.worker) return Promise.reject(new Error('Image worker unavailable'));
    const requestId = ++this.requestId;
    return new Promise<AnalysisResult>((resolve, reject) => {
      const timer = window.setTimeout(() => this.stopWorker(new Error('Image analysis timed out')), 30_000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.worker!.postMessage({ ...job, requestId });
    }) as Promise<T>;
  }

  async analyze(blob: Blob): Promise<VisualAnalysis> {
    if (this.worker) {
      try { return await this.request<VisualAnalysis>({ kind: 'analyze', blob }); }
      catch { if (this.disposed) throw cancelled(); }
    }
    // SVG and some browser-supported formats cannot be decoded inside workers.
    // Decode only one original at a time, then send the tiny sample to the worker.
    await yieldWork();
    if (this.disposed) throw cancelled();
    const url = URL.createObjectURL(blob);
    const image = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('Image decode timed out')), 15_000);
        image.onload = () => { window.clearTimeout(timer); resolve(); };
        image.onerror = () => { window.clearTimeout(timer); reject(new Error('Image cannot be decoded')); };
        image.src = url;
      });
      if (this.disposed) throw cancelled();
      const width = image.naturalWidth, height = image.naturalHeight;
      if (!width || !height) throw new Error('Image has no dimensions');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = HASH_SAMPLE_SIZE;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas unavailable');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, HASH_SAMPLE_SIZE, HASH_SAMPLE_SIZE);
      context.drawImage(image, 0, 0, HASH_SAMPLE_SIZE, HASH_SAMPLE_SIZE);
      const pixels = context.getImageData(0, 0, HASH_SAMPLE_SIZE, HASH_SAMPLE_SIZE).data;
      if (this.worker) return await this.request<VisualAnalysis>({ kind: 'pixels', pixels, width, height });
      return { version: ANALYSIS_VERSION, width, height, hash: perceptualHash(pixels) };
    } finally { image.src = ''; URL.revokeObjectURL(url); }
  }

  async order(images: HashedImage[]): Promise<string[]> {
    if (this.worker) {
      try { return await this.request<string[]>({ kind: 'order', images }); }
      catch { if (this.disposed) throw cancelled(); }
    }
    return similarityOrder(images, async () => { await yieldWork(); if (this.disposed) throw cancelled(); });
  }

  async similar(candidates: HashedImage[], references: HashedImage[], limit: number): Promise<SimilarMatch[]> {
    if (this.worker) {
      try { return await this.request<SimilarMatch[]>({ kind: 'similar', candidates, references, limit }); }
      catch { if (this.disposed) throw cancelled(); }
    }
    await yieldWork();
    if (this.disposed) throw cancelled();
    return findSimilar(candidates, references, limit);
  }
}
