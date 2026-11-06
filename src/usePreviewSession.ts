import * as React from 'react';
import { PreviewSession } from './previewSession';

export function usePreviewSession<T>(initial: T, open = false) {
  const [session] = React.useState(() => new PreviewSession(initial, open));
  const state = React.useSyncExternalStore(session.subscribe, session.snapshot);
  React.useEffect(() => { session.activate(); return () => session.deactivate(); }, [session]);
  return { session, state };
}
