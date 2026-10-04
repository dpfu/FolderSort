import * as React from 'react';
import { SlidersHorizontal } from 'lucide-react';

/** A compact, keyboard-accessible home for occasional board actions. */
export default function BoardTools({ children }: { children: React.ReactNode }) {
  const details = React.useRef<HTMLDetailsElement>(null);
  React.useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if (details.current?.open && event.target instanceof Node && !details.current.contains(event.target)) details.current.open = false;
    };
    document.addEventListener('click', dismiss);
    return () => document.removeEventListener('click', dismiss);
  }, []);
  return <details ref={details} className="board-tools" onKeyDown={event => {
    if (event.key === 'Escape' && details.current?.open) {
      event.preventDefault(); event.stopPropagation(); details.current.open = false;
      details.current.querySelector('summary')?.focus();
    }
  }} onClick={event => {
    if (event.target instanceof Element && event.target.closest('[data-close-tools]') && details.current) {
      details.current.open = false; details.current.querySelector('summary')?.focus();
    }
  }}>
    <summary aria-label="Board tools" title="Similarity, return images to the pile, and export"><SlidersHorizontal size={18} /><span>Tools</span></summary>
    <div className="board-tools__panel" aria-label="Board actions">{children}</div>
  </details>;
}
