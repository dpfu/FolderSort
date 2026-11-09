import { expect, it } from 'vitest';
import { ForegroundOperations } from './foregroundOperations';

it('keeps overlapping commands busy until each owner finishes and ignores stale progress', () => {
  const operations = new ForegroundOperations();
  const importing = operations.begin('command', 'Importing…');
  const preparing = operations.begin('prepare-folder', 'Arranging…');
  operations.progress(importing, 'Imported 3/10');
  expect(operations.snapshot()).toEqual({ busy: true, progress: 'Arranging…' });
  operations.finish(preparing);
  expect(operations.snapshot()).toEqual({ busy: true, progress: 'Imported 3/10' });
  operations.progress(preparing, 'Late result'); operations.finish(preparing);
  expect(operations.snapshot().progress).toBe('Imported 3/10');
  const assignment = operations.begin('assignment');
  expect(operations.snapshot().progress).toBe('Imported 3/10');
  operations.finish(importing);
  expect(operations.snapshot()).toEqual({ busy: true, progress: '' });
  operations.finish(assignment);
  expect(operations.snapshot()).toEqual({ busy: false, progress: '' });
});

it('detects a command synchronously before React can render its busy state', () => {
  const operations = new ForegroundOperations();
  const undo = operations.begin('undo');
  expect(operations.busy).toBe(true); expect(operations.has('undo')).toBe(true);
  operations.finish(undo);
  expect(operations.has('undo')).toBe(false);
});
