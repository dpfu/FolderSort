/** Request bookkeeping only. Each client retains its own timeout/fallback/disposal policy. */
export class WorkerRequests<T> {
  private serial = 0;
  private jobs = new Map<
    number,
    {
      resolve: (value: T) => void;
      reject: (cause: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  get size() {
    return this.jobs.size;
  }
  request(send: (id: number) => void, timeout: number, expire: () => void): Promise<T> {
    const id = ++this.serial;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(expire, timeout);
      this.jobs.set(id, { resolve, reject, timer });
      try {
        send(id);
      } catch (cause) {
        this.settle(id, undefined, cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
  }
  settle(id: number, value: T | undefined, error?: Error) {
    const job = this.jobs.get(id);
    if (!job) return false;
    this.jobs.delete(id);
    clearTimeout(job.timer);
    if (error) job.reject(error);
    else job.resolve(value!);
    return true;
  }
  rejectAll(error: Error) {
    for (const id of this.jobs.keys()) this.settle(id, undefined, error);
  }
}
