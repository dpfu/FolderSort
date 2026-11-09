/** A channel owns one current request. Invalidating it never cancels unrelated work. */
export class RequestOwner {
  private active = true;
  private current?: object;
  get isActive() {
    return this.active;
  }
  activate() {
    this.active = true;
  }
  deactivate() {
    this.active = false;
    this.invalidate();
  }
  invalidate() {
    this.current = undefined;
  }
  begin() {
    const ticket = {};
    this.current = ticket;
    return ticket;
  }
  owns(ticket: object) {
    return this.active && this.current === ticket;
  }
  finish(ticket: object) {
    if (this.owns(ticket)) this.current = undefined;
  }
}
