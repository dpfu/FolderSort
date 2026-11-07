type Point = { x: number; y: number };
type Hold = { targetId: string; point: Point; ready: boolean; serial: number };
/** One hold owns the timer; leaving or replacing its target invalidates completion. */
export class HoldToGroup {
  current?: Hold;
  private timer?: ReturnType<typeof setTimeout>;
  private serial = 0;
  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.current = undefined;
  }
  prepare(
    targetId: string | null,
    point: Point,
    slop: number,
    delay: number,
    valid: () => boolean,
    changed: (hold: Hold | undefined) => void,
  ) {
    const current = this.current;
    if (
      targetId &&
      current?.targetId === targetId &&
      Math.hypot(point.x - current.point.x, point.y - current.point.y) <= slop
    )
      return;
    this.cancel();
    if (!targetId) {
      changed(undefined);
      return;
    }
    const hold: Hold = { targetId, point, ready: false, serial: ++this.serial };
    this.current = hold;
    changed(hold);
    this.timer = setTimeout(() => {
      if (this.current !== hold) return;
      if (!valid()) {
        this.cancel();
        changed(undefined);
        return;
      }
      this.current = { ...hold, ready: true };
      changed(this.current);
    }, delay);
  }
}
