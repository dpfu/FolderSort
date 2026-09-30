import * as React from 'react';
import { getImageBlob, type LibraryImage } from './libraryStore';

export default function ImageTile({ image, category, onOpen, onDragStart }: {
  image: LibraryImage;
  category?: string;
  onOpen: () => void;
  onDragStart?: React.DragEventHandler<HTMLButtonElement>;
}) {
  const [url, setUrl] = React.useState<string>();
  const [inView, setInView] = React.useState(false);
  const tile = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    const node = tile.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); observer.disconnect(); }
    }, { rootMargin: '250px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    if (!inView) return;
    let active = true;
    let objectUrl: string | undefined;
    void getImageBlob(image.id).then((blob) => {
      if (blob && active) {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }
    });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image.id, inView]);
  return <button ref={tile} draggable={Boolean(onDragStart)} onDragStart={onDragStart}
    className={`library-tile${category ? ' library-tile--coded' : ' library-tile--uncoded'}`}
    type="button" onClick={onOpen} aria-label={`Open ${image.path}`}>
    <span className="library-tile__visual">{url ? <img src={url} alt="" loading="lazy" draggable={false} /> : <span>Loading…</span>}</span>
    <span className="library-tile__name" title={image.path}>{image.path.split('/').at(-1)}</span>
    {image.path.includes('/') ? <span className="library-tile__folder" title={image.path}>{image.path.slice(0, image.path.lastIndexOf('/'))}</span> : null}
    <span className={`library-tile__category${category ? '' : ' library-tile__category--empty'}`} title={category ? `Category: ${category}` : 'Unassigned'}>{category || 'Unassigned'}</span>
  </button>;
}
