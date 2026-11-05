/** Keep only the draft's decorative frame for its brief acceptance fade.
 * Capture before saving: saving may unmount the preview component immediately.
 * No photos, controls or saved positions are copied or delayed.
 */
export function capturePreviewFrameExit(previews: HTMLElement | null): () => void {
  const source = previews?.querySelector<HTMLElement>('.board-preview-frame');
  const host = previews?.parentElement;
  if (!source || !host || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const frame = source.cloneNode(false) as HTMLElement;
  frame.classList.add('board-preview-frame--placed');
  let played = false;
  return () => {
    if (played || !host.isConnected) return;
    played = true;
    host.append(frame);
    if (!frame.animate) { frame.remove(); return; }
    const animation = frame.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' });
    const fallback = window.setTimeout(() => frame.remove(), 500);
    const remove = () => { window.clearTimeout(fallback); frame.remove(); };
    void animation.finished.then(remove, remove);
  };
}
