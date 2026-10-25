import * as React from 'react';

type Target = 'create' | 'selection' | 'undo';

/** Wait for saving/modality to finish before restoring a replaced action's focus. */
export function useWorkspaceActionFocus(root: React.RefObject<HTMLElement>, blocked: boolean) {
  const [request, setRequest] = React.useState<Target | null>(null);
  React.useEffect(() => {
    if (!request || blocked) return;
    const frame = requestAnimationFrame(() => {
      setRequest(null);
      if (request === 'create' && document.activeElement !== document.body && !document.activeElement?.closest('.image-browser__add')) return;
      const selector = request === 'create' ? '[data-action="createStash"]'
        : '[data-action="moveToStash"], [data-action="select"], [data-action="selected"]';
      root.current?.querySelector<HTMLButtonElement>(request === 'undo' ? '[data-action="undo"]:not(:disabled)' : `.workspace-selection :is(${selector})`)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [request, blocked, root]);
  return setRequest;
}
