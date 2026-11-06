import { afterEach, expect, it, vi } from 'vitest';
import { HoldToGroup } from './holdToGroup';
afterEach(() => vi.useRealTimers());
it('only arms the current, still-valid target, and cancellation clears its timer', () => {
  vi.useFakeTimers(); const hold = new HoldToGroup(), changed = vi.fn(); let valid = true;
  const prepare = (target: string, x: number) => hold.prepare(target, { x, y: 0 }, 12, 600, () => valid, changed);
  prepare('a', 0); vi.advanceTimersByTime(300); prepare('a', 5); vi.advanceTimersByTime(300);
  expect(hold.current?.ready).toBe(true);
  prepare('b', 0); valid = false; vi.advanceTimersByTime(600); expect(hold.current?.ready).toBe(false);
  prepare('c', 0); hold.cancel(); vi.runAllTimers(); expect(hold.current).toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
});
