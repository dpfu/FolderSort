/** The caller owns the decoded image until release; failed/aborted loads release themselves. */
export async function decodeImage(
  blob: Blob,
  signal?: AbortSignal,
  error = () => new Error('Image cannot be decoded'),
) {
  const image = new Image(),
    url = URL.createObjectURL(blob);
  let timer: ReturnType<typeof setTimeout> | undefined,
    abort: (() => void) | undefined,
    released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
    image.onload = null;
    image.onerror = null;
    image.src = '';
    URL.revokeObjectURL(url);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => reject(new DOMException('Image decode cancelled', 'AbortError'));
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => reject(error()), 15_000);
      image.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      image.onerror = () => reject(error());
      image.src = url;
    });
    return { image, release };
  } catch (cause) {
    release();
    throw cause;
  }
}
