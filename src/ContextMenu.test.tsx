/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { contextKey, useContextMenuController, type ContextAction } from './ContextMenu';

function Harness({ scope = 'staging', blocked = false, actions }: { scope?: string; blocked?: boolean; actions: ContextAction[] }) {
  const menu = useContextMenuController(scope, blocked, () => undefined);
  return <><button onContextMenu={event => menu.open(event, { label: 'Test actions', actions })} onKeyDown={event => { if (contextKey(event)) menu.open(event, { label: 'Test actions', actions }); }}>Image</button>{menu.host}</>;
}
afterEach(cleanup);
it('navigates, explains disabled actions, activates once and restores the source focus', () => {
  const run = vi.fn(), actions = [{ id: 'open', label: 'Open', run }, { id: 'delete', label: 'Delete', disabled: true, description: 'Empty it first.', run }];
  render(<Harness actions={actions} />); const source = screen.getByRole('button', { name: 'Image' });
  fireEvent.keyDown(source, { key: 'F10', shiftKey: true });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Open' }));
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  const disabled = screen.getByRole('menuitem', { name: /Delete/ }); expect(document.activeElement).toBe(disabled);
  expect(document.getElementById(disabled.getAttribute('aria-describedby')!)?.textContent).toBe('Empty it first.');
  fireEvent.click(disabled); expect(run).not.toHaveBeenCalled(); expect(screen.queryByRole('menu')).not.toBeNull();
  fireEvent.keyDown(disabled, { key: 'Home' }); fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
  expect(run).toHaveBeenCalledTimes(1); expect(screen.queryByRole('menu')).toBeNull(); expect(document.activeElement).toBe(source);
});
it('leaves Shift-right-click native and closes on scope changes and outside interactions', () => {
  const actions = [{ id: 'open', label: 'Open', run: vi.fn() }]; const view = render(<Harness actions={actions} />);
  const source = screen.getByRole('button', { name: 'Image' });
  expect(fireEvent.contextMenu(source, { shiftKey: true })).toBe(true); expect(screen.queryByRole('menu')).toBeNull();
  expect(fireEvent.contextMenu(source)).toBe(false); fireEvent.pointerDown(document.body); expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.contextMenu(source); view.rerender(<Harness actions={actions} scope="folder" />); expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.contextMenu(source); view.rerender(<Harness actions={actions} scope="folder" blocked />); expect(screen.queryByRole('menu')).toBeNull();
});

it('ignores queued scroll events but dismisses after an actual scroll', () => {
  render(<Harness actions={[{ id: 'open', label: 'Open', run: () => undefined }]} />);
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Image' }));
  fireEvent.scroll(document.body); expect(screen.queryByRole('menu')).not.toBeNull();
  document.body.scrollTop = 20; fireEvent.scroll(document.body); expect(screen.queryByRole('menu')).toBeNull();
  document.body.scrollTop = 0;
});
