import * as React from 'react';
import { createPortal } from 'react-dom';
import { useStableCallback } from './useStableCallback';
import './context-menu.css';

export type ContextAction = { id: string; label: string; disabled?: boolean; description?: string; separator?: boolean; run: () => void | Promise<unknown> };
export type ContextTrigger = React.MouseEvent | React.KeyboardEvent;
type Request = { label: string; heading?: string; actions: ContextAction[] };
type OpenMenu = (event: ContextTrigger, request: Request) => boolean;
const Context = React.createContext<OpenMenu>(() => false);
export const ContextMenuProvider = Context.Provider;
export const useContextMenu = () => React.useContext(Context);
export const contextKey = (event: React.KeyboardEvent) => event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);

/** Leave browser text editing, links, and Shift-right-click alone. */
export function nativeContextTarget(event: ContextTrigger): boolean {
  const target = event.target instanceof Element ? event.target : null;
  return !!target?.closest('a, textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type="checkbox"]):not([type="radio"])') ||
    (event.type === 'contextmenu' && event.shiftKey);
}

export function useContextMenuController(scope: string, blocked: boolean, onError: (message: string) => void) {
  const [menu, setMenu] = React.useState<(Request & { x: number; y: number; source: HTMLElement | null }) | null>(null);
  const open = useStableCallback((event: ContextTrigger, request: Request) => {
    if (blocked || event.defaultPrevented || nativeContextTarget(event) || !request.actions.length) return false;
    const target = event.target instanceof Element ? event.target : null;
    const source = target?.closest<HTMLElement>('button, input, [tabindex], [role="group"]') || (event.currentTarget as HTMLElement);
    const rect = source.getBoundingClientRect();
    const mouse = 'clientX' in event && (event.clientX !== 0 || event.clientY !== 0);
    event.preventDefault(); event.stopPropagation();
    setMenu({ ...request, x: mouse ? event.clientX : rect.left + Math.min(24, rect.width / 2), y: mouse ? event.clientY : rect.bottom, source });
    return true;
  });
  const close = useStableCallback((restore = false) => {
    const source = menu?.source;
    setMenu(null);
    if (restore && source?.isConnected) source.focus({ preventScroll: true });
  });
  React.useEffect(() => close(), [scope, blocked, close]);
  return { open, host: menu && <ContextMenu request={menu} close={close} onError={onError} /> };
}

function ContextMenu({ request, close, onError }: { request: Request & { x: number; y: number; source: HTMLElement | null }; close: (restore?: boolean) => void; onError: (message: string) => void }) {
  const root = React.useRef<HTMLDivElement>(null);
  const [point, setPoint] = React.useState({ x: request.x, y: request.y });
  const typeahead = React.useRef({ text: '', time: 0 });
  const scrollPositions = React.useRef(new Map<Element, { x: number; y: number }>());
  React.useLayoutEffect(() => {
    const element = root.current!;
    const bounds = element.getBoundingClientRect(), margin = 8;
    setPoint({ x: Math.max(margin, Math.min(request.x, innerWidth - bounds.width - margin)), y: Math.max(margin, Math.min(request.y, innerHeight - bounds.height - margin)) });
    element.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const positions = new Map<Element, { x: number; y: number }>();
    for (let node: HTMLElement | null = request.source; node; node = node.parentElement) positions.set(node, { x: node.scrollLeft, y: node.scrollTop });
    for (const node of [document.documentElement, document.body]) positions.set(node, { x: node.scrollLeft, y: node.scrollTop });
    scrollPositions.current = positions;
  }, [request]);
  React.useEffect(() => {
    const outside = (event: Event) => { if (!(event.target instanceof Node) || !root.current?.contains(event.target)) close(); };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return;
      const node = event.target instanceof Element ? event.target : document.scrollingElement;
      const previous = node && scrollPositions.current.get(node);
      // Revealing a panel or virtualized card can queue a scroll event before
      // this menu exists. Only the source’s scroll ancestors move its anchor;
      // unrelated panes can also scroll while a sidebar finishes resizing.
      // User wheel/pointer interactions in any pane dismiss separately.
      if (!node || !previous || node.scrollLeft === previous.x && node.scrollTop === previous.y) return;
      close();
    };
    const dismiss = () => close();
    document.addEventListener('pointerdown', outside, true); document.addEventListener('scroll', scroll, true); document.addEventListener('wheel', outside, true);
    window.addEventListener('resize', dismiss); window.addEventListener('blur', dismiss);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', scroll, true); document.removeEventListener('wheel', outside, true); window.removeEventListener('resize', dismiss); window.removeEventListener('blur', dismiss); };
  }, [close]);
  const activate = (action: ContextAction) => {
    if (action.disabled) return;
    close(true);
    try { Promise.resolve(action.run()).catch(cause => onError(cause instanceof Error ? cause.message : 'Could not complete this action.')); }
    catch (cause) { onError(cause instanceof Error ? cause.message : 'Could not complete this action.'); }
  };
  return createPortal(<div ref={root} data-context-menu role="menu" aria-label={request.label} className="context-menu" style={{ left: point.x, top: point.y }}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
    onKeyDown={event => {
      event.stopPropagation();
      const items = Array.from(root.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      let next = index;
      if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
      if (event.key === 'Tab') { close(true); return; }
      if (event.key === 'ArrowDown') next = (index + 1) % items.length;
      else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = items.length - 1;
      else if (event.key.length === 1 && event.key !== ' ' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const now = Date.now(), previous = typeahead.current;
        const text = (now - previous.time < 700 ? previous.text : '') + event.key.toLocaleLowerCase();
        typeahead.current = { text, time: now };
        const match = [...items.slice(index + 1), ...items.slice(0, index + 1)].find(item => item.dataset.label?.toLocaleLowerCase().startsWith(text));
        if (match) next = items.indexOf(match);
      } else return;
      event.preventDefault(); items[next]?.focus({ preventScroll: true });
    }}>
    {request.heading && <div className="context-menu__heading">{request.heading}</div>}
    {request.actions.map(action => <React.Fragment key={action.id}>
      {action.separator && <div role="separator" className="context-menu__separator" />}
      <button type="button" role="menuitem" tabIndex={-1} aria-label={action.label} aria-disabled={action.disabled || undefined} data-label={action.label}
        aria-describedby={action.description ? `context-action-${action.id}` : undefined} onClick={() => activate(action)}>
        <span>{action.label}</span>{action.description && <small id={`context-action-${action.id}`}>{action.description}</small>}
      </button>
    </React.Fragment>)}
  </div>, document.body);
}
