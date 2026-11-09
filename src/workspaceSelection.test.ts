import { expect, it } from 'vitest';
import { workspaceSelection } from './workspaceSelection';
it('keeps last interaction distinct from membership after toggling and prunes only unavailable records', () => {
  let state = { ids: new Set<string>(), lastInteracted: null as string | null, multi: false };
  state = workspaceSelection(state, { type: 'pick', id: 'a', toggle: false });
  state = workspaceSelection(state, { type: 'pick', id: 'a', toggle: true });
  expect([...state.ids]).toEqual([]);
  expect(state.lastInteracted).toBe('a');
  state = workspaceSelection(state, { type: 'prune', available: new Set(['a']) });
  expect(state.lastInteracted).toBe('a');
  expect(
    workspaceSelection(state, { type: 'prune', available: new Set() }).lastInteracted,
  ).toBeNull();
});

it('retains selection identity across position and metadata updates, but removes deleted members', () => {
  const ids = new Set(['a', 'b']);
  const state = { ids, lastInteracted: 'b', multi: true };
  expect(workspaceSelection(state, { type: 'prune', available: new Set(['a', 'b', 'c']) })).toBe(
    state,
  );
  const pruned = workspaceSelection(state, { type: 'prune', available: new Set(['a', 'c']) });
  expect([...pruned.ids]).toEqual(['a']);
  expect(pruned.lastInteracted).toBeNull();
  expect(pruned.multi).toBe(true);
  expect([...ids]).toEqual(['a', 'b']);
});
