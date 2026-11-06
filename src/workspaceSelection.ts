export type WorkspaceSelection = { ids: Set<string>; lastInteracted: string | null; multi: boolean };
export type SelectionEvent =
  | { type: 'clear' } | { type: 'pick'; id: string; toggle: boolean }
  | { type: 'ids'; update: (ids: Set<string>) => Set<string> }
  | { type: 'focus'; update: (id: string | null) => string | null }
  | { type: 'mode'; update: (multi: boolean) => boolean }
  | { type: 'prune'; available: Set<string> };
export function workspaceSelection(state: WorkspaceSelection, event: SelectionEvent): WorkspaceSelection {
  switch (event.type) {
    case 'clear': return { ...state, ids: new Set(), lastInteracted: null };
    case 'pick': {
      const ids = event.toggle || state.multi ? new Set(state.ids) : new Set<string>();
      if (ids.has(event.id)) ids.delete(event.id); else ids.add(event.id);
      return { ...state, ids, lastInteracted: event.id };
    }
    case 'ids': return { ...state, ids: event.update(state.ids) };
    case 'focus': return { ...state, lastInteracted: event.update(state.lastInteracted) };
    case 'mode': return { ...state, multi: event.update(state.multi) };
    case 'prune': return { ...state, ids: new Set([...state.ids].filter(id => event.available.has(id))), lastInteracted: state.lastInteracted && event.available.has(state.lastInteracted) ? state.lastInteracted : null };
  }
}
