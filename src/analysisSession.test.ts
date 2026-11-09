import { expect, it, vi } from 'vitest';
import { AnalysisSession } from './analysisSession';
it('runs the next metadata need after a failed request without hiding the original failure', async () => {
  const session = new AnalysisSession();
  let reject!: (error: Error) => void;
  const first = session.run(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  const firstFailed = expect(first).rejects.toThrow('Date write failed');
  const work = vi.fn().mockResolvedValue(undefined);
  const second = session.run(work);
  await Promise.resolve();
  expect(work).not.toHaveBeenCalled();
  reject(new Error('Date write failed'));
  await firstFailed;
  await second;
  expect(work).toHaveBeenCalledOnce();
  expect(session.phase).toBe('cold');
});
it('serializes different metadata needs, disposes the decoder and rejects work after cleanup', async () => {
  const session = new AnalysisSession(),
    order: string[] = [];
  let release!: () => void;
  const first = session.run(async () => {
    order.push('dates');
    await new Promise<void>((yes) => {
      release = yes;
    });
  });
  const second = session.run(async () => {
    order.push('color');
  });
  await Promise.resolve();
  expect(order).toEqual(['dates']);
  release();
  await Promise.all([first, second]);
  expect(order).toEqual(['dates', 'color']);
  const worker = { dispose: vi.fn() };
  session.client(() => worker);
  session.markHydrated();
  session.deactivate();
  expect(worker.dispose).toHaveBeenCalledOnce();
  await expect(session.run(async () => {})).rejects.toMatchObject({ name: 'AbortError' });
});
it('invalidates prior work across a cleanup/reactivation without releasing a newer task', async () => {
  const session = new AnalysisSession();
  let release!: () => void, oldValid!: () => boolean;
  const first = session.run(async (valid) => {
    oldValid = valid;
    await new Promise<void>((done) => {
      release = done;
    });
  });
  await Promise.resolve();
  session.deactivate();
  session.activate();
  expect(oldValid()).toBe(false);
  let finish!: () => void;
  const second = session.run(async (valid) => {
    expect(valid()).toBe(true);
    await new Promise<void>((done) => {
      finish = done;
    });
  });
  await Promise.resolve();
  release();
  await first;
  expect(session.phase).toBe('indexing');
  finish();
  await second;
});
