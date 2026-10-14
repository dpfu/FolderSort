import * as React from 'react';
import { useContentAnalysis, type ContentIndex } from './useContentAnalysis';
import type { LibraryImage } from './libraryStore';

const Context = React.createContext<ContentIndex | null>(null);

/** One worker and saved index for every screen of the active project. */
export function ContentIndexProvider({ images, enabled, children }: {
  images: LibraryImage[]; enabled: boolean; children: React.ReactNode;
}) {
  const index = useContentAnalysis(images, enabled);
  return <Context.Provider value={index}>{children}</Context.Provider>;
}

export function useContentIndex() {
  const index = React.useContext(Context);
  if (!index) throw new Error('Content index requires an active project session.');
  return index;
}
