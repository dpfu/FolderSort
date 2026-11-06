import { afterEach, expect, it, vi } from 'vitest';
import { WorkerRequests } from './workerRequests';
afterEach(() => vi.useRealTimers());
it('settles once, ignores late replies and clears every timeout on disposal', async () => {
  vi.useFakeTimers(); const jobs = new WorkerRequests<string>(), expire = vi.fn(); let id = 0;
  const result = jobs.request(value => { id = value; }, 100, expire);
  jobs.settle(id, 'ready'); expect(jobs.settle(id, 'late')).toBe(false); expect(await result).toBe('ready');
  const pending = jobs.request(() => {}, 100, expire); const rejected = expect(pending).rejects.toThrow('Disposed');
  jobs.rejectAll(new Error('Disposed')); await rejected; vi.advanceTimersByTime(100);
  expect(jobs.size).toBe(0); expect(expire).not.toHaveBeenCalled();
});
it('cleans a synchronously rejected post and lets the client own timeout consequences', async () => {
  vi.useFakeTimers(); const jobs = new WorkerRequests<string>();
  await expect(jobs.request(() => { throw new Error('Clone failed'); }, 100, () => {})).rejects.toThrow('Clone failed');
  expect(jobs.size).toBe(0);
  const pending = jobs.request(() => {}, 100, () => jobs.rejectAll(new Error('Timed out')));
  const rejected = expect(pending).rejects.toThrow('Timed out'); vi.advanceTimersByTime(100); await rejected;
});
