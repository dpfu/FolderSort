import type { LibraryImage } from './libraryStore';
export type WorkspaceEntry = { browser?: boolean; folderId?: string; importedIds?: string[] };
export type ReviewContext = { ids: string[]; parentId: string | null };
export type ProjectSession = {
  route: { page: 'project' } | { page: 'workspace'; entry: WorkspaceEntry };
  review?: { image: LibraryImage; context?: ReviewContext };
  settingsOpen: boolean;
  recentImport?: { projectId: string; ids: string[] };
};
export const initialProjectSession: ProjectSession = {
  route: { page: 'project' },
  settingsOpen: false,
};
export type ProjectSessionEvent =
  | { type: 'reset' }
  | { type: 'project' }
  | { type: 'workspace'; entry: WorkspaceEntry }
  | { type: 'review'; image: LibraryImage; context?: ReviewContext }
  | { type: 'review-update'; update: (image: LibraryImage | undefined) => LibraryImage | undefined }
  | { type: 'settings'; open: boolean }
  | { type: 'imported'; value: ProjectSession['recentImport'] };
export function projectSession(state: ProjectSession, event: ProjectSessionEvent): ProjectSession {
  switch (event.type) {
    case 'reset':
      return initialProjectSession;
    case 'project':
      return { ...state, route: { page: 'project' }, review: undefined };
    case 'workspace':
      return { ...state, route: { page: 'workspace', entry: event.entry } };
    case 'review':
      return { ...state, review: { image: event.image, context: event.context } };
    case 'review-update': {
      const image = event.update(state.review?.image);
      return { ...state, review: image ? { image, context: state.review?.context } : undefined };
    }
    case 'settings':
      return { ...state, settingsOpen: event.open };
    case 'imported':
      return { ...state, recentImport: event.value };
  }
}
