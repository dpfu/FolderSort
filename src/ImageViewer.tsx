import * as React from 'react';
import { ChevronLeft, ChevronRight, Folder, Plus, Trash2, X } from 'lucide-react';
import { getImageBlob, type LibraryCategory, type LibraryImage } from './libraryStore';
import { categoryColor } from './categoryTree';
import Modal from './Modal';

/** Native modal keeps focus and shortcuts inside the original-image review. */
export default function ImageViewer({ image, categories, index, total, onMove, onAssign, onCreateAndAssign, onClose, onRemove }: {
  image: LibraryImage; categories: LibraryCategory[]; index: number; total: number;
  onMove: (direction: number) => void;
  onAssign: (categoryId: string | null) => void;
  onCreateAndAssign: (name: string) => Promise<void>;
  onClose: () => void; onRemove: () => void;
}) {
  const [url, setUrl] = React.useState<string>();
  const [failed, setFailed] = React.useState(false);
  const [newCategory, setNewCategory] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState('');
  React.useEffect(() => {
    let active = true, objectUrl: string | undefined;
    setUrl(undefined); setFailed(false); setCreateError('');
    void getImageBlob(image.id).then(blob => {
      if (!active) return;
      if (blob) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
      else setFailed(true);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image.id]);
  const category = categories.find(category => category.id === image.categoryId);
  return <Modal className="library-viewer image-preview" label={image.path} onClose={onClose}
    onKeyDown={event => {
      if (event.target instanceof Element && event.target.closest('input, select, textarea')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); event.stopPropagation();
        if (!creating) onMove(event.key === 'ArrowLeft' ? -1 : 1);
      }
    }}>
    <header className="library-viewer__header">
      <div><strong>{image.path.split('/').at(-1)}</strong><small>{image.path} · {(image.size / 1024).toFixed(0)} KiB</small></div>
      <button type="button" className="library-icon-button" autoFocus onClick={onClose} aria-label="Close image" title="Close image · Esc"><X size={21} /></button>
    </header>
    <div className="library-viewer__image">{url && !failed ? <img src={url} alt={image.path} onError={() => setFailed(true)} /> : <p>{failed ? 'This image cannot be previewed in this browser.' : 'Loading original…'}</p>}</div>
    <footer className="library-viewer__footer">
      <div className="library-viewer__review">
        <div className="image-preview__nav"><button type="button" aria-label="Previous image" title="Previous image · ←" disabled={index <= 0 || creating} onClick={() => onMove(-1)}><ChevronLeft size={21} /></button><span>{index + 1} / {total}</span><button type="button" aria-label="Next image" title="Next image · →" disabled={index >= total - 1 || creating} onClick={() => onMove(1)}><ChevronRight size={21} /></button></div>
        <label className="library-viewer__category" style={{ '--category-color': category ? categoryColor(category.name) : undefined } as React.CSSProperties}><Folder size={18} /> Category <select aria-label="Image category" value={image.categoryId || ''} disabled={creating} onChange={event => onAssign(event.target.value || null)}><option value="">Unassigned</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <button type="button" className="library-button library-button--quiet library-viewer__remove" aria-label="Remove image from project" disabled={creating} onClick={onRemove}><Trash2 size={16} /> Remove</button>
      </div>
      <form className="library-viewer__create" onSubmit={event => {
        event.preventDefault(); if (creating || !newCategory.trim()) return;
        setCreating(true); setCreateError('');
        void onCreateAndAssign(newCategory).then(() => setNewCategory('')).catch(cause => setCreateError(cause instanceof Error ? cause.message : String(cause))).finally(() => setCreating(false));
      }}>
        <input aria-label="New category for image" placeholder="Or create a new category…" disabled={creating} value={newCategory} onChange={event => setNewCategory(event.target.value)} />
        <button className="library-button" type="submit" disabled={creating || !newCategory.trim()}><Plus size={16} /> Create & assign</button>
        {createError && <small role="alert">{createError}</small>}
      </form>
    </footer>
  </Modal>;
}
