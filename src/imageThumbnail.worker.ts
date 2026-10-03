// Decode and resize away from the UI thread. Only two jobs are submitted at a
// time, so large originals cannot create an unbounded queue of decoded bitmaps.
self.onmessage = async (event: MessageEvent<{ requestId: number; blob: Blob; edge: number }>) => {
  const { requestId, blob, edge } = event.data;
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const thumbnail = await canvas.convertToBlob({ type: 'image/webp', quality: .86 });
      self.postMessage({ requestId, blob: thumbnail });
    } finally { bitmap.close(); }
  } catch (cause) {
    self.postMessage({ requestId, error: cause instanceof Error ? cause.message : String(cause) });
  }
};
