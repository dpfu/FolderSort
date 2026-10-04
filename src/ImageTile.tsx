import * as React from 'react';
import { Folder, Image as ImageIcon } from 'lucide-react';
import { type LibraryImage } from './libraryStore';
import { categoryColor } from './categoryTree';

export default function ImageTile({ image, category, url, failed, onOpen, onDragStart }: {
  image: LibraryImage; category?: string; url?: string; failed: boolean;
  onOpen: () => void; onDragStart?: React.DragEventHandler<HTMLButtonElement>;
}) {
  return <button draggable={Boolean(onDragStart)} onDragStart={onDragStart}
    className={`library-tile${category ? ' library-tile--coded' : ' library-tile--uncoded'}`}
    style={{ '--category-color': category ? categoryColor(category) : undefined } as React.CSSProperties}
    type="button" onClick={onOpen} aria-label={`Open ${image.path}`}>
    <span className="library-tile__visual">{url ? <img src={url} alt="" loading="lazy" draggable={false} /> : <span><ImageIcon size={22} /><small>{failed ? 'Preview unavailable' : 'Loading…'}</small></span>}</span>
    <span className="library-tile__name" title={image.path}>{image.path.split('/').at(-1)}</span>
    {image.path.includes('/') && <span className="library-tile__folder" title={image.path}>{image.path.slice(0, image.path.lastIndexOf('/'))}</span>}
    <span className={`library-tile__category${category ? '' : ' library-tile__category--empty'}`} title={category ? `Category: ${category}` : 'Unassigned'}><Folder size={12} />{category || 'Unassigned'}</span>
  </button>;
}
