export type PreviewPhase = 'closed' | 'previewing' | 'loading' | 'accepting' | 'accepted' | 'error';
export type PreviewTask = Readonly<{ version: number; phase: 'loading' | 'accepting' }>;
export type PreviewState<T> = Readonly<{ phase: PreviewPhase; version: number; data: T; notice: string }>;

/** One synchronous lifecycle owner for UI events and asynchronous completions.
 * Acceptance means applied locally; the board write has its own completion. */
export class PreviewSession<T> {
  private state: PreviewState<T>;
  private active = true;
  private listeners = new Set<() => void>();
  constructor(data: T, open = false) { this.state = { phase: open ? 'previewing' : 'closed', version: 0, data, notice: '' }; }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get current() { return this.state; }
  get open() { return this.state.phase !== 'closed'; }
  get accepting() { return this.state.phase === 'accepting'; }
  get accepted() { return this.state.phase === 'accepted'; }
  private change(patch: Partial<PreviewState<T>>) {
    this.state = { ...this.state, ...patch };
    if (this.active) this.listeners.forEach(listener => listener());
  }
  activate() { this.active = true; }
  deactivate() { this.active = false; this.change({ version: this.state.version + 1 }); }
  show(data: T) {
    if (!this.active || this.open) return false;
    this.change({ phase: 'previewing', version: this.state.version + 1, data, notice: '' }); return true;
  }
  close(data: T) {
    if (!this.active || this.accepting) return false;
    this.change({ phase: 'closed', version: this.state.version + 1, data, notice: '' }); return true;
  }
  update(update: (data: T) => T, clearNotice = false) {
    if (this.active && this.open && !this.accepting && !this.accepted) this.change({ data: update(this.state.data), ...(clearNotice ? { notice: '' } : {}) });
  }
  private begin(phase: PreviewTask['phase'], data = this.state.data, supersedeLoading = false): PreviewTask | undefined {
    if (!this.active || !this.open || this.accepting || this.accepted || phase === 'accepting' && this.state.phase === 'loading' && !supersedeLoading) return;
    const version = this.state.version + 1;
    this.change({ phase, version, data, notice: '' }); return { phase, version };
  }
  load(data?: T) { return this.begin('loading', data); }
  accept(options?: { supersedeLoading: boolean }) { return this.begin('accepting', this.state.data, options?.supersedeLoading); }
  cancel(task: PreviewTask) {
    if (this.owns(task)) this.change({ phase: 'previewing', version: this.state.version + 1 });
  }
  owns(task: PreviewTask) { return this.active && this.state.phase === task.phase && this.state.version === task.version; }
  resolve(task: PreviewTask, data: T, notice = '') {
    if (!this.owns(task)) return false;
    this.change({ phase: task.phase === 'accepting' ? 'accepted' : 'previewing', data, notice }); return true;
  }
  reject(task: PreviewTask, notice: string, data = this.state.data) {
    if (!this.owns(task)) return false;
    this.change({ phase: 'error', data, notice }); return true;
  }
}
