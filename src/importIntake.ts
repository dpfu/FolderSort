import { cleanRelativePath, type IncomingImage } from './libraryStore';

type Entry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (success: (file: File) => void, error: (error: Error) => void) => void;
  createReader?: () => { readEntries: (success: (entries: Entry[]) => void, error: (error: Error) => void) => void };
};

export async function droppedFiles(transfer: DataTransfer): Promise<IncomingImage[]> {
  const collect = async (entry: Entry, parent = ''): Promise<IncomingImage[]> => {
    const path = parent ? `${parent}/${entry.name}` : entry.name;
    if (entry.isFile && entry.file) {
      const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
      return [{ file, path }];
    }
    if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader();
      const children: Entry[] = [];
      // Chromium returns at most 100 entries per call, so continue until empty.
      while (true) {
        const batch = await new Promise<Entry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        children.push(...batch);
      }
      const nested = await Promise.all(children.map((child) => collect(child, path)));
      return nested.flat();
    }
    return [];
  };
  const entries = [...transfer.items].filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() as Entry | null)
    .filter((entry): entry is Entry => Boolean(entry));
  if (entries.length) return (await Promise.all(entries.map((entry) => collect(entry)))).flat();
  return [...transfer.files].map((file) => ({ file, path: file.name }));
}

export function nameFromIncomingFolder(items: IncomingImage[]): string {
  const roots = new Set(items.map((item) => cleanRelativePath(item.path).split('/')[0]));
  return roots.size === 1 && items.some((item) => item.path.includes('/')) ? [...roots][0] : 'Untitled project';
}

