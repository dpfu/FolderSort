import { afterEach, expect, it, vi } from 'vitest';
import { HintSession } from './hintSession';
afterEach(() => vi.useRealTimers());
it('keeps pinned linked help through pointer leave, then dismisses after focus leaves', () => {
  vi.useFakeTimers(); const hint = new HintSession(() => false);
  hint.enter(true); vi.advanceTimersByTime(249); expect(hint.open).toBe(false);
  vi.advanceTimersByTime(1); expect(hint.snapshot()).toBe('transient');
  hint.show(true); hint.leave(); vi.advanceTimersByTime(130); expect(hint.pinned).toBe(true);
  hint.blur(); vi.advanceTimersByTime(130); expect(hint.open).toBe(false);
});
it('suppresses restoration focus and cancels delayed work when disposed', () => {
  vi.useFakeTimers(); const hint = new HintSession(() => false);
  hint.show(); hint.suppressNextFocus(); hint.close(); hint.focus(false); expect(hint.open).toBe(false);
  hint.enter(true); hint.dispose(); vi.advanceTimersByTime(500); expect(hint.open).toBe(false);
});
