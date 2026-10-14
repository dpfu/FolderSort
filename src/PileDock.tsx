import * as React from 'react';
import { ArrowDownUp, Check, ChevronDown, ChevronUp, GalleryVerticalEnd, Plus, RotateCcw, Shuffle } from 'lucide-react';
import { PileOrderOptions } from './PileOrderOptions';
import type { PileOrder } from './imageAnalysis';
import type { pileSizeGeometry } from './pileSizing';
import './pile-dock.css';
import ActionMenu from './ActionMenu';

type Props = {
  stash: string | undefined;
  count: number;
  total: number;
  batchSize: number;
  collapsed: boolean;
  disabled: boolean;
  preparing: boolean;
  order: PileOrder;
  reversed: boolean;
  feedback: string;
  geometry: ReturnType<typeof pileSizeGeometry>;
  contentId: string;
  onAdd: (origin: DOMRect) => void;
  onBatchSize: (size: number) => void;
  onToggle: () => void;
  onExplore: () => void;
  onBrowseProject: () => void;
  onOrder: (order: PileOrder) => void;
  onReverse: () => void;
  onShuffle: () => void;
  onHeight: (height: number) => void;
  onImageSize: (size: number) => void;
  onReset: () => void;
};

export default function PileDock(props: Props) {
  const { stash, count, total, batchSize, collapsed, disabled, preparing, order, reversed, feedback, geometry } = props;
  const closeOptions = (target: Element) => {
    const menu = target.closest('details');
    if (menu) { menu.open = false; menu.querySelector('summary')?.focus({ preventScroll: true }); }
  };
  const countId = React.useId();
  const orderId = React.useId();
  const number = Math.min(batchSize, count);
  const source = order === 'random' ? 'random' : 'next';
  const label = preparing ? 'Preparing images…' : !count ? 'Pile empty' : count < batchSize
    ? `Add remaining ${number}` : `Add ${source === 'next' ? 'next ' : ''}${number} ${source === 'random' ? 'random ' : ''}${number === 1 ? 'image' : 'images'}`;
  return <div className="pile-dock">
    <div className="pile-dock__identity">
      <button type="button" className="pile-dock__toggle" aria-label={collapsed ? 'Expand image pile' : 'Collapse image pile'}
        aria-expanded={!collapsed} aria-controls={props.contentId} title={collapsed ? 'Show the thumbnails' : 'Hide the thumbnails; keep adding images'} onClick={props.onToggle}>
        {collapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        <span className="pile-dock__compact-count" aria-hidden="true">{count.toLocaleString()}<small>in pile</small></span>
      </button>
      <div className="pile-dock__name"><strong title={stash}>{stash ? 'Stash pile' : 'Unsorted pile'}</strong>
        <span>{count.toLocaleString()} in pile · {total.toLocaleString()} {stash ? 'here' : 'unsorted'}</span></div>
    </div>
    <div className={`pile-dock__intake${feedback ? ' has-added' : ''}`} role="group" aria-label="Add images from pile">
      <button type="button" className="pile-dock__add" aria-label={label} disabled={disabled || preparing || !count}
        title={count ? `${label} from ${stash || 'Unsorted'} onto this board. Keep their stash assignments.` : total ? 'All images from this pile are on a board.' : 'This pile has no images.'}
        onClick={event => props.onAdd(event.currentTarget.getBoundingClientRect())}>
        <Plus size={23} />
      </button>
      <div className="pile-dock__count"><label htmlFor={countId} className="srOnly">Images per add</label>
        <select id={countId} aria-label="Images per add" title="Choose how many images to add; changing this does not add images" value={batchSize} onChange={event => props.onBatchSize(Number(event.target.value))}>
          {[1, 3, 5].map(size => <option key={size} value={size}>{size}</option>)}
        </select><ChevronDown size={13} aria-hidden="true" />
      </div>
      <span className="pile-dock__feedback" role="status" aria-live="polite" aria-atomic="true">{feedback && <><Check size={13} /><span className="srOnly">{feedback}</span></>}</span>
    </div>
    <div className="pile-dock__tools">
      <button type="button" className="sorting-workspace__pile-open pile-dock__explore" aria-label="Explore image pile" title="Explore the whole pile, mark images, and add them to the board" onClick={props.onExplore}>
        <GalleryVerticalEnd size={17} /><span>Explore pile</span>
      </button>
      <ActionMenu label="Pile options" icon="pileOptions" className="pile-options">
        <div className="pile-options__panel" role="region" aria-label="Pile configuration">
          <header><strong>Pile options</strong><small>{stash || 'Unsorted'} · {count.toLocaleString()} in pile</small></header>
          <div className="pile-options__order"><label htmlFor={orderId}>Order</label>
            <div><select id={orderId} aria-label="Pile order" title="The add button follows this order; random chooses a fresh batch" value={order} onChange={event => {
              if (event.target.value !== order) props.onOrder(event.target.value as PileOrder);
              closeOptions(event.currentTarget);
            }}><PileOrderOptions /></select>
              <button type="button" aria-label="Reverse pile order" title="Reverse order; missing dates and dimensions stay last" aria-pressed={reversed} disabled={order === 'random' || preparing} onClick={props.onReverse}><ArrowDownUp size={17} /></button></div>
          </div>
          <button type="button" disabled={count < 2} data-close-menu onClick={props.onShuffle}><Shuffle size={17} />Shuffle pile</button>
          <div className="pile-options__sizes">
            <label><span>Thumbnail size <output>{geometry.imageSize} px</output></span><input type="range" aria-label="Pile image size" min={72} max={geometry.maxImageSize} step={8} value={geometry.imageSize} onChange={event => props.onImageSize(Number(event.target.value))} /></label>
            <label><span>Pile height <output>{collapsed ? 'Collapsed' : `${geometry.paneHeight} px`}</output></span><input type="range" aria-label="Pile pane height" min={geometry.minHeight} max={geometry.maxHeight} value={geometry.expandedHeight} onChange={event => props.onHeight(Number(event.target.value))} /></label>
          </div>
          <button type="button" onClick={props.onReset}><RotateCcw size={15} />Reset size</button>
          {stash && <button type="button" className="pile-options__browse" data-close-menu onClick={props.onBrowseProject}>Browse project</button>}
        </div>
      </ActionMenu>
    </div>
  </div>;
}
