import type { Page } from '@playwright/test';
import { CLIP_CACHE_KEY } from '../src/contentSimilarity';

export async function mockClipInference(page: Page, failModel = false, modelDelay = 80) {
  await page.addInitScript(({ model, fail, modelDelay }) => {
    const NativeWorker = window.Worker;
    (window as unknown as { clipTerminations: number }).clipTerminations = 0;
    const counts = { workers: 0, models: 0, embeds: 0 };
    (window as unknown as { clipCounts: typeof counts }).clipCounts = counts;
    const searches: Array<{ query: string; done: boolean }> = [];
    (window as unknown as { clipSearches: typeof searches }).clipSearches = searches;
    window.Worker = class extends NativeWorker {
      private clipWorker: boolean;
      private stopped = false;
      private initialized = false;
      private embedded = new Map<number, { model: string; vector: string }>();
      private imageNames = new Map<string, string>();
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.clipWorker = String(url).includes('clip.worker');
        if (this.clipWorker) counts.workers++;
        this.addEventListener('message', (event: MessageEvent) => {
          const vector = this.embedded.get(event.data.requestId);
          if (vector) { event.data.result = vector; this.embedded.delete(event.data.requestId); }
        });
      }
      terminate() { this.stopped = true; if (this.clipWorker) (window as unknown as { clipTerminations: number }).clipTerminations++; super.terminate(); }
      postMessage(message: unknown, transfer: Transferable[] = []) {
        const job = message as { kind: string; requestId: number; id: string; blob: File; query: string; candidates: string[]; labels: string[]; limit: number };
        const reply = (data: object) => { if (!this.stopped) this.onmessage?.call(this, new MessageEvent('message', { data })); };
        if (this.clipWorker && job.kind === 'init') {
          if (!this.initialized) { this.initialized = true; counts.models++; reply({ progress: { phase: 'loading', percent: 50 } }); }
          setTimeout(() => reply(fail ? { requestId: job.requestId, error: 'Model download failed', stage: 'model' } : { requestId: job.requestId, result: null }), modelDelay);
        } else if (this.clipWorker && job.kind === 'embed') {
          this.imageNames.set(job.id, job.blob.name || '');
          setTimeout(() => {
            if (this.stopped) return;
            const name = job.blob.name || '';
            const vector = new Float32Array(512);
            const axis = name.includes('other') ? 10 : 0;
            const nearby = name.includes('variant') ? .1 : 0;
            vector[axis] = 1 / Math.sqrt(1 + nearby * nearby);
            vector[axis + 1] = nearby / Math.sqrt(1 + nearby * nearby);
            const bytes = new Uint8Array(2048), view = new DataView(bytes.buffer);
            vector.forEach((value, index) => view.setFloat32(index * 4, value, true));
            let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
            const clip = { model, vector: btoa(binary) };
            this.embedded.set(job.requestId, clip); counts.embeds++;
            super.postMessage({ kind: 'cache', requestId: job.requestId, images: [{ id: job.id, clip }] });
          }, 180);
        } else if (this.clipWorker && job.kind === 'search') {
          const search = { query: job.query, done: false }; searches.push(search);
          const result = job.candidates.map(id => ({ id, referenceId: '', distance: this.imageNames.get(id)?.includes('other') === job.query.includes('other') ? 0 : 1 })).sort((a, b) => a.distance - b.distance).slice(0, job.limit);
          setTimeout(() => { search.done = true; reply({ requestId: job.requestId, result }); }, job.query.includes('slow') ? 700 : 30);
        } else if (this.clipWorker && job.kind === 'labels') {
          setTimeout(() => reply({ requestId: job.requestId, result: job.labels.slice(0, job.limit).map((label, index) => ({ label, score: .5 - index * .01 })) }), 60);
        } else super.postMessage(message, transfer);
      }
    };
  }, { model: CLIP_CACHE_KEY, fail: failModel, modelDelay });
}

