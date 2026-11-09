import * as React from 'react';
/** Presentation lifetime only; expiry never mutates the underlying project. */
export function useTimedValue<T>(empty: T, duration: number) {
  const [value, setValue] = React.useState(empty);
  React.useEffect(() => {
    if (value === empty) return;
    const timer = setTimeout(() => setValue(empty), duration);
    return () => clearTimeout(timer);
  }, [value, empty, duration]);
  return [value, setValue] as const;
}
