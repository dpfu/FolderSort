import * as React from 'react';
import { ChevronDown, ChevronUp, GripHorizontal, Layers3, Link2, ScanSearch } from 'lucide-react';
import { categoryColor } from './categoryTree';
import type { BoardPoint, CategoryBoardGroup, CategoryBoardMode } from './categoryBoard';
import type { CardData } from './types';

type Props = {
  mode: CategoryBoardMode;
  groups: CategoryBoardGroup[];
  cards: CardData[];
  zoom: number;
  busy: boolean;
  hoverId: string | null;
  focusedId: string | null;
  focusedName?: string;
  pulseId?: string | null;
  selectedIds: Set<string>;
  onSelect: (ids: string[]) => void;
  onExpand: (id: string) => void;
  onExplore: (id: string) => void;
  onPreviewMove: (group: CategoryBoardGroup, delta: BoardPoint) => void;
  onMove: (group: CategoryBoardGroup, delta: BoardPoint) => void;
  onCancelMove: () => void;
};

export default function CategoryBoardLayer({ mode, groups, cards, zoom, busy, hoverId, focusedId, focusedName, pulseId, selectedIds, onSelect, onExpand, onExplore, onPreviewMove, onMove, onCancelMove }: Props) {
  const drag = React.useRef<{ group: CategoryBoardGroup; x: number; y: number; pointerId: number; delta: BoardPoint }>();
  const frame = React.useRef<number>();
  const stopFrame = () => { if (frame.current !== undefined) cancelAnimationFrame(frame.current); frame.current = undefined; };
  React.useEffect(() => () => { if (frame.current !== undefined) cancelAnimationFrame(frame.current); }, []);
  const byCategory = new Map<string, CardData[]>();
  if (mode === 'linked') for (const card of cards) { const name = card.meta.tags[0]; if (!name) continue; const members = byCategory.get(name) || []; members.push(card); byCategory.set(name, members); }
  return <div className={`category-board category-board--${mode}`}>
    {mode === 'linked' && <svg className="category-board__connections" aria-hidden="true"><g>{groups.map(group => {
      const members = byCategory.get(group.name) || [];
      const x = group.x + 100, y = group.y + 40;
      return <g key={group.id} data-category-links-id={group.id} stroke={categoryColor(group.name)}>{members.map(card => <path key={card.id} d={`M ${x} ${y} C ${x} ${y + 64}, ${card.x + 86} ${card.y - 24}, ${card.x + 86} ${card.y + 86}`} />)}</g>;
    })}</g></svg>}
    {groups.map(group => <section key={group.id} data-board-group-id={group.id} data-category-drop-id={group.id}
      className={`category-board__group${group.expanded ? ' is-expanded' : ''}${hoverId === group.id ? ' is-drop-target' : ''}${pulseId === group.id ? ' is-settled' : ''}${focusedId && focusedId !== group.id && !group.name.toLocaleLowerCase().startsWith(`${focusedName?.toLocaleLowerCase()}/`) ? ' is-muted' : ''}`}
      style={{ left: group.x, top: group.y, width: group.width, height: group.height, '--category-color': categoryColor(group.name) } as React.CSSProperties}
      aria-label={`${group.name} category ${mode === 'stacks' ? 'stack' : 'group'}`}>
      <div className="category-board__header">
        <button type="button" className="category-board__handle" aria-label={`Select ${group.ids.length} board images in ${group.name}`} disabled={busy}
          title="Click to select the category. Drag this label to move its images together."
          onPointerDown={event => {
            if (event.button !== 0 || busy) return;
            event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { group, x: event.clientX, y: event.clientY, pointerId: event.pointerId, delta: { x: 0, y: 0 } };
          }} onPointerMove={event => {
            if (!drag.current || drag.current.pointerId !== event.pointerId) return;
            const current = drag.current;
            current.delta = { x: Math.max(-group.x + 8, (event.clientX - current.x) / zoom), y: Math.max(-group.y + 8, (event.clientY - current.y) / zoom) };
            if (frame.current === undefined) frame.current = requestAnimationFrame(() => { frame.current = undefined; if (drag.current) onPreviewMove(drag.current.group, drag.current.delta); });
          }} onPointerUp={event => {
            const current = drag.current; if (!current || current.pointerId !== event.pointerId) return;
            stopFrame(); drag.current = undefined;
            if (Math.hypot(current.delta.x, current.delta.y) > 4 / zoom) onMove(current.group, current.delta);
            else { onCancelMove(); onSelect(group.ids); }
          }} onPointerCancel={() => { stopFrame(); drag.current = undefined; onCancelMove(); }}
          onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) { stopFrame(); drag.current = undefined; onCancelMove(); } }}
          onClick={event => { if (event.detail === 0) onSelect(group.ids); }}
          onKeyDown={event => {
            if (!event.key.startsWith('Arrow')) return; event.preventDefault();
            const step = event.shiftKey ? 48 : 16;
            onMove(group, { x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0 });
          }}>
          {mode === 'stacks' ? <Layers3 size={17} /> : <Link2 size={17} />}<span><strong>{group.name.split('/').at(-1)}</strong>{group.name.includes('/') && <small>{group.name.slice(0, group.name.lastIndexOf('/'))}</small>}</span><em title={`${group.ids.length} images on the board, assigned directly to ${group.name}`}>{group.ids.length.toLocaleString()}</em><GripHorizontal size={14} className="category-board__grip" />
        </button>
        {mode === 'stacks' && group.ids.length > 0 && <button type="button" className="category-board__expand" aria-label={`${group.expanded ? 'Collapse' : 'Open'} stack ${group.name}`} aria-expanded={group.expanded} title={group.expanded ? 'Gather into a stack' : 'Spread out this stack'} onClick={() => onExpand(group.id)}>{group.expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</button>}
        <button type="button" className="category-board__explore" aria-label={`Explore category ${group.name}`} title="Explore this category and its subcategories" onClick={() => onExplore(group.id)}><ScanSearch size={17} /></button>
      </div>
      {mode === 'stacks' && !group.ids.length && <div className="category-board__empty"><Layers3 size={30} /><span>Drop images here</span></div>}
      {mode === 'stacks' && group.ids.length > 3 && !group.expanded && <button type="button" className="category-board__more" aria-label={`Open all ${group.ids.length} images in stack ${group.name}`} onClick={() => onExpand(group.id)}>+{(group.ids.length - 3).toLocaleString()} more · open stack</button>}
      {group.ids.length > 0 && group.ids.every(id => selectedIds.has(id)) && <span className="category-board__selected" aria-hidden="true">Selected</span>}
    </section>)}
  </div>;
}
