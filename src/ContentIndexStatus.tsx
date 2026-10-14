import { Pause, Play, RotateCw } from 'lucide-react';
import { useContentIndex } from './ContentIndex';
import './content-index.css';

export default function ContentIndexStatus({ enabled, compact = false }: { enabled: boolean; compact?: boolean }) {
  const index = useContentIndex(), { phase, done, total, failed, percent, error } = index.progress;
  const running = phase === 'loading' || phase === 'indexing';
  const remaining = Math.max(0, total - done - failed);
  const status = !enabled ? `Off · ${done.toLocaleString()} saved` : phase === 'loading' ? `Loading CLIP${percent === undefined ? '…' : ` · ${percent}%`}`
    : phase === 'rebuilding' ? 'Rebuilding index…' : phase === 'error' ? error
    : `CLIP ${done.toLocaleString()} / ${total.toLocaleString()} indexed${phase === 'paused' ? ' · paused' : ''}`;
  return <section className={`content-index${compact ? ' content-index--compact' : ''}`} aria-label="CLIP indexing">
    <span className="content-index__status" role="status">{status}</span>
    {!compact && <small>{remaining.toLocaleString()} waiting{failed > 0 ? ` · ${failed.toLocaleString()} skipped` : ''}{done > 0 ? ' · saved in this browser' : ''}</small>}
    {enabled && total > 0 && <>
      {running && <progress aria-label={phase === 'loading' ? 'CLIP download progress' : 'CLIP indexing progress'} max={phase === 'loading' ? 100 : total} value={phase === 'loading' ? percent : done + failed} />}
      <div className="content-index__actions">
        {running && <button type="button" aria-label="Pause CLIP indexing" onClick={index.pause}><Pause size={14} />Pause</button>}
        {['paused', 'error'].includes(phase) && <button type="button" aria-label={phase === 'error' ? 'Retry CLIP indexing' : 'Resume CLIP indexing'} onClick={() => void index.start().catch(() => {})}><Play size={14} />{phase === 'error' ? 'Retry' : 'Resume'}</button>}
        {phase === 'ready' && failed > 0 && <button type="button" aria-label="Retry skipped CLIP images" onClick={() => void index.retrySkipped().catch(() => {})}><RotateCw size={14} />Retry skipped</button>}
        {!compact && done > 0 && <button type="button" aria-label="Rebuild CLIP index" title="Recompute content features for all project images" disabled={running || phase === 'rebuilding'} onClick={() => void index.rebuild().catch(() => {})}><RotateCw size={14} />Rebuild index</button>}
      </div>
    </>}
  </section>;
}
