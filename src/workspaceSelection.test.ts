import { expect, it } from 'vitest';
import { workspaceSelection } from './workspaceSelection';
it('keeps last interaction distinct from membership after toggling and prunes only unavailable records', () => {
  let state = { ids: new Set<string>(), lastInteracted: null as string | null, multi: false };
  state = workspaceSelection(state, { type: 'pick', id: 'a', toggle: false });
  state = workspaceSelection(state, { type: 'pick', id: 'a', toggle: true });
  expect([...state.ids]).toEqual([]); expect(state.lastInteracted).toBe('a');
  state = workspaceSelection(state, { type: 'prune', available: new Set(['a']) }); expect(state.lastInteracted).toBe('a');
  expect(workspaceSelection(state, { type: 'prune', available: new Set() }).lastInteracted).toBeNull();
});
