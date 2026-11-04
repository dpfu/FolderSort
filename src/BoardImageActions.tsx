import type { ReactNode } from 'react';
import { Minus } from 'lucide-react';

/** Paired with similarity's +, removal returns this image to the waiting queue. */
export default function BoardImageActions({ children, label, disabled, onRemove }: {
  children: ReactNode; label: string; disabled: boolean; onRemove: () => void;
}) {
  return <div className="board-image-actions" role="group" aria-label="Selected image actions">
    {children}
    <button type="button" className="board-image-remove" aria-label={label} title={`${label} · Return to the unsorted waiting queue`}
      disabled={disabled} onClick={event => { event.stopPropagation(); onRemove(); }}>
      <Minus size={22} aria-hidden="true" />
    </button>
  </div>;
}
