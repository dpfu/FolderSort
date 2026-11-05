const key = 'foldersort:clip-active';
const interruptedMessage = 'CLIP was interrupted. Retry in project settings when ready; your images are saved.';
function read() { try { return sessionStorage.getItem(key); } catch { return null; } }
function write(active: boolean) {
  try { if (active) sessionStorage.setItem(key, '1'); else sessionStorage.removeItem(key); } catch { /* Storage restrictions must not prevent sorting. */ }
}

// A process kill cannot report a JS error. Keep a tab-scoped marker for the
// lifetime of resident models, so restoring that tab does not repeat the load.
// Ordinary navigation clears it; no project data or model caches are removed.
let interrupted = !!read();
const residents = new Set<object>();
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { if (residents.size) write(false); });
  window.addEventListener('pageshow', () => { if (residents.size) write(true); });
}
export function retainClipModels(owner: object) {
  if (interrupted) throw new Error(interruptedMessage);
  residents.add(owner); write(true);
}
export function releaseClipModels(owner: object) {
  if (residents.delete(owner) && !residents.size) write(false);
}
/** Only an explicit Retry/Resume opts back into model loading after recovery. */
export function retryClipModels() { interrupted = false; if (!residents.size) write(false); }
