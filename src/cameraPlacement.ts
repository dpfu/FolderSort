type Point = { x: number; y: number };
/** Programmatic placement owns its target until layout settles; observation cannot steal it. */
export class CameraPlacement {
  private requested?: Point;
  private observed?: Point;
  private pending?: { target: Point };
  get center() { return this.pending?.target || this.observed; }
  get placing() { return !!this.pending; }
  begin(requested: Point | undefined, fallback: Point) {
    const target = requested && requested !== this.requested ? requested : this.pending?.target || this.observed || requested || fallback;
    this.requested = requested;
    return this.pending = { target };
  }
  observe(point: Point) { if (!this.pending) this.observed = point; }
  finish(task: { target: Point }, actual: Point) {
    if (this.pending !== task) return false;
    this.pending = undefined; this.observed = actual; return true;
  }
  owns(task: { target: Point }) { return this.pending === task; }
}
