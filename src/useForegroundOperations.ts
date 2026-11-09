import * as React from 'react';
import { ForegroundOperations } from './foregroundOperations';

export function useForegroundOperations() {
  const [operations] = React.useState(() => new ForegroundOperations());
  const state = React.useSyncExternalStore(operations.subscribe, operations.snapshot);
  return { operations, ...state };
}
