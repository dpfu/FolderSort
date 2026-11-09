import { expect, it, vi } from 'vitest';
import { ContentIndexLifecycle } from './contentIndexLifecycle';
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };

it('serializes paused inference and simultaneous Resume/reference requests into one new run', async () => {
  const lifecycle = new ContentIndexLifecycle(), draining = deferred(), resumed = deferred();
  const first = lifecycle.run(() => draining.promise);
  lifecycle.pause(); expect(lifecycle.phase).toBe('stopping');
  const work = vi.fn(() => resumed.promise);
  const second = lifecycle.run(work), third = lifecycle.run(work);
  expect(work).not.toHaveBeenCalled(); draining.resolve(); await first;
  await vi.waitFor(() => expect(work).toHaveBeenCalledOnce());
  expect(lifecycle.phase).toBe('running'); resumed.resolve(); await Promise.all([second, third]);
  expect(lifecycle.phase).toBe('idle');
});

it('rejects a disposed worker’s late synchronization and makes its progress callback stale', async () => {
  const lifecycle = new ContentIndexLifecycle(), syncing = deferred(), worker = { dispose: vi.fn() };
  let owns!: () => boolean;
  const pending = lifecycle.client(current => { owns = current; return worker; }, () => syncing.promise);
  await Promise.resolve(); expect(owns()).toBe(true);
  lifecycle.disposeWorker(); expect(owns()).toBe(false); expect(worker.dispose).toHaveBeenCalledOnce();
  syncing.resolve(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  const next = { dispose: vi.fn() };
  expect(await lifecycle.client(() => next, async () => {})).toBe(next);
  lifecycle.deactivate(); expect(next.dispose).toHaveBeenCalledOnce();
});

it('waits for the old run and rebuild before resuming, including requests during rebuild', async () => {
  const lifecycle = new ContentIndexLifecycle(), inference = deferred(), reset = deferred();
  const old = lifecycle.run(() => inference.promise);
  const clear = vi.fn(() => reset.promise), work = vi.fn(async () => {});
  const rebuilding = lifecycle.rebuild(clear), resume = lifecycle.run(work);
  expect(lifecycle.phase).toBe('rebuilding'); expect(clear).not.toHaveBeenCalled();
  inference.resolve(); await old;
  await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce()); expect(work).not.toHaveBeenCalled();
  reset.resolve(); await Promise.all([rebuilding, resume]);
  expect(work).toHaveBeenCalledOnce(); expect(lifecycle.phase).toBe('idle');
});

it('invalidates lifetime tokens on cleanup and permits a fresh Strict Mode activation', async () => {
  const lifecycle = new ContentIndexLifecycle(), epoch = lifecycle.epoch;
  lifecycle.deactivate(); lifecycle.activate();
  expect(lifecycle.ownsEpoch(epoch)).toBe(false);
  await lifecycle.run(async () => {}); expect(lifecycle.phase).toBe('idle');
});
