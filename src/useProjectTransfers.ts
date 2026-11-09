import * as React from 'react';
import { importImages } from './imageImport';
import { nameFromIncomingFolder } from './importIntake';
import { droppedFiles } from './importIntake';
import { useAsyncTask } from './useAsyncTask';
import { proposedSourceCategories } from './folderCategories';
import { download, safeFilename } from './download';
import {
  createProject,
  isImageFile,
  importProjectZip,
  importProjectDirectory,
  exportSortedZip,
  exportSortedDirectory,
  exportProjectZip,
  exportProjectDirectory,
  type IncomingImage,
  type LibraryImage,
} from './libraryStore';
import type { ForegroundOperations } from './foregroundOperations';
import type { RunForeground } from './useProjectCommands';
import type { ProjectLibrary } from './useProjectLibrary';
import type { ProjectSession, WorkspaceEntry } from './projectSession';
type TransferSession = {
  setRecentImport: (value: ProjectSession['recentImport']) => void;
  openWorkspace: (entry?: WorkspaceEntry) => void;
  resetViews: () => void;
  setSelected: React.Dispatch<React.SetStateAction<LibraryImage | undefined>>;
};
type Options = {
  library: Pick<ProjectLibrary, 'activeId' | 'selectProject' | 'projects'>;
  session: TransferSession;
  run: RunForeground;
  operations: ForegroundOperations;
  refresh: (id?: string) => Promise<LibraryImage[] | undefined>;
  setError: (message: string) => void;
  setMessage: (message: string) => void;
};
/** Import choice, partial intake recovery and export are bounded foreground jobs. */
export function useProjectTransfers({
  library,
  session,
  run,
  operations,
  refresh,
  setError,
  setMessage,
}: Options) {
  const { activeId, selectProject, projects } = library;
  const active = projects.find((project) => project.id === activeId);
  const { setRecentImport, openWorkspace, resetViews, setSelected } = session;
  const [pendingImport, setPendingImport] = React.useState<IncomingImage[] | null>(null);
  const { task: discovery } = useAsyncTask();
  React.useEffect(() => {
    discovery.cancel();
  }, [activeId, discovery]);
  const ingest = async (items: IncomingImage[], useSourceFolders = false) => {
    await run('Adding images…', async (task) => {
      const projectId = activeId || (await createProject(nameFromIncomingFolder(items))).id;
      if (!activeId) selectProject(projectId);
      setRecentImport(undefined);
      const result = await importImages(projectId, items, useSourceFolders, (done, total) =>
        operations.progress(task, `Adding images… ${done}/${total}`),
      ).catch(async (cause) => {
        // Each original is atomic. Show any completed imports after a later
        // quota/decode/storage failure instead of hiding them until reload.
        await refresh(projectId).catch(() => {});
        throw cause;
      });
      const imported = await refresh(projectId);
      const skipped = [
        result.duplicates &&
          `${result.duplicates} duplicate ${result.duplicates === 1 ? 'path' : 'paths'}`,
        result.unsupported &&
          `${result.unsupported} unsupported ${result.unsupported === 1 ? 'file' : 'files'}`,
      ].filter(Boolean);
      setMessage(
        `${result.added} image${result.added === 1 ? '' : 's'} added${skipped.length ? `; skipped ${skipped.join(' and ')}` : ''}. Saved locally.`,
      );
      if (result.ids.length) setRecentImport({ projectId, ids: result.ids });
      // Compare against the saved collection, rather than possibly stale React
      // state during startup. Only the first successful image import enters sort.
      if (result.added > 0 && imported?.length === result.added) openWorkspace();
    });
  };

  const beginImport = (items: IncomingImage[]) => {
    discovery.cancel();
    if (!items.length) return;
    if (!items.some((item) => isImageFile(item.file))) {
      setError('No supported images found. Try PNG, JPG/JPEG, GIF, WebP, AVIF, or SVG files.');
      return;
    }
    if (proposedSourceCategories(items).length) setPendingImport(items);
    else void ingest(items);
  };

  const importZip = async (file?: File) => {
    if (!file) return;
    await run('Importing project…', async () => {
      const project = await importProjectZip(file);
      selectProject(project.id);
      resetViews();
      setSelected(undefined);
      setPendingImport(null);
      await refresh(project.id);
      setMessage('Project imported and saved locally.');
    });
  };

  const importFolder = async (files: File[]) => {
    if (!files.length) return;
    await run('Importing project folder…', async () => {
      const project = await importProjectDirectory(files);
      selectProject(project.id);
      resetViews();
      setSelected(undefined);
      setPendingImport(null);
      await refresh(project.id);
      setMessage('Project folder imported and saved locally.');
    });
  };

  const exportSorted = (format: 'zip' | 'folder') =>
    run(format === 'zip' ? 'Preparing sorted ZIP…' : 'Exporting sorted folder…', async () => {
      if (!active) return;
      if (format === 'zip') {
        download(await exportSortedZip(active.id), `${safeFilename(active.name)}-sorted.zip`);
        setMessage('Sorted ZIP is ready to download.');
      } else {
        const picker = (
          window as unknown as {
            showDirectoryPicker: (options: {
              mode: 'readwrite';
            }) => Promise<FileSystemDirectoryHandle>;
          }
        ).showDirectoryPicker;
        const parent = await picker({ mode: 'readwrite' });
        const folderName = `${safeFilename(active.name)}-sorted-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        await exportSortedDirectory(
          active.id,
          await parent.getDirectoryHandle(folderName, { create: true }),
        );
        setMessage(`Sorted images saved in the ${folderName} folder.`);
      }
    });

  const exportBackup = (format: 'zip' | 'folder') =>
    run('Preparing backup…', async () => {
      if (!active) return;
      if (format === 'zip')
        download(await exportProjectZip(active.id), `${safeFilename(active.name)}.zip`);
      else {
        const picker = (
          window as unknown as {
            showDirectoryPicker: (options: {
              mode: 'readwrite';
            }) => Promise<FileSystemDirectoryHandle>;
          }
        ).showDirectoryPicker;
        const parent = await picker({ mode: 'readwrite' });
        const folderName = `${safeFilename(active.name)}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        await exportProjectDirectory(
          active.id,
          await parent.getDirectoryHandle(folderName, { create: true }),
        );
      }
      setMessage('Project backup saved.');
    });

  const drop = async (transfer: DataTransfer) => {
    const ticket = discovery.begin('replace');
    if (!ticket) return;
    try {
      const items = await droppedFiles(transfer);
      if (discovery.complete(ticket)) beginImport(items);
    } catch (cause) {
      if (discovery.fail(ticket, cause)) setError(String(cause));
    }
  };
  return {
    pendingImport,
    setPendingImport,
    ingest,
    beginImport,
    drop,
    importZip,
    importFolder,
    exportSorted,
    exportBackup,
  };
}
