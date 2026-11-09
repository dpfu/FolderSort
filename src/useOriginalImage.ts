import * as React from 'react';
import { getImageBlob } from './libraryStore';
type Original =
  | { id: string; phase: 'loading' | 'unavailable' }
  | { id: string; phase: 'ready'; url: string };
/** The effect owns exactly one URL and rejects completion for a replaced original. */
export function useOriginalImage(id: string) {
  const [state, setState] = React.useState<Original>({ id, phase: 'loading' });
  React.useEffect(() => {
    let active = true,
      url: string | undefined;
    setState({ id, phase: 'loading' });
    void getImageBlob(id)
      .then((blob) => {
        if (!active) return;
        if (!blob) {
          setState({ id, phase: 'unavailable' });
          return;
        }
        url = URL.createObjectURL(blob);
        setState({ id, phase: 'ready', url });
      })
      .catch(() => {
        if (active) setState({ id, phase: 'unavailable' });
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  return {
    url: state.id === id && state.phase === 'ready' ? state.url : undefined,
    failed: state.id === id && state.phase === 'unavailable',
    fail: () => setState((current) => (current.id === id ? { id, phase: 'unavailable' } : current)),
  };
}
