import * as React from 'react';
import { ChevronLeft, ChevronRight, Check, Square, Trash2, Info } from 'lucide-react';
import { getImageBlob, type LibraryCategory, type LibraryImage } from './libraryStore';
import Modal from './Modal';
import MenuBar from './MenuBar';
import ActionMenu from './ActionMenu';
import { ActionButton } from './UiActions';
import UndoControl, { type UndoView } from './UndoControl';
import StashPicker from './StashPicker';
import './image-review.css';

type Props = {
  image: LibraryImage; images: LibraryImage[]; categories: LibraryCategory[]; index: number; total: number;
  onMove: (direction: number) => void; onAssign: (categoryId: string | null) => Promise<void>;
  onCreateAndAssign: (name: string) => Promise<void>; onClose: () => void; onRemove?: () => void;
  busy: boolean; undo?: UndoView; selection?: { marked: boolean; onMark: () => void };
  label?: string; closeLabel?: string;
};

/** One original-image reviewer for the board and collection browser. */
export default function ImageViewer({ image, images, categories, index, total, onMove, onAssign, onCreateAndAssign, onClose, onRemove, busy, undo, selection, label, closeLabel = 'Close image' }: Props) {
  const [url, setUrl] = React.useState<string>();
  const [failed, setFailed] = React.useState(false);
  const [chooser, setChooser] = React.useState(false);
  React.useEffect(() => {
    let active = true, objectUrl: string | undefined;
    setUrl(undefined); setFailed(false);
    void getImageBlob(image.id).then(blob => {
      if (!active) return;
      if (blob) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
      else setFailed(true);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image.id]);
  const category = categories.find(category => category.id === image.categoryId);
  return <Modal className="library-viewer image-preview image-review" label={label || image.path} onClose={onClose}
    onKeyDown={event => {
      if (chooser || event.target instanceof Element && event.target.closest('input, select, textarea')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); event.stopPropagation();
        if (!busy) onMove(event.key === 'ArrowLeft' ? -1 : 1);
      }
    }}>
    <MenuBar label="Image menu bar" context={<div className="image-review__title"><strong title={image.path}>{image.path.split('/').at(-1)}</strong><small>{category?.name || 'Unsorted'}</small></div>}>
      <UndoControl action={undo} /><ActionButton icon="close" label={closeLabel} autoFocus onClick={onClose} />
    </MenuBar>
    <div className="library-viewer__image">{url && !failed ? <img src={url} alt={image.path} onError={() => setFailed(true)} /> : <p>{failed ? 'Preview unavailable in this browser.' : 'Loading original…'}</p>}</div>
    <footer className="image-review__footer">
      <div className="image-preview__nav"><button type="button" aria-label="Previous image" title="Previous image · ←" disabled={index <= 0 || busy} onClick={() => onMove(-1)}><ChevronLeft size={21} /></button><span>{index + 1} / {total}</span><button type="button" aria-label="Next image" title="Next image · →" disabled={index >= total - 1 || busy} onClick={() => onMove(1)}><ChevronRight size={21} /></button></div>
      {selection && <button type="button" className="image-review__mark" aria-label="Select for board" aria-pressed={selection.marked} onClick={selection.onMark}>{selection.marked ? <Check size={19} /> : <Square size={19} />}</button>}
      <ActionButton icon="moveToStash" label="Move image to stash" disabled={busy} onClick={() => setChooser(true)} />
      <ActionMenu label="Image actions" className="image-review__more">
        <h3><Info size={15} /> Image</h3><p>{image.path}<br />{(image.size / 1024).toFixed(0)} KiB</p>
        {onRemove && <button type="button" className="action-menu__item" data-close-menu aria-label="Delete image from project" title="Keep the original file; Undo restores this project image" disabled={busy} onClick={onRemove}><Trash2 size={18} /><span>Delete from project</span></button>}
      </ActionMenu>
    </footer>
    {chooser && <StashPicker images={images} categories={categories} selected={[image]} busy={busy} onClose={() => setChooser(false)} onChoose={onAssign} onCreate={onCreateAndAssign} />}
  </Modal>;
}
