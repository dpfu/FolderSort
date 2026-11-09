import { HintSession } from './hintSession';
import * as React from 'react';
import { ArrowUpRight, Info } from 'lucide-react';
import './context-help.css';

export type HelpReference = { label: string; href: string };

/** Keep help in its control's focus order; the top layer escapes scroll clipping. */
export default function InfoHint({ label, text, reference, trigger, className = '' }: {
  label: string; text: string; reference?: HelpReference;
  trigger?: React.ReactElement<React.HTMLAttributes<HTMLElement>>; className?: string;
}) {
  const id = React.useId();
  const root = React.useRef<HTMLDivElement>(null), panel = React.useRef<HTMLDivElement>(null);
  const [hint] = React.useState(() => new HintSession(() => !!root.current?.contains(document.activeElement)));
  React.useSyncExternalStore(hint.subscribe, hint.snapshot);
  const open = hint.open;
  const anchor = () => root.current?.querySelector<HTMLElement>('button, summary');
  const close = (restoreFocus = false) => {
    if (restoreFocus && panel.current?.contains(document.activeElement)) { hint.suppressNextFocus(); anchor()?.focus({ preventScroll: true }); }
    hint.close();
  };
  React.useEffect(() => () => hint.dispose(), [hint]);
  React.useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const node = panel.current;
    if (typeof node.showPopover === 'function') node.showPopover();
    else node.dataset.fallback = 'true';
    const place = () => {
      const button = anchor();
      if (!button) return;
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft || 0, topEdge = viewport?.offsetTop || 0;
      const rightEdge = leftEdge + (viewport?.width || window.innerWidth);
      const bottomEdge = topEdge + (viewport?.height || window.innerHeight);
      const rect = button.getBoundingClientRect(), box = node.getBoundingClientRect();
      const left = Math.max(leftEdge + 12, Math.min(rightEdge - box.width - 12, rect.right - box.width));
      const above = rect.bottom + box.height + 10 > bottomEdge - 12 && rect.top - box.height - 10 >= topEdge + 12;
      const top = above ? rect.top - box.height - 10 : rect.bottom + 10;
      node.dataset.side = above ? 'above' : 'below';
      node.style.left = left + 'px';
      node.style.top = Math.max(topEdge + 12, Math.min(bottomEdge - box.height - 12, top)) + 'px';
      node.style.setProperty('--help-tip', Math.max(12, Math.min(box.width - 12, rect.left + rect.width / 2 - left)) + 'px');
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(node);
    const button = anchor(); if (button) observer.observe(button);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      if (typeof node.hidePopover === 'function' && node.matches(':popover-open')) node.hidePopover();
    };
  }, [open, text, reference?.label]);
  React.useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      // Hover help must also dismiss when keyboard focus is still on the select.
      if (event.key === 'Escape' && event.target instanceof Node && !root.current?.contains(event.target)) {
        event.preventDefault(); event.stopPropagation(); close();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);

  return <div ref={root} className={'context-help' + (trigger ? ' context-help--custom' : '') + ' ' + className}
    onPointerEnter={event => {
      if (event.pointerType === 'touch') return;
      hint.enter(true);
    }}
    onPointerLeave={() => hint.leave()}
    onFocusCapture={() => {
      hint.focus(!!panel.current?.contains(document.activeElement));
    }}
    onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { hint.blur(); }
    }}
    onKeyDown={event => {
      if (event.key === 'Tab' && !event.shiftKey && open && reference && event.target === anchor()) {
        // Keep the reference reachable when a browser's Tab setting skips links.
        event.preventDefault(); panel.current?.querySelector('a')?.focus();
      }
      if (event.key === 'Escape' && open) {
        // Passive action hints must not consume their parent dialog's Escape action.
        if (!trigger || reference) { event.preventDefault(); event.stopPropagation(); }
        close(true);
      }
    }}
    onClick={() => { if (trigger) close(); }}>
    {trigger ? React.cloneElement(trigger, { 'aria-describedby': id + '-text' }) : <button type="button" className="context-help__trigger"
      aria-label={label} aria-describedby={id + '-text'} aria-haspopup={reference ? 'dialog' : undefined}
      aria-expanded={reference ? open : undefined} aria-controls={reference ? id : undefined}
      onPointerDown={event => { event.stopPropagation(); hint.press(); }}
      onPointerCancel={() => hint.cancelPress()}
      onClick={event => {
        event.stopPropagation(); event.currentTarget.focus({ preventScroll: true });
        hint.toggle(event.detail > 0 || !!(event.nativeEvent as PointerEvent).pointerType);
      }}>
      <Info size={16} aria-hidden="true" />
    </button>}
    <div ref={panel} id={id} {...{ popover: 'manual' }} hidden={!open} className="context-help__panel"
      role={reference ? 'dialog' : 'tooltip'} aria-modal={reference ? false : undefined} aria-label={reference ? label : undefined}
      onPointerEnter={event => {
        if (event.pointerType !== 'touch') { hint.enter(); }
      }}
      onPointerLeave={() => hint.leave()}
      onClick={event => event.stopPropagation()}>
      <p id={id + '-text'} className="context-help__text">{text}</p>
      {reference && <div className="context-help__reference"><span>Uses</span>
        <a href={reference.href} target="_blank" rel="noopener noreferrer" aria-label={reference.label + ' reference (opens in a new tab)'}>
          {reference.label}<ArrowUpRight size={10} aria-hidden="true" />
        </a>
      </div>}
    </div>
  </div>;
}
