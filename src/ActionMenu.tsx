import * as React from 'react';
import { actionIcons, type ActionIcon } from './UiActions';

/** All action disclosures share dismissal, keyboard and focus behaviour. */
export default function ActionMenu({ label, icon = 'more', trigger, className = '', children, align = 'right', onOpenChange, autoOpenRequest }: {
  label: string; icon?: ActionIcon; trigger?: React.ReactNode; className?: string; children: React.ReactNode;
  align?: 'left' | 'right'; onOpenChange?: (open: boolean) => void; autoOpenRequest?: string;
}) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = React.useState(false);
  const Icon = actionIcons[icon];
  const close = () => { if (ref.current) ref.current.open = false; ref.current?.querySelector('summary')?.focus({ preventScroll: true }); };
  React.useLayoutEffect(() => {
    const menu = ref.current;
    // Replacing a submenu removes its initiating button. Keep keyboard focus
    // inside the disclosure so Escape and the next Tab still work.
    if (menu?.open && !menu.contains(document.activeElement)) {
      menu.querySelector<HTMLElement>('[data-menu-autofocus], .action-menu__panel button')?.focus({ preventScroll: true });
    }
  }, [open, children]);
  React.useEffect(() => { if (autoOpenRequest && ref.current) ref.current.open = true; }, [autoOpenRequest]);
  React.useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (ref.current?.open && event.target instanceof Node && !ref.current.contains(event.target)) ref.current.open = false;
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  return <details ref={ref} className={`action-menu action-menu--${align} ${className}`}
    onToggle={event => { const next = event.currentTarget.open; setOpen(next); onOpenChange?.(next); }}
    onKeyDown={event => {
      if (event.key === 'Escape' && ref.current?.open) { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') requestAnimationFrame(() => {
        if (ref.current?.open && !ref.current.contains(document.activeElement)) ref.current.open = false;
      });
    }} onClick={event => { if (event.target instanceof Element && event.target.closest('[data-close-menu]')) close(); }}>
    <summary role="button" aria-label={label} title={label} aria-expanded={open}>{trigger || <Icon size={20} aria-hidden="true" />}</summary>
    <div className="action-menu__panel" role="group" aria-label={`${label} actions`}>{children}</div>
  </details>;
}
