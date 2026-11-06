import * as React from 'react';
import { initialProjectSession, projectSession, type WorkspaceEntry, type ReviewContext } from './projectSession';
import type { LibraryImage } from './libraryStore';
export function useProjectSession() {
  const [state, dispatch] = React.useReducer(projectSession, initialProjectSession);
  const entry = state.route.page === 'workspace' ? state.route.entry : undefined;
  const setSelected = React.useCallback((update: React.SetStateAction<LibraryImage | undefined>) =>
    dispatch({ type: 'review-update', update: current => typeof update === 'function' ? update(current) : update }), []);
  return { selected: state.review?.image, reviewContext: state.review?.context, settingsOpen: state.settingsOpen, recentImport: state.recentImport,
    view: state.route.page === 'project' ? 'library' : 'sort', initialBrowser: !!entry?.browser, initialStashId: entry?.folderId, importedImageIds: entry?.importedIds,
    setSelected, reviewImage: (image: LibraryImage, context?: ReviewContext) => dispatch({ type: 'review', image, context }),
    openWorkspace: (entry: WorkspaceEntry = {}) => dispatch({ type: 'workspace', entry }),
    showProject: () => dispatch({ type: 'project' }), resetViews: () => dispatch({ type: 'reset' }),
    setSettingsOpen: (open: boolean) => dispatch({ type: 'settings', open }),
    setRecentImport: (value: typeof state.recentImport) => dispatch({ type: 'imported', value }) };
}
