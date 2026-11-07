import { RequestOwner } from './requestOwner';
export type TaskState =
  | { phase: 'idle' | 'running'; error: '' }
  | { phase: 'error'; error: string };

/** UI projection and synchronous ownership for exclusive or latest-result jobs. */
export class AsyncTask {
  private owner = new RequestOwner();
  private state: TaskState = { phase: 'idle', error: '' };
  private listeners = new Set<() => void>();
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get active() {
    return this.owner.isActive;
  }
  get running() {
    return this.state.phase === 'running';
  }
  private publish(state: TaskState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  activate() {
    this.owner.activate();
  }
  deactivate() {
    this.owner.deactivate();
    this.state = { phase: 'idle', error: '' };
  }
  begin(policy: 'exclusive' | 'replace' = 'exclusive') {
    if (!this.active || (policy === 'exclusive' && this.running)) return;
    const ticket = this.owner.begin();
    this.publish({ phase: 'running', error: '' });
    return ticket;
  }
  owns(ticket: object) {
    return this.owner.owns(ticket);
  }
  complete(ticket: object) {
    if (!this.owns(ticket)) return false;
    this.owner.finish(ticket);
    this.publish({ phase: 'idle', error: '' });
    return true;
  }
  fail(ticket: object, cause: unknown) {
    if (!this.owns(ticket)) return false;
    this.owner.finish(ticket);
    this.publish({ phase: 'error', error: cause instanceof Error ? cause.message : String(cause) });
    return true;
  }
  cancel() {
    this.owner.invalidate();
    if (this.state.phase !== 'idle') this.publish({ phase: 'idle', error: '' });
  }
}
