/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import Modal from './Modal';

afterEach(cleanup);
it('restores the original opener even when a descendant autofocuses during mounting', () => {
  const opener = document.createElement('button'); opener.textContent = 'Open image'; document.body.append(opener); opener.focus();
  const view = render(<Modal label="Image" className="image-review" onClose={() => {}}><button autoFocus>Close image</button></Modal>);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close image' }));
  view.unmount(); expect(document.activeElement).toBe(opener); opener.remove();
});
