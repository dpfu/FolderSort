const cancelled = () => new DOMException('CLIP cancelled', 'AbortError');
type IndexTask = { stopped: boolean; completion: Promise<void> };
type WorkerSlot<W> = { worker: W; synced: Promise<void> };
export type IndexLifecyclePhase = 'idle' | 'running' | 'stopping' | 'paused' | 'rebuilding' | 'inactive';

/** Owns the indexing task and its disposable worker; progress and vector caches live outside it. */
export class ContentIndexLifecycle<W extends { dispose: () => void }> {
  private mounted = true;
  private paused = false;
  private task?: IndexTask;
  private resetting?: Promise<void>;
  private resource?: WorkerSlot<W>;
  private generation = 0;
  get active() { return this.mounted; }
  get epoch() { return this.generation; }
  ownsEpoch(epoch: number) { return this.mounted && this.generation === epoch; }
  get running() { return this.task?.completion; }
  get rebuilding() { return !!this.resetting; }
  get stopped() { return !this.mounted || this.paused || !!this.task?.stopped; }
  get phase(): IndexLifecyclePhase {
    return !this.mounted ? 'inactive' : this.resetting ? 'rebuilding' : this.task ? this.task.stopped ? 'stopping' : 'running' : this.paused ? 'paused' : 'idle';
  }
  activate() { this.mounted = true; }
  deactivate() { this.mounted = false; this.generation++; this.pause(); this.disposeWorker(); }
  pause() {
    if (!this.task) return;
    this.paused = true; this.task.stopped = true;
  }
  disposeWorker() {
    const resource = this.resource; this.resource = undefined;
    resource?.worker.dispose();
  }
  async client(create: (owns: () => boolean) => W, synchronize: (worker: W) => Promise<void>): Promise<W> {
    if (!this.mounted) throw cancelled();
    if (!this.resource) {
      const worker = create(() => this.resource?.worker === worker && this.mounted);
      const slot = { worker, synced: Promise.resolve() };
      this.resource = slot;
      slot.synced = Promise.resolve().then(() => {
        if (this.resource !== slot) throw cancelled();
        return synchronize(worker);
      });
    }
    const slot = this.resource;
    await slot.synced;
    if (this.resource !== slot || !this.mounted) throw cancelled();
    return slot.worker;
  }
  async synchronize(update: (worker: W) => Promise<void>) {
    const slot = this.resource;
    if (!slot) return;
    slot.synced = slot.synced.then(() => {
      if (this.resource !== slot) throw cancelled();
      return update(slot.worker);
    });
    await slot.synced;
    if (this.resource !== slot || !this.mounted) throw cancelled();
  }
  async run(work: () => Promise<void>): Promise<void> {
    // Multiple Resume/reference requests share a run, including while the previous
    // paused inference drains. Rebuild must finish before another run can begin.
    while (this.resetting || this.task) {
      if (this.resetting) await this.resetting;
      else if (this.task) {
        if (!this.task.stopped) return this.task.completion;
        await this.task.completion.catch(() => {});
      }
    }
    if (!this.mounted) throw cancelled();
    this.paused = false;
    const task: IndexTask = { stopped: false, completion: Promise.resolve() };
    this.task = task;
    task.completion = Promise.resolve().then(work).finally(() => { if (this.task === task) this.task = undefined; });
    return task.completion;
  }
  async rebuild(reset: () => Promise<void>) {
    if (this.resetting) return this.resetting;
    if (!this.mounted) throw cancelled();
    this.pause();
    const previous = this.task?.completion;
    const pending = Promise.resolve().then(async () => {
      await previous?.catch(() => {});
      if (!this.mounted) throw cancelled();
      this.disposeWorker(); await reset();
    });
    this.resetting = pending;
    try { await pending; }
    finally { if (this.resetting === pending) this.resetting = undefined; }
  }
}
