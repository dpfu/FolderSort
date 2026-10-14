import { Sparkles } from 'lucide-react';
import { useContentIndex } from './ContentIndex';
import './content-index.css';

/** A quiet progress indicator in the existing menu bar; opens the full stats. */
export default function ContentIndexBadge({ enabled, onOpen }: { enabled: boolean; onOpen: () => void }) {
  const { progress } = useContentIndex();
  if (!enabled) return null;
  const { phase, done, total, failed, percent } = progress;
  const label = phase === 'loading' ? `Content index: loading model${percent === undefined ? '' : `, ${percent}%`}`
    : phase === 'error' ? 'Content index: needs attention' : `Content index: ${done.toLocaleString()} of ${total.toLocaleString()} indexed${phase === 'paused' ? ', paused' : ''}`;
  const completion = phase === 'loading' ? percent || 0 : total ? (done + failed) / total * 100 : 0;
  return <button type="button" className={`content-index-badge${phase === 'error' ? ' has-error' : ''}`} aria-label={label} title={`${label} · Project settings`} onClick={onOpen}>
    <span style={{ background: `conic-gradient(var(--accent) ${completion}%, var(--line) 0)` }}><Sparkles size={15} aria-hidden="true" /></span>
  </button>;
}
