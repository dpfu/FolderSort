import * as React from 'react';
import { useStableCallback } from './useStableCallback';
import type { LibraryImage } from './libraryStore';

/** Browser and board select the same image records, regardless of visibility. */
export function useWorkspaceSelection(images: LibraryImage[]) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [multiSelect, setMultiSelect] = React.useState(false);
  React.useEffect(() => {
    const available = new Set(images.map(image => image.id));
    if (selectedId && !available.has(selectedId)) setSelectedId(null);
    setSelectedIds(current => [...current].every(id => available.has(id)) ? current : new Set([...current].filter(id => available.has(id))));
  }, [images, selectedId]);
  const clearSelection = useStableCallback(() => { setSelectedIds(new Set()); setSelectedId(null); });
  const selectImage = useStableCallback((id: string, options?: { toggle?: boolean }) => {
    setSelectedId(id);
    setSelectedIds(current => {
      if (!options?.toggle && !multiSelect) return new Set([id]);
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  });
  const dragSelection = (id: string) => selectedIds.has(id) ? [...selectedIds] : [id];
  return { selectedId, setSelectedId, selectedIds, setSelectedIds, multiSelect, setMultiSelect, clearSelection, selectImage, dragSelection };
}
