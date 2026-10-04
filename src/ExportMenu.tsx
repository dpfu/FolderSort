import * as React from 'react';
import { Download } from 'lucide-react';
import './export-menu.css';

/** Native disclosure with normal tab navigation and focus restoration. */
export default function ExportMenu({ label, compact, light, children }: {
  label: string; compact?: boolean; light?: boolean; children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  React.useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if (ref.current?.open && event.target instanceof Node && !ref.current.contains(event.target)) ref.current.open = false;
    };
    document.addEventListener('click', dismiss);
    return () => document.removeEventListener('click', dismiss);
  }, []);
  return <details ref={ref} className={`export-menu${compact ? ' export-menu--compact' : ''}${light ? ' export-menu--light' : ''}`}
    onKeyDown={event => {
      if (event.key === 'Escape' && ref.current?.open) {
        event.preventDefault(); event.stopPropagation(); ref.current.open = false;
        ref.current.querySelector('summary')?.focus();
      }
    }} onClick={event => {
      if (event.target instanceof Element && event.target.closest('button') && ref.current) {
        ref.current.open = false; ref.current.querySelector('summary')?.focus();
      }
    }}>
    <summary aria-label={label} title={label}><Download size={17} /><span>{label}</span></summary>
    <div className="export-menu__panel" aria-label={`${label} options`}>{children}</div>
  </details>;
}
