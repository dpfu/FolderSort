/** Metadata needs are serial, not shared: a color request must fill gaps after a date request. */
export class AnalysisSession<C extends { dispose: () => void }> {
  private mounted = true;
  private initialized = false;
  private current?: Promise<void>;
  private resource?: C;
  private generation = 0;
  get active() {
    return this.mounted;
  }
  get hydrated() {
    return this.initialized;
  }
  get phase() {
    return !this.mounted
      ? 'disposed'
      : this.current
        ? 'indexing'
        : this.initialized
          ? 'ready'
          : 'cold';
  }
  activate() {
    this.mounted = true;
  }
  deactivate() {
    this.mounted = false;
    this.generation++;
    this.current = undefined;
    this.resource?.dispose();
    this.resource = undefined;
  }
  markHydrated() {
    this.initialized = true;
  }
  invalidateHydration() {
    this.initialized = false;
  }
  client(create: () => C) {
    if (!this.mounted) throw new DOMException('Analysis cancelled', 'AbortError');
    return (this.resource ||= create());
  }
  async run(work: (valid: () => boolean) => Promise<void>) {
    const generation = this.generation;
    const valid = () => this.mounted && generation === this.generation;
    // Drain the previous request without inheriting its failure. Each queued
    // metadata need owns its own result; the original caller still sees errors.
    while (this.current) await this.current.catch(() => {});
    if (!valid()) throw new DOMException('Analysis cancelled', 'AbortError');
    const task = Promise.resolve().then(() => work(valid));
    this.current = task;
    try {
      await task;
    } finally {
      if (this.current === task) this.current = undefined;
    }
  }
}
