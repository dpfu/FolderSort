/** @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UndoControl, { type UndoView } from './UndoControl';

afterEach(cleanup);

function fixture() {
  const action: UndoView = { id: 1, label: 'Undo stash move', message: 'Moved image.', detail: 'Restore placement.', busy: false, onUndo: vi.fn() };
  const view = render(<UndoControl action={action} />);
  const button = screen.getByRole('button', { name: action.label });
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 44, 44));
  return { action, button, ...view };
}
const contact = { pointerType: 'touch', pointerId: 1, clientX: 20, clientY: 20 };

describe('touch recovery', () => {
  it('restores on touch release without a click, ignores its duplicate, and keeps mouse activation', () => {
    const { action, button } = fixture();
    fireEvent.pointerDown(button, contact); fireEvent.pointerUp(button, contact);
    expect(action.onUndo).toHaveBeenCalledTimes(1);
    fireEvent.click(button, { detail: 1 });
    expect(action.onUndo).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(button, { pointerType: 'mouse', pointerId: 2 }); fireEvent.click(button, { detail: 1 });
    expect(action.onUndo).toHaveBeenCalledTimes(2);
  });
  it('does not undo a moved, cancelled or outside press, including a subsequent compatibility click', () => {
    const { action, button } = fixture();
    fireEvent.pointerDown(button, contact); fireEvent.pointerUp(button, { ...contact, clientX: 35 }); fireEvent.click(button, { detail: 1 });
    fireEvent.pointerDown(button, contact); fireEvent.pointerCancel(button, contact); fireEvent.click(button, { detail: 1 });
    fireEvent.pointerDown(button, { ...contact, clientX: 43 }); fireEvent.pointerUp(button, { ...contact, clientX: 49 }); fireEvent.click(button, { detail: 1 });
    expect(action.onUndo).not.toHaveBeenCalled();
  });
  it('protects a changed or busy action while keeping keyboard activation available', () => {
    const { action, button, rerender } = fixture();
    fireEvent.pointerDown(button, contact);
    const next = { ...action, id: 2, onUndo: vi.fn() };
    rerender(<UndoControl action={next} />); fireEvent.pointerUp(button, contact); fireEvent.click(button, { detail: 1 });
    expect(action.onUndo).not.toHaveBeenCalled(); expect(next.onUndo).not.toHaveBeenCalled();
    fireEvent.click(button, { detail: 0 }); expect(next.onUndo).toHaveBeenCalledTimes(1);
    rerender(<UndoControl action={{ ...next, busy: true }} />);
    fireEvent.pointerDown(button, contact); fireEvent.pointerUp(button, contact); fireEvent.click(button, { detail: 0 });
    expect(next.onUndo).toHaveBeenCalledTimes(1);
  });
});
