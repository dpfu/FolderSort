// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useProjectTransfers } from './useProjectTransfers';
import { ForegroundOperations } from './foregroundOperations';
import type { RunForeground } from './useProjectCommands';
const mocks = vi.hoisted(() => ({ droppedFiles: vi.fn() }));
vi.mock('./importIntake', () => ({
  droppedFiles: mocks.droppedFiles,
  nameFromIncomingFolder: () => 'Test',
}));
const deferred = () => {
  let resolve!: (items: { file: File; path: string }[]) => void;
  return {
    promise: new Promise<{ file: File; path: string }[]>((done) => {
      resolve = done;
    }),
    resolve: (items: { file: File; path: string }[]) => resolve(items),
  };
};
const items = [{ file: new File(['image'], 'a.svg', { type: 'image/svg+xml' }), path: 'a.svg' }];
function options(id: string, run: RunForeground): Parameters<typeof useProjectTransfers>[0] {
  return {
    library: { activeId: id, projects: [], selectProject: vi.fn() },
    session: {
      openWorkspace: vi.fn(),
      resetViews: vi.fn(),
      setRecentImport: vi.fn(),
      setSelected: vi.fn(),
    },
    run,
    operations: new ForegroundOperations(),
    refresh: vi.fn(),
    setError: vi.fn(),
    setMessage: vi.fn(),
  };
}
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
it('discards discovery that belongs to a project that is no longer open', async () => {
  const pending = deferred(),
    run = vi.fn().mockResolvedValue(true);
  mocks.droppedFiles.mockReturnValue(pending.promise);
  const { result, rerender } = renderHook(({ id }) => useProjectTransfers(options(id, run)), {
    initialProps: { id: 'a' },
  });
  let drop!: Promise<void>;
  act(() => {
    drop = result.current.drop({} as DataTransfer);
  });
  rerender({ id: 'b' });
  await act(async () => {
    pending.resolve(items);
    await drop;
  });
  expect(run).not.toHaveBeenCalled();
  expect(result.current.pendingImport).toBeNull();
});
it('only submits the latest discovery when drops finish out of order', async () => {
  const old = deferred(),
    latest = deferred(),
    run = vi.fn().mockResolvedValue(true);
  mocks.droppedFiles.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  const { result } = renderHook(() => useProjectTransfers(options('a', run)));
  let first!: Promise<void>, second!: Promise<void>;
  act(() => {
    first = result.current.drop({} as DataTransfer);
    second = result.current.drop({} as DataTransfer);
  });
  await act(async () => {
    latest.resolve(items);
    await second;
  });
  await act(async () => {
    old.resolve(items);
    await first;
  });
  expect(run).toHaveBeenCalledOnce();
});
