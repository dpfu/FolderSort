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
it('keeps a tap toggle stable when the browser blurs and refocuses the trigger before click', () => {
  const hint = new HintSession(() => false);
  hint.press(); hint.focus(false); hint.toggle(true); expect(hint.pinned).toBe(true);
  hint.press(); hint.blur(); hint.focus(false); hint.toggle(true); expect(hint.open).toBe(false);
  hint.dispose();
});
it('ignores a cancelled or stale pointer press for keyboard activation', () => {
  const hint = new HintSession(() => false);
  hint.press(); hint.cancelPress(); hint.show(true); hint.toggle(true); expect(hint.open).toBe(false);
  hint.press(); hint.show(true); hint.toggle(false); expect(hint.open).toBe(false); hint.dispose();
});
it('suppresses restoration focus and cancels delayed work when disposed', () => {
  vi.useFakeTimers(); const hint = new HintSession(() => false);
  hint.show(); hint.suppressNextFocus(); hint.close(); hint.focus(false); expect(hint.open).toBe(false);
  hint.enter(true); hint.dispose(); vi.advanceTimersByTime(500); expect(hint.open).toBe(false);
});
