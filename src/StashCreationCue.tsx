import * as React from 'react';
import { Check } from 'lucide-react';
import { STASH_HOLD_MS } from './stashBoard';
import './stash-creation-cue.css';

/** One compositor-driven fill per hold; a new target remounts the cue. */
const StashCreationCue = React.forwardRef<HTMLDivElement, {
  ready: boolean; position: { x: number; y: number }; urls: Array<string | undefined>; count: number;
}>(({ ready, position, urls, count }, ref) => <div ref={ref} className={`stash-group-preview${ready ? ' is-ready' : ''}`}
  style={{ left: position.x, top: position.y, '--stash-hold-duration': `${STASH_HOLD_MS}ms` } as React.CSSProperties}
  role="status" aria-label="Create stash" data-ready={ready}>
  <span className="stash-group-preview__fill" aria-hidden="true" />
  <span className="stash-group-preview__photos" aria-hidden="true">
    {urls.map((src, index) => <span key={index} className="stash-group-preview__photo">{src && <img src={src} alt="" draggable={false} />}</span>)}
    {count > 2 && <span className="stash-group-preview__count">{count}</span>}
    <span className="stash-group-preview__check"><Check size={11} /></span>
  </span>
  <strong>Create stash</strong>
  <span className="srOnly">{count} images{ready ? ' · Ready to create stash' : ''}</span>
</div>);
export default StashCreationCue;
