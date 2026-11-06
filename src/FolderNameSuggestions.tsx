import { useFolderNameDraft } from './useFolderNameDraft';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Check, LoaderCircle, X } from 'lucide-react';
import { type LibraryCategory, type LibraryImage } from './libraryStore';
import type { RenameStash } from './useActionHistory';
import './folder-naming.css';

export default function FolderNameSuggestions({ folder, images, categories, enabled, busy, onRename }: {
  folder: LibraryCategory; images: LibraryImage[]; categories: LibraryCategory[]; enabled: boolean; busy: boolean; onRename: RenameStash;
}) {
  const draft = useFolderNameDraft(folder, images, categories, enabled, busy, onRename);
  const { open, loading, names, name, selected, error, saving, referenceKey } = draft;
  const trigger = React.useRef<HTMLButtonElement>(null), panel = React.useRef<HTMLDivElement>(null), input = React.useRef<HTMLInputElement>(null);
  const id = React.useId();
  React.useEffect(() => {
    if (!open) return;
    // Let the existing folder navigation transition finish before offering keyboard input.
    const timer = setTimeout(() => input.current?.focus({ preventScroll: true }), 360);
    return () => clearTimeout(timer);
  }, [open]);
  const close = (restore = true) => { if (draft.close() && restore) trigger.current?.focus({ preventScroll: true }); };
  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = trigger.current?.getBoundingClientRect(), node = panel.current;
      if (!bounds || !node) return;
      node.style.left = Math.max(8, Math.min(innerWidth - node.offsetWidth - 8, bounds.left)) + 'px';
      node.style.top = Math.max(8, Math.min(innerHeight - node.offsetHeight - 8, bounds.bottom + 10)) + 'px';
    };
    place(); const observer = new ResizeObserver(place); if (panel.current) observer.observe(panel.current);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) close(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('pointerdown', outside, true); };
  }, [open]);
  const save = async () => { if (!await draft.save()) input.current?.focus({ preventScroll: true }); };
  const choose = (index: number) => { draft.choose(index); input.current?.focus({ preventScroll: true }); };

  return <>
    <button ref={trigger} type="button" className="workspace-current folder-name-trigger" data-current-location aria-current="page"
      aria-label="Name this folder" aria-expanded={open} aria-controls={open ? id : undefined} title="Choose a name for this folder" disabled={busy}
      onClick={draft.toggle}>{folder.name.split('/').at(-1)}</button>
    {open && createPortal(<div ref={panel} id={id} role="region" aria-label="Name this folder" className="folder-naming"
      onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); close(); }
      }}>
      <header><strong>Name this folder</strong><button type="button" aria-label="Keep folder untitled" title="Keep untitled" disabled={saving} onClick={() => close()}><X size={15} /></button></header>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <input ref={input} aria-label="Folder name" aria-invalid={!!error} aria-describedby={error ? id + '-error' : undefined} maxLength={120} placeholder="Type a name…" value={name} disabled={busy || saving}
          onChange={event => draft.edit(event.currentTarget.value)}
          onKeyDown={event => {
            if (!event.nativeEvent.isComposing && names.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              event.preventDefault(); choose((selected + (event.key === 'ArrowDown' ? 1 : names.length - 1) + names.length) % names.length);
            }
          }} />
        <button type="submit" className="folder-naming__save" disabled={busy || saving || !name.trim()}><Check size={16} />Save</button>
      </form>
      {!!names.length && <div className="folder-naming__choices" role="group" aria-label="Suggested folder names">{names.map((label, index) => <button key={label} type="button" aria-pressed={selected === index} disabled={busy || saving} onClick={() => choose(index)}>{label}</button>)}</div>}
      {(loading || !enabled || !referenceKey) && <p role="status">{loading ? <><LoaderCircle size={13} className="is-spinning" />Finding name suggestions…</> : !enabled ? 'Enable CLIP in project settings for name suggestions.' : 'Add images for name suggestions, or type your own.'}</p>}
      {error && <p role="alert" id={id + '-error'}>{error}<button type="button" disabled={busy || saving} onClick={draft.retry}>Retry</button></p>}
    </div>, document.body)}
  </>;
}
