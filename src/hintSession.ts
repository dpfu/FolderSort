export class HintSession {
  private phase: 'hidden' | 'transient' | 'pinned' = 'hidden';
  private over = false;
  private skipFocus = false;
  private pressed?: boolean;
  private showTimer?: ReturnType<typeof setTimeout>;
  private hideTimer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<() => void>();
  constructor(private containsFocus: () => boolean) {}
  snapshot = () => this.phase;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get open() { return this.phase !== 'hidden'; }
  get pinned() { return this.phase === 'pinned'; }
  clearTimers() { clearTimeout(this.showTimer); clearTimeout(this.hideTimer); }
  private change(phase: typeof this.phase) { this.phase = phase; this.listeners.forEach(listener => listener()); }
  show(pin = false) { this.clearTimers(); this.change(pin || this.pinned ? 'pinned' : 'transient'); }
  close() { this.clearTimers(); this.change('hidden'); }
  enter(delayed = false) {
    this.over = true; this.clearTimers();
    if (delayed) this.showTimer = setTimeout(() => this.show(), 250);
  }
  leave() {
    this.over = false; this.clearTimers();
    this.hideTimer = setTimeout(() => { if (!this.pinned && !this.over && !this.containsFocus()) this.change('hidden'); }, 130);
  }
  blur() { if (this.pinned) this.change('transient'); this.leave(); }
  suppressNextFocus() { this.skipFocus = true; }
  press() { this.pressed = this.pinned; }
  cancelPress() { this.pressed = undefined; }
  toggle(fromPointer: boolean) {
    const dismiss = fromPointer ? this.pressed ?? this.pinned : this.pinned;
    this.pressed = undefined;
    if (dismiss) this.close(); else this.show(true);
  }
  focus(inPanel: boolean) {
    if (this.skipFocus) { this.skipFocus = false; return; }
    this.show(inPanel);
  }
  dispose() { this.clearTimers(); }
}
