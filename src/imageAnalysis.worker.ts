import { ANALYSIS_VERSION, HASH_SAMPLE_SIZE, findSimilar, perceptualHash, similarityOrder, type AnalysisJob } from './imageAnalysis';

self.onmessage = async (event: MessageEvent<AnalysisJob & { requestId: number }>) => {
  const job = event.data;
  try {
    let result;
    if (job.kind === 'analyze') {
      const bitmap = await createImageBitmap(job.blob);
      try {
        const canvas = new OffscreenCanvas(HASH_SAMPLE_SIZE, HASH_SAMPLE_SIZE);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas unavailable');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, HASH_SAMPLE_SIZE, HASH_SAMPLE_SIZE);
        context.drawImage(bitmap, 0, 0, HASH_SAMPLE_SIZE, HASH_SAMPLE_SIZE);
        result = { version: ANALYSIS_VERSION, width: bitmap.width, height: bitmap.height,
          hash: perceptualHash(context.getImageData(0, 0, HASH_SAMPLE_SIZE, HASH_SAMPLE_SIZE).data) };
      } finally { bitmap.close(); }
    } else if (job.kind === 'pixels') {
      result = { version: ANALYSIS_VERSION, width: job.width, height: job.height, hash: perceptualHash(job.pixels) };
    } else if (job.kind === 'order') result = await similarityOrder(job.images);
    else result = findSimilar(job.candidates, job.references, job.limit);
    self.postMessage({ requestId: job.requestId, result });
  } catch (cause) {
    self.postMessage({ requestId: job.requestId, error: cause instanceof Error ? cause.message : String(cause) });
  }
};
