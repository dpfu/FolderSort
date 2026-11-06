import { expect, it } from 'vitest';
import { initialProjectSession, projectSession } from './projectSession';
import type { LibraryImage } from './libraryStore';
it('replaces workspace entry context atomically and resets overlays when switching projects', () => {
  const imported = projectSession(initialProjectSession, { type: 'workspace', entry: { browser: true, importedIds: ['a'] } });
  const folder = projectSession(imported, { type: 'workspace', entry: { folderId: 'f' } });
  expect(folder.route).toEqual({ page: 'workspace', entry: { folderId: 'f' } });
  const reviewing = projectSession(folder, { type: 'review', image: { id: 'a' } as LibraryImage, context: { ids: ['a'], parentId: 'f' } });
  expect(projectSession(reviewing, { type: 'reset' })).toEqual(initialProjectSession);
  expect(projectSession(reviewing, { type: 'project' }).review).toBeUndefined();
});
