import * as React from 'react';

/** Browser modal semantics: focus containment, Escape and restoration on close. */
export default function Modal({ label, className, onClose, onKeyDown, children }: {
  label: string; className: string; onClose: () => void; onKeyDown?: React.KeyboardEventHandler<HTMLDialogElement>; children: React.ReactNode;
}) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  React.useLayoutEffect(() => {
    const node = dialog.current!;
    node.showModal();
    node.querySelector<HTMLElement>('[data-modal-autofocus]')?.focus();
    return () => node.close();
  }, []);
  return <dialog ref={dialog} aria-label={label} className={className}
    onKeyDown={event => {
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex="0"]')].filter(node => node.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
      }
      onKeyDown?.(event);
    }}
    onCancel={event => { event.preventDefault(); onClose(); }}>{children}</dialog>;
}
