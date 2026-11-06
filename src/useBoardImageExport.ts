import * as React from 'react';
import { useAsyncTask } from './useAsyncTask';
import { useTimedValue } from './useTimedValue';
import { download, safeFilename } from './download';
import type { BoardExportScope, BoardSnapshot } from './boardExport';

export function useBoardImageExport(projectName: string, disabled: boolean, snapshot: (scope: BoardExportScope) => BoardSnapshot | undefined) {
  const { task, state } = useAsyncTask();
  const current = React.useRef<{ ticket: object; controller: AbortController }>();
  const [status, setStatus] = React.useState('');
  const [notice, setNotice] = useTimedValue('', 7000);
  React.useEffect(() => () => current.current?.controller.abort(), []);
  const save = async (scope: BoardExportScope) => {
    if (disabled) return;
    const data = snapshot(scope); if (!data) return;
    const ticket = task.begin(); if (!ticket) return;
    const controller = new AbortController(); current.current = { ticket, controller };
    setNotice(''); setStatus('Preparing board PNG…');
    try {
      const { exportBoardPng } = await import('./boardExport');
      const result = await exportBoardPng(data, controller.signal, (done, total) => {
        if (task.owns(ticket)) setStatus(`Saving board PNG… ${done.toLocaleString()} / ${total.toLocaleString()}`);
      });
      if (!task.owns(ticket)) return;
      download(result.blob, `${safeFilename(projectName)}-board-${scope === 'view' ? 'view' : 'full'}.png`);
      setNotice(`Board PNG saved · ${result.width} × ${result.height}${result.reduced ? ' · scaled to fit' : ''}${result.unavailable ? ` · ${result.unavailable} ${result.unavailable === 1 ? 'preview' : 'previews'} unavailable` : ''}`);
    } catch (cause) {
      if (task.owns(ticket)) {
        if (controller.signal.aborted) setNotice('Board image export canceled.');
        else task.fail(ticket, cause instanceof Error ? cause.message : 'Could not export the board image.');
      }
    } finally {
      if (current.current?.ticket === ticket) { current.current = undefined; if (task.active) setStatus(''); }
      task.complete(ticket);
    }
  };
  return { save, status, notice, error: state.error, cancel: () => current.current?.controller.abort(), clearError: () => task.cancel() };
}
