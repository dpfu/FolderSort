import * as React from 'react';

type Direction = 'in' | 'out';

/** Animate a viewport, never the persisted camera or thousands of image records. */
export function useStashNavigationMotion(
  pane: React.RefObject<HTMLElement>,
  scene: React.RefObject<HTMLElement>,
  workspace: React.RefObject<HTMLElement>,
) {
  const animations = React.useRef(new Set<Animation>());
  const primary = React.useRef<Animation>();
  const keyboard = React.useRef(false);
  const tile = (id?: string) => id ? Array.from(pane.current?.querySelectorAll<HTMLElement>('[data-board-group-id]') || [])
    .find(node => node.dataset.boardGroupId === id) : undefined;
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pose = (target?: HTMLElement) => {
    const bounds = scene.current!.getBoundingClientRect(), rect = target?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 - bounds.left : bounds.width / 2;
    const y = rect ? rect.top + rect.height / 2 - bounds.top : bounds.height / 2;
    return { origin: `${x}px ${y}px`, zoom: `translate(${Math.max(-120, Math.min(120, (bounds.width / 2 - x) * .32))}px,${Math.max(-90, Math.min(90, (bounds.height / 2 - y) * .32))}px) scale(1.32)` };
  };
  const play = (node: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    if (!node.animate) return undefined;
    const animation = node.animate(frames, options);
    animations.current.add(animation);
    void animation.finished.then(() => animations.current.delete(animation), () => animations.current.delete(animation));
    return animation;
  };
  const contextualControls = (locked: boolean) => {
    workspace.current?.querySelectorAll<HTMLElement>('.app-bar__tools, .app-bar__actions, .image-browser').forEach(node => { node.inert = locked; });
  };
  const release = () => {
    contextualControls(false);
    primary.current?.cancel(); primary.current = undefined;
    if (scene.current) { scene.current.inert = false; scene.current.style.transformOrigin = ''; }
    pane.current?.removeAttribute('data-stash-navigation'); pane.current?.removeAttribute('aria-busy');
  };
  const cancel = React.useCallback(() => {
    animations.current.forEach(animation => animation.cancel()); animations.current.clear();
    release();
  }, [pane, scene]);
  React.useEffect(() => cancel, [cancel]);
  React.useEffect(() => {
    const root = workspace.current;
    const onKey = () => { keyboard.current = true; };
    const onPointer = () => { keyboard.current = false; };
    root?.addEventListener('keydown', onKey, true); root?.addEventListener('pointerdown', onPointer, true);
    return () => { root?.removeEventListener('keydown', onKey, true); root?.removeEventListener('pointerdown', onPointer, true); };
  }, [workspace]);

  const leave = async (direction: Direction, id?: string) => {
    cancel();
    const node = scene.current; if (!node) return;
    const focus = pose(direction === 'in' ? tile(id) : undefined);
    node.style.transformOrigin = focus.origin; node.inert = true; contextualControls(true);
    pane.current?.setAttribute('data-stash-navigation', direction); pane.current?.setAttribute('aria-busy', 'true');
    primary.current = play(node, reduced() ? [{ opacity: 1 }, { opacity: 0 }] : [
      { opacity: 1, transform: 'translate(0px,0px) scale(1)' },
      { opacity: 0, transform: direction === 'in' ? focus.zoom : 'scale(.9)' },
    ], { duration: reduced() ? 40 : 140, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' });
    await primary.current?.finished.catch(() => {});
  };
  const enter = async (direction: Direction, returnId?: string) => {
    const node = scene.current; if (!node) { release(); return; }
    // Keep contextual commands locked until the arriving board can accept them.
    // Back remains available throughout both halves of the transition.
    // The keyed Board has now restored its own camera in a layout effect.
    primary.current?.cancel();
    const target = direction === 'out' ? tile(returnId) : undefined, focus = pose(target);
    node.style.transformOrigin = focus.origin;
    const animation = play(node, reduced() ? [{ opacity: 0 }, { opacity: 1 }] : [
      { opacity: 0, transform: direction === 'out' ? focus.zoom : 'scale(.9)' },
      { opacity: 1, transform: 'translate(0px,0px) scale(1)' },
    ], { duration: reduced() ? 40 : 140, easing: 'cubic-bezier(.2,.7,.2,1)' });
    primary.current = animation;
    const crumb = workspace.current?.querySelector<HTMLElement>('[data-current-location]');
    if (crumb) play(crumb, [{ backgroundColor: 'var(--raised)' }, { backgroundColor: 'transparent' }], { duration: 700 });
    if (target) play(target, [{ boxShadow: '0 0 0 2px var(--accent)' }, { boxShadow: '0 0 0 2px transparent' }], { duration: 800 });
    await animation?.finished.catch(() => {});
    if (primary.current === animation) release();
  };
  return { leave, enter, cancel, tile, keyboard };
}
