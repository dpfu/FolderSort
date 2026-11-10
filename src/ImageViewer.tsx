import * as React from 'react';
import { ChevronLeft, ChevronRight, Check, Square, Trash2, Info, FolderTree } from 'lucide-react';
import { useOriginalImage } from './useOriginalImage';
import { useAsyncTask } from './useAsyncTask';
import { type LibraryCategory, type LibraryImage } from './libraryStore';
import { displayReviewKey, reviewDestinationKey, reviewKey, updateImageReviewPreferences, useImageReviewPreferences } from './imageReviewPreferences';
import type { ProjectAction } from './useActionHistory';
import ImageReviewFolders from './ImageReviewFolders';
import Modal from './Modal';
import MenuBar from './MenuBar';
import ActionMenu from './ActionMenu';
import { ActionButton } from './UiActions';
import UndoControl, { type UndoView } from './UndoControl';
import './image-review.css';

type Props = {
  image: LibraryImage; images: LibraryImage[]; categories: LibraryCategory[]; index: number; total: number;
  onMove: (direction: number) => void; onAssign: (categoryId: string | null) => Promise<void>;
  onCreateAndAssign: (name: string) => Promise<LibraryCategory>; onClose: () => void; onRemove?: () => void;
  onRememberAction: (action: ProjectAction) => unknown;
  busy: boolean; undo?: UndoView; selection?: { marked: boolean; onMark: () => void };
  label?: string; closeLabel?: string;
};

