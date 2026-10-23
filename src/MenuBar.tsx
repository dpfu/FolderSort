import type { ReactNode } from 'react';
import './menu-bar.css';

export default function MenuBar({ label, leading, context, tools, children, light = false }: {
  label: string; leading?: ReactNode; context: ReactNode; tools?: ReactNode; children?: ReactNode; light?: boolean;
}) {
  return <header className={`app-bar${light ? ' app-bar--light' : ''}`} role="toolbar" aria-label={label}>
    {leading && <div className="app-bar__leading">{leading}</div>}
    <div className="app-bar__context">{context}</div>
    {tools && <div className="app-bar__tools">{tools}</div>}
    <div className="app-bar__actions">{children}</div>
  </header>;
}
