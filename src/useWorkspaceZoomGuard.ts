import * as React from 'react';

/** Keep native Safari magnification out of the workspace, without a global viewport lock. */
export function useWorkspaceZoomGuard(ref: React.RefObject<HTMLElement>) {
  React.useEffect(() => {
    const workspace = ref.current; if (!workspace) return;
    const touch = (event: TouchEvent) => { if (event.touches.length > 1 && event.cancelable) event.preventDefault(); };
    const gesture = (event: Event) => { if (event.cancelable) event.preventDefault(); };
    workspace.addEventListener('touchstart', touch, { passive: false }); workspace.addEventListener('touchmove', touch, { passive: false });
    workspace.addEventListener('gesturestart', gesture, { passive: false }); workspace.addEventListener('gesturechange', gesture, { passive: false });
    return () => {
      workspace.removeEventListener('touchstart', touch); workspace.removeEventListener('touchmove', touch);
      workspace.removeEventListener('gesturestart', gesture); workspace.removeEventListener('gesturechange', gesture);
    };
  }, [ref]);
}
