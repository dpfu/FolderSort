import * as React from 'react';
import { AsyncTask } from './asyncTask';
export function useAsyncTask() {
  const [task] = React.useState(() => new AsyncTask());
  const state = React.useSyncExternalStore(task.subscribe, task.snapshot);
  React.useEffect(() => {
    task.activate();
    return () => task.deactivate();
  }, [task]);
  return { task, state, running: state.phase === 'running' };
}
