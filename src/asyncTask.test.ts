import { expect, it } from 'vitest';
import { AsyncTask } from './asyncTask';
it('rejects duplicate submissions and stale completions after a replacement or cleanup', () => {
  const task = new AsyncTask(), first = task.begin()!;
  expect(task.begin()).toBeUndefined();
  const next = task.begin('replace')!;
  expect(task.complete(first)).toBe(false); expect(task.fail(first, 'old')).toBe(false);
  expect(task.complete(next)).toBe(true);
  const detached = task.begin()!; task.deactivate(); task.activate();
  expect(task.complete(detached)).toBe(false);
  task.cancel(); expect(task.snapshot()).toEqual({ phase: 'idle', error: '' });
});
it('preserves retryable failures and clears them on a new submission', () => {
  const task = new AsyncTask(); task.fail(task.begin()!, new Error('Storage full'));
  expect(task.snapshot()).toEqual({ phase: 'error', error: 'Storage full' });
  task.complete(task.begin()!); expect(task.snapshot().error).toBe('');
});
