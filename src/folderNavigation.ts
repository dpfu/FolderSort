export type NavigationPhase = 'idle' | 'preparing' | 'leaving' | 'committing' | 'entering';
type NavigationEffects = {
  prepare: () => Promise<unknown>; leave: () => Promise<unknown>; valid: () => boolean;
  commit: () => void; enter: () => Promise<unknown>; focus: () => void; error: (cause: unknown) => void;
};

/** A superseded transaction cannot commit a scope, focus it or release a newer transition. */
export class FolderNavigation {
  private active = true;
  private current?: { phase: NavigationPhase };
  constructor(private releaseMotion: () => void) {}
  get phase(): NavigationPhase { return this.current?.phase || 'idle'; }
  activate() { this.active = true; }
  deactivate() { this.active = false; this.cancel(); }
  cancel() { this.current = undefined; this.releaseMotion(); }
  async run(effects: NavigationEffects) {
    if (!this.active) return;
    this.cancel();
    const task = { phase: 'preparing' as NavigationPhase };
    this.current = task;
    const owns = () => this.active && this.current === task;
    try {
      await effects.prepare();
      if (!owns()) return;
      task.phase = 'leaving'; await effects.leave();
      if (!owns()) return;
      if (!effects.valid()) { this.cancel(); return; }
      task.phase = 'committing'; effects.commit();
      task.phase = 'entering'; await effects.enter();
      if (owns()) { effects.focus(); this.current = undefined; }
    } catch (cause) {
      if (owns()) { this.cancel(); effects.error(cause); }
    }
  }
}
