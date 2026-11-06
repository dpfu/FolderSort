import * as React from 'react';
import { useStableCallback } from './useStableCallback';
import { workspaceSelection } from './workspaceSelection';
import type { LibraryImage } from './libraryStore';
const apply = <T,>(update: React.SetStateAction<T>, value: T): T => typeof update === 'function' ? (update as (value: T) => T)(value) : update;
/** Last interaction, selected membership and toggle mode have distinct meanings. */
export function useWorkspaceSelection(images: LibraryImage[]) {
  const [state, dispatch] = React.useReducer(workspaceSelection, { ids: new Set<string>(), lastInteracted: null, multi: false });
  React.useEffect(() => { dispatch({ type: 'prune', available: new Set(images.map(image => image.id)) }); }, [images]);
  const setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>> = React.useCallback(update => dispatch({ type: 'ids', update: ids => apply(update, ids) }), []);
  const setSelectedId: React.Dispatch<React.SetStateAction<string | null>> = React.useCallback(update => dispatch({ type: 'focus', update: id => apply(update, id) }), []);
  const setMultiSelect: React.Dispatch<React.SetStateAction<boolean>> = React.useCallback(update => dispatch({ type: 'mode', update: multi => apply(update, multi) }), []);
  const clearSelection = useStableCallback(() => dispatch({ type: 'clear' }));
  const selectImage = useStableCallback((id: string, options?: { toggle?: boolean }) => dispatch({ type: 'pick', id, toggle: !!options?.toggle }));
  return { selectedId: state.lastInteracted, selectedIds: state.ids, multiSelect: state.multi, setSelectedIds, setSelectedId, setMultiSelect, clearSelection, selectImage,
    dragSelection: (id: string) => state.ids.has(id) ? [...state.ids] : [id] };
}
