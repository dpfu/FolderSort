import { openDB, type DBSchema } from 'idb';
import type { LibraryProject, LibraryImage, LibraryCategory } from './imageStore';

interface LibraryDB extends DBSchema {
  projects: { key: string; value: LibraryProject };
  images: { key: string; value: LibraryImage; indexes: { byProject: string } };
  categories: { key: string; value: LibraryCategory; indexes: { byProject: string } };
  assets: { key: string; value: Blob };
  meta: { key: string; value: string };
}

export const database = openDB<LibraryDB>('sortboard-image-library-minimal', 2, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects');
    if (!db.objectStoreNames.contains('images')) db.createObjectStore('images').createIndex('byProject', 'projectId');
    if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets');
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories').createIndex('byProject', 'projectId');
  },
});

/** Abort pending writes even when a store method throws before creating an IDB request. */
export async function commitTransaction<T>(tx: { done: Promise<unknown>; abort: () => void }, write: () => Promise<T>): Promise<T> {
  try {
    const result = await write();
    await tx.done;
    return result;
  } catch (cause) {
    try { tx.abort(); } catch { /* The transaction may already have aborted. */ }
    await tx.done.catch(() => {});
    throw cause;
  }
}
