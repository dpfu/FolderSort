import { useCallback, useLayoutEffect, useRef } from 'react';

/** Stable event identity for memoized children, with the latest committed state. */
export function useStableCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const latest = useRef(callback);
  useLayoutEffect(() => { latest.current = callback; });
  return useCallback((...args: Args) => latest.current(...args), []);
}
