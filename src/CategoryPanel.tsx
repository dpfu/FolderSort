import * as React from 'react';
import { Check, ChevronDown, ChevronRight, Eye, Folder, FolderPlus, Plus, Search, Undo2, X } from 'lucide-react';
import { categoryColor, categoryCounts, categoryDepth } from './categoryTree';
import type { LibraryCategory, LibraryImage } from './libraryStore';
import './category-panel.css';

type Props = {
  images: LibraryImage[];
  categories: LibraryCategory[];
  selected: LibraryImage[];
  thumbnails: Map<string, string>;
  busy: boolean;
  hoverId?: string | null;
  focusedId?: string | null;
  notice?: string;
  pulseId?: string | null;
  canUndo: boolean;
  actions?: React.ReactNode;
  onAssign: (ids: string[], categoryId: string | null, name?: string) => Promise<void>;
  onCreate: (name: string) => Promise<LibraryCategory>;
  onClear: () => void;
  onFocus: (id: string | null) => void;
  onUndo: () => void;
  onClose?: () => void;
};

export default function CategoryPanel({ images, categories, selected, thumbnails, busy, hoverId, focusedId, notice, pulseId, canUndo, actions, onAssign, onCreate, onClear, onFocus, onUndo, onClose }: Props) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [search, setSearch] = React.useState('');
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [parent, setParent] = React.useState<LibraryCategory | null>(null);
  const [name, setName] = React.useState('');
  const [error, setError] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const counts = React.useMemo(() => categoryCounts(images, categories), [images, categories]);
  const selectedCounts = React.useMemo(() => {
    const result = new Map<string | null, number>();
    selected.forEach(image => result.set(image.categoryId, (result.get(image.categoryId) || 0) + 1));
    return result;
  }, [selected]);
  const childNames = React.useMemo(() => new Set(categories.flatMap(category => category.name.includes('/') ? [category.name.slice(0, category.name.lastIndexOf('/'))] : [])), [categories]);
  const hiddenPrefixes = React.useMemo(() => categories.filter(category => collapsed.has(category.id)).map(category => `${category.name}/`), [categories, collapsed]);
  const query = search.trim().toLocaleLowerCase();
  const visible = React.useMemo(() => categories.filter(category => query ? category.name.toLocaleLowerCase().includes(query) : !hiddenPrefixes.some(prefix => category.name.startsWith(prefix))), [categories, query, hiddenPrefixes]);
  const selectedIds = selected.map(image => image.id);
  const assign = (id: string | null, categoryName?: string) => {
    if (!selectedIds.length || busy || creating) return;
    setError('');
    void onAssign(selectedIds, id, categoryName).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
  };
  const assignmentLabel = (categoryName: string) => selected.length === 1 ? `Assign ${selected[0].path} to ${categoryName}` : selected.length ? `Assign ${selected.length} images to ${categoryName}` : categoryName;
  const beginCreate = (category: LibraryCategory | null) => {
    setParent(category); setName(''); setError('');
    inputRef.current?.focus();
  };
  return <div className="category-panel">
    <header className="category-panel__header"><div><h2>Categories</h2><span>{(images.length - (counts.get('unassigned') || 0)).toLocaleString()} sorted · {(counts.get('unassigned') || 0).toLocaleString()} unassigned</span></div>
      <button type="button" aria-label="Add category" title="Add category" onClick={() => beginCreate(null)}><FolderPlus size={20} /></button>
      {onClose && <button className="sorting-workspace__tree-close" type="button" aria-label="Close categories" onClick={onClose}><X size={20} /></button>}
    </header>
    {images.length > 0 && <div className="category-panel__progress"><progress aria-label="Images sorted" max={images.length} value={images.length - (counts.get('unassigned') || 0)} /><span>{Math.floor((images.length - (counts.get('unassigned') || 0)) / images.length * 100)}%</span></div>}
    {images.length > 0 && !counts.get('unassigned') && <div className="category-panel__completion" role="status"><Check size={18} /><span>Every image has a home. Ready to export.</span></div>}
    <section className={`category-panel__selection${selected.length ? ' has-selection' : ''}`} aria-label="Category assignment">
      {selected.length ? <>
        <div className="category-panel__selection-head"><div className="category-panel__previews" aria-hidden="true">{selected.slice(0, 3).map(image => <span key={image.id}>{thumbnails.get(image.id) ? <img src={thumbnails.get(image.id)} alt="" /> : <Folder size={15} />}</span>)}</div>
          <div><strong>{selected.length === 1 ? selected[0].path.split('/').at(-1) : `${selected.length.toLocaleString()} images selected`}</strong><span>Choose a category below</span></div>
          <button type="button" aria-label="Clear image selection" title="Clear selection" onClick={onClear}><X size={16} /></button></div>
        {actions && <div className="category-panel__selection-actions">{actions}</div>}
      </> : <div className="category-panel__guidance"><strong>Select images → choose a category</strong><p>Click or tap an image, then a category. You can also drag images onto a category.</p>{actions}</div>}
    </section>
    {notice && <div className="category-panel__notice"><span role="status">{notice}</span>{canUndo && <button type="button" aria-label="Undo category assignment" disabled={busy} onClick={onUndo}><Undo2 size={14} /> Undo</button>}</div>}
    {categories.length > 5 && <label className="category-panel__search"><Search size={15} /><input type="search" aria-label="Find categories" placeholder="Find a category…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button type="button" aria-label="Clear category search" onClick={() => setSearch('')}><X size={14} /></button>}</label>}
    <div className="category-panel__list">
      <div className={`category-panel__row category-panel__row--unassigned${focusedId === 'unassigned' ? ' is-focused' : ''}${hoverId === 'unassigned' ? ' is-drop-target' : ''}`} data-category-drop-id="unassigned">
        <span className="category-panel__branch-spacer" /><button type="button" className="category-panel__label" aria-label={assignmentLabel('Unassigned')} title={selected.length ? 'Remove the category from the selected images' : 'Highlight unassigned images'} disabled={busy || creating} onClick={() => { if (selected.length) assign(null); else onFocus(focusedId === 'unassigned' ? null : 'unassigned'); }}>
          <span className="category-panel__swatch category-panel__swatch--unassigned"><Folder size={17} /></span><span className="category-panel__name">Unassigned</span><small>{counts.get('unassigned') || 0}</small>{!!selected.length && selectedCounts.get(null) === selected.length && <Check size={15} className="category-panel__check" />}
        </button><button className="category-panel__focus" type="button" aria-label="Focus unassigned images" aria-pressed={focusedId === 'unassigned'} title="Highlight unassigned images" onClick={() => onFocus(focusedId === 'unassigned' ? null : 'unassigned')}><Eye size={16} /></button><span className="category-panel__end-spacer" />
      </div>
      {visible.map(category => {
        const checked = !!selected.length && selectedCounts.get(category.id) === selected.length;
        return <div key={category.id} className={`category-panel__row${checked ? ' is-assigned' : ''}${focusedId === category.id ? ' is-focused' : ''}${hoverId === category.id ? ' is-drop-target' : ''}${pulseId === category.id ? ' is-settled' : ''}`}
          style={{ paddingLeft: 3 + Math.min(5, categoryDepth(category.name)) * 13, '--category-color': categoryColor(category.name) } as React.CSSProperties} data-category-drop-id={category.id}>
          {childNames.has(category.name) ? <button className="category-panel__branch" type="button" aria-label={`${collapsed.has(category.id) ? 'Expand' : 'Collapse'} ${category.name}`} onClick={() => setCollapsed(current => { const next = new Set(current); if (next.has(category.id)) next.delete(category.id); else next.add(category.id); return next; })}>{collapsed.has(category.id) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</button> : <span className="category-panel__branch-spacer" />}
          <button type="button" className="category-panel__label" aria-label={assignmentLabel(category.name)} title={selected.length ? `Assign ${selected.length === 1 ? 'image' : 'selection'} to ${category.name}` : `${category.name} · Select images to assign`} disabled={busy || creating} onClick={() => { if (selected.length) assign(category.id, category.name); else onFocus(focusedId === category.id ? null : category.id); }}>
            <span className="category-panel__swatch"><Folder size={17} /></span><span className="category-panel__name">{category.name.split('/').at(-1)}{query && categoryDepth(category.name) > 0 && <em>{category.name}</em>}</span><small>{counts.get(category.id) || 0}</small>{checked && <Check size={15} className="category-panel__check" />}
          </button>
          <button className="category-panel__focus" type="button" aria-label={`Focus category ${category.name}`} aria-pressed={focusedId === category.id} title={`Highlight ${category.name} and its subcategories`} onClick={() => onFocus(focusedId === category.id ? null : category.id)}><Eye size={16} /></button>
          <button className="category-panel__new-child" type="button" aria-label={`Add subcategory to ${category.name}`} title="Add subcategory" onClick={() => beginCreate(category)}><Plus size={15} /></button>
        </div>;
      })}
      {categories.length === 0 && <p className="category-panel__empty">Create your first category below.{selected.length > 0 && ' The selected images will be assigned to it.'}</p>}
      {categories.length > 0 && visible.length === 0 && <p className="category-panel__empty">No matching categories. Create one below.</p>}
    </div>
    <form className="category-panel__create" onSubmit={event => {
      event.preventDefault(); if (!name.trim() || busy || creating) return;
      const ids = [...selectedIds];
      setCreating(true); setError('');
      void (async () => {
        const path = (parent ? `${parent.name}/${name}` : name).trim();
        const existing = ids.length ? categories.find(category => category.name.toLocaleLowerCase() === path.toLocaleLowerCase()) : undefined;
        const category = existing || await onCreate(path);
        if (ids.length) await onAssign(ids, category.id, category.name);
        setName(''); setParent(null); setSearch('');
      })().catch(cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setCreating(false));
    }}>
      {parent && <span>Inside {parent.name}<button type="button" aria-label="Create top-level category instead" onClick={() => setParent(null)}><X size={14} /></button></span>}
      <div><input ref={inputRef} aria-label="New category name" placeholder={selected.length ? 'New category for selection…' : 'New category…'} value={name} disabled={creating} onChange={event => setName(event.target.value)} />
        <button type="submit" aria-label={selected.length ? 'Create and assign category' : 'Create category'} title={selected.length ? 'Create category and assign the selected images' : 'Create category'} disabled={busy || creating || !name.trim()}><Plus size={18} /></button></div>
      <small>{selected.length ? `Enter to create & assign ${selected.length === 1 ? 'this image' : `${selected.length} images`}` : 'Enter to create · / for nested folders'}</small>
      {error && <p role="alert">{error}</p>}
    </form>
  </div>;
}
