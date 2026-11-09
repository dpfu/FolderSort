import { expect, it } from 'vitest';
import { PreviewSession } from './previewSession';

it('ignores superseded requests and completions from a dismissed/reopened draft', () => {
  const session = new PreviewSession<string[]>([]);
  session.show([]);
  const first = session.load()!, second = session.load()!;
  expect(session.resolve(first, ['old'])).toBe(false);
  expect(session.resolve(second, ['new'])).toBe(true);
  const dismissed = session.load()!;
  session.close([]); session.show([]);
  expect(session.resolve(dismissed, ['late'])).toBe(false);
  expect(session.current.data).toEqual([]);
});

it('accepts once, retains exact draft data and protects acceptance from dismissal/reload', () => {
  const moves = [{ id: 'a', x: 12, y: 34 }];
  const session = new PreviewSession(moves, true);
  const task = session.accept()!;
  expect(session.accept()).toBeUndefined(); expect(session.load()).toBeUndefined();
  expect(session.close([])).toBe(false);
  session.update(() => []); expect(session.current.data).toBe(moves);
  expect(session.resolve(task, moves)).toBe(true);
  expect(session.current.phase).toBe('accepted');
  expect(session.accept()).toBeUndefined();
  expect(session.close([])).toBe(true);
});

it('rejects a stale acceptance, preserves a retryable draft after errors and permits retry', () => {
  const session = new PreviewSession(['a'], true);
  const task = session.accept()!;
  expect(session.reject(task, 'Board changed')).toBe(true);
  expect(session.current.data).toEqual(['a']);
  const retry = session.accept()!;
  expect(session.resolve(task, ['wrong'])).toBe(false);
  expect(session.resolve(retry, ['a'])).toBe(true);
});

it('invalidates tasks on unmount while permitting a fresh Strict Mode activation', () => {
  const session = new PreviewSession(['a'], true);
  const task = session.load()!;
  session.deactivate(); expect(session.resolve(task, ['late'])).toBe(false);
  session.activate(); expect(session.resolve(task, ['late'])).toBe(false);
  expect(session.resolve(session.load()!, ['fresh'])).toBe(true);
});