/** One original-image reviewer, using the same durable image moves as the board. */
export default function ImageViewer(props: Props) {
  const { image, images, categories, index, total, onAssign, onCreateAndAssign, onClose, onRemove, busy, undo, selection, label, closeLabel = 'Close image' } = props;
  const { url, failed, fail } = useOriginalImage(image.id);
  const [preferences, setPreferences] = useImageReviewPreferences(image.projectId);
  const latestPreferences = React.useRef(preferences); latestPreferences.current = preferences;
  const { task, running, state: { error } } = useAsyncTask();
  const [message, setMessage] = React.useState(''), [feedback, setFeedback] = React.useState<string>();
  const latest = React.useRef(props); latest.current = props;
  const panelButton = React.useRef<HTMLButtonElement>(null);
  const locked = busy || running;
  const location = image.categoryId ? categories.find(folder => folder.id === image.categoryId)?.name || 'Folder' : image.rootOnBoard === false ? 'Waiting' : 'Staging';
  React.useEffect(() => { task.cancel(); setFeedback(undefined); }, [image.id, task]);
  React.useLayoutEffect(() => {
    // Native disabled controls can return focus to body during a save/Undo.
    // Keep consecutive shortcuts scoped to the still-open reviewer.
    if (!locked && document.hasFocus() && document.activeElement === document.body) document.querySelector<HTMLDialogElement>('.image-review[open]')?.focus({ preventScroll: true });
  }, [locked, image.id]);
  const navigate = (direction: number) => { if (!locked) { setMessage(''); props.onMove(direction); } };
  const reviewUndo = undo ? { ...undo, busy: undo.busy || locked, onUndo: () => { setMessage(''); undo.onUndo(); } } : undefined;
  const performMove = async (action: () => Promise<{ id: string | null; name: string }>) => {
    if (busy) return false;
    const ticket = task.begin(); if (!ticket) return false;
    const source = image.id;
    try {
      const destination = await action();
      if (!task.owns(ticket) || latest.current.image.id !== source) return false;
      setMessage(`Moved to ${destination.name}`); setFeedback(reviewDestinationKey(destination.id));
      if (latestPreferences.current.nextAfterMove && index < total - 1) {
        // Confirm only after the durable write, then advance within the captured review queue.
        await new Promise(resolve => window.setTimeout(resolve, 180));
        if (!task.owns(ticket) || latest.current.image.id !== source) return false;
        task.complete(ticket); if (latestPreferences.current.nextAfterMove) latest.current.onMove(1);
      } else task.complete(ticket);
      return true;
    } catch (cause) { task.fail(ticket, cause); return false; }
  };
  const assign = (id: string | null) => {
    if (image.categoryId === id && (id !== null || image.rootOnBoard !== false)) return;
    void performMove(async () => { await onAssign(id); return { id, name: id === null ? 'Staging' : categories.find(folder => folder.id === id)?.name || 'Folder' }; });
  };
  const setShortcut = (destination: string, key?: string) => {
    const previous = preferences.shortcuts[destination];
    if (previous === key) return;
    const update = (value?: string) => updateImageReviewPreferences(image.projectId, current => {
      const shortcuts = { ...current.shortcuts }; delete shortcuts[destination];
      // A deleted folder must not reclaim a reused key when preferences reload.
      if (value) { for (const [id, bound] of Object.entries(shortcuts)) if (bound === value) delete shortcuts[id]; shortcuts[destination] = value; }
      return { ...current, shortcuts };
    });
    update(key);
    const name = destination === 'staging' ? 'Staging' : categories.find(folder => reviewDestinationKey(folder.id) === destination)?.name || 'folder';
    setMessage(key ? `${displayReviewKey(key)} assigned to ${name}` : `Shortcut cleared for ${name}`);
    props.onRememberAction({ projectId: image.projectId, kind: 'review-shortcut', message: key ? `Set shortcut ${displayReviewKey(key)} for ${name}.` : `Cleared shortcut for ${name}.`,
      label: 'Undo shortcut change', detail: 'Restores the previous keyboard shortcut.', restored: 'Previous shortcut restored.', restore: async () => update(previous) });
  };
  const togglePanel = () => {
    setPreferences(previous => ({ ...previous, open: !previous.open }));
    requestAnimationFrame(() => (preferences.open ? panelButton.current : document.querySelector<HTMLButtonElement>('.image-review-folders header button'))?.focus());
  };
  return <Modal className={`library-viewer image-preview image-review${preferences.open ? ' has-folders' : ''}`} label={label || image.path} onClose={onClose}
    onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.target instanceof Element && event.target.closest('input:not([type="checkbox"]), select, textarea, [contenteditable="true"], details[open]')) return;
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault(); event.stopPropagation(); if (reviewUndo && !reviewUndo.busy) reviewUndo.onUndo(); return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = reviewKey(event.key);
      if (key) {
        const binding = Object.entries(preferences.shortcuts).find(([destination, value]) => value === key && (destination === 'staging' || categories.some(folder => reviewDestinationKey(folder.id) === destination)));
        if (binding) { event.preventDefault(); event.stopPropagation(); if (!locked && !event.repeat) assign(binding[0] === 'staging' ? null : binding[0].slice('folder:'.length)); return; }
      }
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !(event.target instanceof Element && event.target.closest('.image-review-folders'))) {
        event.preventDefault(); event.stopPropagation(); navigate(event.key === 'ArrowLeft' ? -1 : 1);
      }
    }}>
    <MenuBar label="Image menu bar" context={<div className="image-review__title"><strong title={image.path}>{image.path.split('/').at(-1)}</strong><small title={location}>{location}</small></div>}>
      <UndoControl action={reviewUndo} /><ActionButton icon="close" label={closeLabel} autoFocus onClick={onClose} />
    </MenuBar>
    <div className="image-review__layout">
      <main className="image-review__main" aria-label="Current image">
        <div className="library-viewer__image">{url && !failed ? <img src={url} alt={image.path} onError={fail} /> : <p>{failed ? 'Preview unavailable in this browser.' : 'Loading original…'}</p>}</div>
        <footer className="image-review__footer">
          <div className="image-preview__nav"><button type="button" aria-label="Previous image" title="Previous image · ←" aria-disabled={index <= 0 || locked} onClick={() => navigate(-1)}><ChevronLeft size={21} /></button><span>{index + 1} / {total}</span><button type="button" aria-label="Next image" title="Next image · →" aria-disabled={index >= total - 1 || locked} onClick={() => navigate(1)}><ChevronRight size={21} /></button></div>
          <label className="image-review__next"><input type="checkbox" checked={preferences.nextAfterMove} onChange={event => setPreferences(previous => ({ ...previous, nextAfterMove: event.target.checked }))} /><span>Next after move</span></label>
          {selection && <button type="button" className="image-review__mark" aria-label="Select for board" aria-pressed={selection.marked} onClick={selection.onMark}>{selection.marked ? <Check size={19} /> : <Square size={19} />}</button>}
          {!preferences.open && <button ref={panelButton} type="button" className="image-review__show-folders" aria-label="Show folders" title="Show folders" aria-expanded={false} onClick={togglePanel}><FolderTree size={19} /><span>Folders</span></button>}
          <ActionMenu label="Image actions" className="image-review__more">
            <h3><Info size={15} /> Image</h3><p>{image.path}<br />{(image.size / 1024).toFixed(0)} KiB</p>
            {onRemove && <button type="button" className="action-menu__item" data-close-menu aria-label="Delete image from project" title="Keep the original file; Undo restores this project image" disabled={locked} onClick={onRemove}><Trash2 size={18} /><span>Delete from project</span></button>}
          </ActionMenu>
        </footer>
      </main>
      {preferences.open && <ImageReviewFolders image={image} images={images} categories={categories} busy={locked} preferences={preferences} onPreferences={setPreferences}
        onAssign={assign} onHide={togglePanel} onShortcut={setShortcut} feedback={feedback}
        onCreate={name => performMove(async () => { const folder = await onCreateAndAssign(name); return { id: folder.id, name: folder.name }; })} />}
    </div>
    <div className={`image-review__status${error ? ' has-error' : ''}`} role={error ? 'alert' : 'status'} aria-live="polite" aria-atomic="true">{error || message}</div>
  </Modal>;
}
