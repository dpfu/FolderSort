/** @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Board } from './Board';
import type { CardData } from './types';

vi.mock('./DraggableCard', () => ({ DraggableCard: ({ card, onKeyboardMove }: { card: CardData; onKeyboardMove?: (id: string, direction: string) => void }) =>
  <button onKeyDown={event => { if (event.key === 'ArrowRight') onKeyboardMove?.(card.id, 'right'); }}>{card.meta.name}</button> }));
afterEach(cleanup);
const card: CardData = { id: 'one', kind: 'image', createdAt: 1, meta: { name: 'Photo', notes: '', tags: [] }, x: 100, y: 200, z: 1 };
function board(onMoveEnd: React.ComponentProps<typeof Board>['onMoveEnd'], dragEnabled = true) {
  render(<Board cards={[card]} baseCardWidth={172} cardLayoutMode="as-is" boardRef={React.createRef<HTMLDivElement>()} dragEnabled={dragEnabled} onBringToFront={() => {}} onMoveEnd={onMoveEnd} />);
}
it('moves a board image by keyboard and announces accepted and rejected changes', () => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  const move = vi.fn().mockReturnValueOnce(undefined).mockReturnValueOnce(false);
  board(move);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Photo' }), { key: 'ArrowRight' });
  expect(move).toHaveBeenCalledExactlyOnceWith('one', 132, 200);
  expect(screen.getByRole('status').textContent).toBe('Moved Photo.');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Photo' }), { key: 'ArrowRight' });
  expect(screen.getByRole('status').textContent).toContain('cannot move farther');
  vi.restoreAllMocks();
});
it('keeps a disabled board from accepting keyboard moves', () => {
  const move = vi.fn(); board(move, false);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Photo' }), { key: 'ArrowRight' });
  expect(move).not.toHaveBeenCalled();
});
