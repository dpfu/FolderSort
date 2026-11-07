import * as React from 'react';
import { readImageBrowserView } from './imageBrowserView';
type Panel = { width: number; mode: 'collapsed' | 'docked' | 'expanded' };
type View = { width: number; collapsed: boolean; expanded: boolean };
const view = (panel: Panel): View => ({
  width: panel.width,
  collapsed: panel.mode === 'collapsed',
  expanded: panel.mode === 'expanded',
});
export function useBrowserPanel(projectId: string, expanded = false) {
  const [panel, setPanel] = React.useState<Panel>(() => {
    const saved = readImageBrowserView(projectId);
    return {
      width: saved.width,
      mode: expanded ? 'expanded' : saved.collapsed ? 'collapsed' : 'docked',
    };
  });
  const update = React.useCallback(
    (value: React.SetStateAction<View>) =>
      setPanel((current) => {
        const next = typeof value === 'function' ? value(view(current)) : value;
        return {
          width: next.width,
          mode: next.expanded ? 'expanded' : next.collapsed ? 'collapsed' : 'docked',
        };
      }),
    [],
  );
  return [view(panel), update] as const;
}
