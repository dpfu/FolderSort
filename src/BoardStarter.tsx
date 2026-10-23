import * as React from 'react';
import { ArrowRight, Image as ImageIcon, Minus, Plus, X } from 'lucide-react';
import { motion, useIsPresent, useReducedMotion } from 'framer-motion';
import { clampBatch, MAX_RANDOM_BATCH } from './useRootIntake';
import { useThumbnailUrls } from './useThumbnailUrls';
import type { ImageThumbnailCache } from './imageThumbnails';
import './board-starter.css';

export function BatchCountPicker({ count, available, onChange, compact = false }: {
  count: number; available: number; onChange: (count: number) => void; compact?: boolean;
}) {
  const value = clampBatch(count, available), max = Math.min(MAX_RANDOM_BATCH, available);
  return <div className={`batch-count${compact ? ' is-compact' : ''}`} role="group" aria-label="Random image batch size">
    <button type="button" aria-label="Fewer random images" disabled={value <= 1} onClick={() => onChange(value - 1)}><Minus size={14} /></button>
    <input aria-label="Number of random images" type="number" min={1} max={max} value={value}
      onChange={event => onChange(clampBatch(event.currentTarget.valueAsNumber, available))} />
    <button type="button" aria-label="More random images" disabled={value >= max} onClick={() => onChange(value + 1)}><Plus size={14} /></button>
  </div>;
}

export default function BoardStarter({ count, available, previewIds, thumbnails, busy, onCount, onStart, onDismiss }: {
  count: number; available: number; previewIds: string[]; thumbnails: ImageThumbnailCache; busy: boolean;
  onCount: (count: number) => void; onStart: (origin: DOMRect) => void; onDismiss: () => void;
}) {
  const [starting, setStarting] = React.useState(false);
  const started = React.useRef(false);
  const reduce = useReducedMotion();
  const present = useIsPresent();
  useThumbnailUrls(thumbnails, previewIds);
  const urls = previewIds.map(id => thumbnails.urls.get(id));
  const amount = clampBatch(count, available);
  return <motion.div className={`board-starter${starting ? ' is-starting' : ''}`} role="region" aria-label="Start with random images"
    aria-hidden={!present} style={!present ? { pointerEvents: 'none' } : undefined}
    initial={reduce ? false : { opacity: 0, scale: .98, x: '-50%', y: '-50%' }}
    animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }} exit={{ opacity: 0, scale: .94 }} transition={{ duration: reduce ? 0 : .14 }}
    onKeyDown={event => { if (event.key === 'Escape' && !starting) { event.stopPropagation(); onDismiss(); } }}>
    <button type="button" className="board-starter__skip" aria-label="Skip starter" title="Browse images instead" disabled={starting} onClick={onDismiss}><X size={16} /></button>
    <div className="board-starter__fan" aria-hidden="true">
      {urls.slice(0, Math.min(3, amount)).map((src, index, cards) => <span key={index} style={{ '--fan-offset': index - (cards.length - 1) / 2 } as React.CSSProperties}>
        {src ? <img src={src} alt="" draggable={false} /> : <ImageIcon size={22} />}
      </span>)}
    </div>
    <form onSubmit={event => {
      event.preventDefault(); if (started.current || busy || !available) return;
      started.current = true; setStarting(true); onStart(event.currentTarget.getBoundingClientRect());
    }}>
      <h2>Let’s start with</h2>
      <div className="board-starter__choice"><BatchCountPicker count={count} available={available} onChange={onCount} /><span>random {amount === 1 ? 'image' : 'images'}</span></div>
      <button type="submit" className="board-starter__start" disabled={busy || starting || !available} autoFocus>
        Add {amount} {amount === 1 ? 'image' : 'images'}<ArrowRight size={17} />
      </button>
    </form>
  </motion.div>;
}
