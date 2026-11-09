import { expect, it, vi } from 'vitest';
import { FolderNavigation } from './folderNavigation';
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
const effects = () => ({ prepare: vi.fn(async () => {}), leave: vi.fn(async () => {}), valid: () => true, commit: vi.fn(), enter: vi.fn(async () => {}), focus: vi.fn(), error: vi.fn() });

it('ignores a superseded preparation without committing or releasing the current motion', async () => {
  const release = vi.fn(), navigation = new FolderNavigation(release), first = effects(), second = effects();
  const preparing = deferred(), entering = deferred();
  first.prepare.mockImplementation(() => preparing.promise); second.enter.mockImplementation(() => entering.promise);
  const old = navigation.run(first), current = navigation.run(second);
  await vi.waitFor(() => expect(navigation.phase).toBe('entering'));
  const releases = release.mock.calls.length;
  preparing.resolve(); await old;
  expect(first.commit).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledTimes(releases);
  entering.resolve(); await current;
  expect(second.commit).toHaveBeenCalledOnce(); expect(second.focus).toHaveBeenCalledOnce(); expect(navigation.phase).toBe('idle');
});

it('cancels an invalid destination or a detached workspace and releases locked controls', async () => {
  const release = vi.fn(), navigation = new FolderNavigation(release), removed = effects();
  removed.valid = () => false; await navigation.run(removed);
  expect(removed.commit).not.toHaveBeenCalled(); expect(navigation.phase).toBe('idle'); expect(release).toHaveBeenCalledTimes(2);
  const leaving = deferred(), next = effects(); next.leave.mockImplementation(() => leaving.promise);
  const pending = navigation.run(next);
  await vi.waitFor(() => expect(navigation.phase).toBe('leaving'));
  navigation.deactivate(); leaving.resolve(); await pending;
  expect(next.commit).not.toHaveBeenCalled(); expect(next.focus).not.toHaveBeenCalled();
  navigation.activate(); await navigation.run(effects()); expect(navigation.phase).toBe('idle');
});

it('reports only the owning transaction’s failure and releases motion before reporting it', async () => {
  const release = vi.fn(), navigation = new FolderNavigation(release), failing = effects();
  failing.prepare.mockRejectedValue(new Error('Storage unavailable'));
  await navigation.run(failing);
  expect(navigation.phase).toBe('idle'); expect(failing.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'Storage unavailable' }));
  expect(release).toHaveBeenCalledTimes(2);
});
