/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useStableCallback } from './useStableCallback';

it('memoized event handlers retain identity and use the latest committed selection', () => {
  const save = vi.fn();
  const { result, rerender } = renderHook(({ selected }) => useStableCallback((destination: string) => save(selected, destination)), { initialProps: { selected: ['first'] } });
  const handler = result.current;
  rerender({ selected: ['second', 'third'] });
  expect(result.current).toBe(handler);
  act(() => handler('stash'));
  expect(save).toHaveBeenCalledExactlyOnceWith(['second', 'third'], 'stash');
});
