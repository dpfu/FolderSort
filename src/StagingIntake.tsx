import * as React from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import ActionMenu from './ActionMenu';
import { BatchCountPicker } from './BoardStarter';
import { clampBatch } from './useRootIntake';
import './staging-intake.css';

/** The board's intake stays available independently of browser size or selection. */
export default function StagingIntake({ count, available, totalWaiting, busy, onCount, onAdd, onReset }: {
  count: number; available: number; totalWaiting: number; busy: boolean;
  onCount: (count: number) => void; onAdd: (origin: DOMRect) => void; onReset: () => void;
}) {
  const amount = available ? clampBatch(count, available) : 0;
  const emptyLabel = totalWaiting ? 'No matching images' : 'No waiting images';
  const [pulse, setPulse] = React.useState(0);
  return <div className="staging-intake" role="group" aria-label="Add images to staging">
    <div className="staging-intake__split">
      <button type="button" className="staging-intake__add" aria-label={amount ? `Preview ${amount} random ${amount === 1 ? 'image' : 'images'}` : emptyLabel}
        title={available ? 'Preview random images matching the browser filters' : totalWaiting ? 'No waiting images match the browser filters' : 'All images are staged or in folders'}
        disabled={busy || !available} onClick={event => { onAdd(event.currentTarget.getBoundingClientRect()); setPulse(value => value + 1); }}>
        <Plus key={pulse} className="staging-intake__pulse" size={19} aria-hidden="true" /><span>{amount ? <>Preview {amount} random {amount === 1 ? 'image' : 'images'}</> : emptyLabel}</span>
      </button>
      <ActionMenu label="Random image batch size" align="right" trigger={<ChevronDown size={16} />}>
        <p>Random images per add</p>
        <BatchCountPicker compact count={count} available={Math.max(1, available)} onChange={onCount} />
      </ActionMenu>
    </div>
    {available ? <small>{available.toLocaleString()}{available !== totalWaiting ? ` of ${totalWaiting.toLocaleString()}` : ''} waiting</small>
      : totalWaiting > 0 ? <button type="button" className="staging-intake__reset" onClick={onReset}>Reset filters</button>
        : <small>Choose images in the browser</small>}
  </div>;
}
