import { WorkerRequests } from './workerRequests';
import { decodeImage } from './decodeImage';
import { ANALYSIS_VERSION, HASH_SAMPLE_SIZE, colorHistogram, findSimilarColors, findSimilar, perceptualHash, similarityOrder,
  type AnalysisJob, type AnalysisResult, type ColoredImage, type HashedImage, type SimilarMatch, type VisualAnalysis } from './imageAnalysis';

const yieldWork = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));
const cancelled = () => new DOMException('Analysis cancelled', 'AbortError');

export class ImageAnalysisClient {
  private worker: Worker | null = null;
  private disposed = false;
  private pending = new WorkerRequests<AnalysisResult>();
  private decodeAbort = new AbortController();

  constructor() {
    try {
      this.worker = new Worker(new URL('./imageAnalysis.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<{ requestId: number; result: AnalysisResult; error?: string }>) => {
        this.pending.settle(event.data.requestId, event.data.result, event.data.error ? new Error(event.data.error) : undefined);
      };
      this.worker.onerror = () => this.stopWorker(new Error('Image worker unavailable'));
    } catch { /* Older browsers use a yielding canvas fallback. */ }
  }

  private stopWorker(reason: Error) {
    this.worker?.terminate();
    this.worker = null;
    this.pending.rejectAll(reason);
  }

  dispose() { this.disposed = true; this.decodeAbort.abort(); this.stopWorker(cancelled()); }

  private request<T extends AnalysisResult>(job: AnalysisJob): Promise<T> {
    if (this.disposed) return Promise.reject(cancelled());
    if (!this.worker) return Promise.reject(new Error('Image worker unavailable'));
    return this.pending.request(requestId => this.worker!.postMessage({ ...job, requestId }), 30_000,
      () => this.stopWorker(new Error('Image analysis timed out'))) as Promise<T>;
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
    const decoded = await decodeImage(blob, this.decodeAbort.signal);
    const { image } = decoded;
    try {
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
      return { version: ANALYSIS_VERSION, width, height, hash: perceptualHash(pixels), color: colorHistogram(pixels) };
    } finally { decoded.release(); }
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

  async similarColors(candidates: ColoredImage[], references: ColoredImage[], limit: number): Promise<SimilarMatch[]> {
    if (this.worker) {
      try { return await this.request<SimilarMatch[]>({ kind: 'color-similar', candidates, references, limit }); }
      catch { if (this.disposed) throw cancelled(); }
    }
    await yieldWork(); if (this.disposed) throw cancelled();
    return findSimilarColors(candidates, references, limit);
  }
}
