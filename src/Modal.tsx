import * as React from 'react';

/** Browser modal semantics: focus containment, Escape and restoration on close. */
export default function Modal({ label, className, onClose, onKeyDown, children }: {
  label: string; className: string; onClose: () => void; onKeyDown?: React.KeyboardEventHandler<HTMLDialogElement>; children: React.ReactNode;
}) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  React.useLayoutEffect(() => {
    const node = dialog.current!;
    const opener = document.activeElement as HTMLElement | null;
    const siblings = [...node.parentElement!.children].filter(element => element !== node) as HTMLElement[];
    const previous = siblings.map(element => ({ element, inert: element.inert, hidden: element.getAttribute('aria-hidden') }));
    siblings.forEach(element => { element.inert = true; element.setAttribute('aria-hidden', 'true'); });
    node.showModal();
    node.querySelector<HTMLElement>('[data-modal-autofocus]')?.focus();
    return () => {
      node.close();
      previous.forEach(({ element, inert, hidden }) => { element.inert = inert; if (hidden === null) element.removeAttribute('aria-hidden'); else element.setAttribute('aria-hidden', hidden); });
      if (opener?.isConnected && !(opener instanceof HTMLButtonElement && opener.disabled)) opener.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} aria-label={label} className={className}
    onKeyDown={event => {
      if (event.target instanceof Element && event.target.closest('dialog') !== event.currentTarget) return;
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), summary, input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex="0"]')].filter(node => node.getClientRects().length > 0 && !node.closest('details:not([open]) .action-menu__panel'));
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
      }
      onKeyDown?.(event);
    }}
    onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); onClose(); }}>{children}</dialog>;
}
