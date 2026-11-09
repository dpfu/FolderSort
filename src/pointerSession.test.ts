import { expect, it } from 'vitest';
import { PointerSession } from './pointerSession';
it('ignores other pointers and permits a single completion', () => {
  const pointer = new PointerSession<{ x: number }>();
  expect(pointer.begin(1, { x: 2 })).toBe(true); expect(pointer.begin(2, { x: 3 })).toBe(false);
  expect(pointer.finish(2)).toBeUndefined(); expect(pointer.finish(1)).toEqual({ x: 2 });
  expect(pointer.finish(1)).toBeUndefined(); expect(pointer.begin(2, { x: 4 })).toBe(true);
  pointer.cancel(); expect(pointer.current).toBeUndefined();
});
