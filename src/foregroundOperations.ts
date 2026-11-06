export type ForegroundKind = 'command' | 'undo' | 'assignment' | 'create-folder' | 'rename-folder' | 'delete-folder' | 'settings' | 'prepare-folder';
export type ForegroundTask = Readonly<{ id: number; kind: ForegroundKind }>;

/** Foreground commands may overlap; only their owner can update or release them. */
export class ForegroundOperations {
  private serial = 0;
  private tasks = new Map<ForegroundTask, string>();
  private listeners = new Set<() => void>();
  private state = { busy: false, progress: '' };
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get busy() { return this.tasks.size > 0; }
  has(kind: ForegroundKind) { return [...this.tasks.keys()].some(task => task.kind === kind); }
  private publish() {
    this.state = { busy: this.busy, progress: [...this.tasks.values()].filter(Boolean).at(-1) || '' };
    this.listeners.forEach(listener => listener());
  }
  begin(kind: ForegroundKind, label = ''): ForegroundTask {
    const task = { id: ++this.serial, kind };
    this.tasks.set(task, label); this.publish(); return task;
  }
  progress(task: ForegroundTask, label: string) {
    if (!this.tasks.has(task)) return;
    this.tasks.set(task, label); this.publish();
  }
  finish(task: ForegroundTask) { if (this.tasks.delete(task)) this.publish(); }
}
