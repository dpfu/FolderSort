type Point = { x: number; y: number };
type Bounds = { left: number; top: number; right: number; bottom: number };

/** Prefer above the contact, with space for a finger and the hand below it. */
export function stashPreviewPosition(point: Point, bounds: Bounds, width: number, height: number, touch: boolean): Point {
  const gap = touch ? 56 : 20;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), value));
  const fit = ({ x, y }: Point) => ({ x: clamp(x, bounds.left + 8, bounds.right - width - 8), y: clamp(y, bounds.top + 8, bounds.bottom - height - 8) });
  const centeredLeft = clamp(point.x - width / 2, bounds.left + 8, bounds.right - width - 8);
  const centeredTop = clamp(point.y - height / 2, bounds.top + 8, bounds.bottom - height - 8);
  const candidates = [
    { x: centeredLeft, y: point.y - gap - height },
    { x: point.x + gap, y: centeredTop },
    { x: point.x - gap - width, y: centeredTop },
    { x: centeredLeft, y: point.y + (touch ? 72 : gap) },
  ];
  const finger = { left: point.x - (touch ? 36 : 8), right: point.x + (touch ? 36 : 8), top: point.y - (touch ? 42 : 8), bottom: point.y + (touch ? 64 : 8) };
  const overlap = (p: Point) => Math.max(0, Math.min(p.x + width, finger.right) - Math.max(p.x, finger.left))
    * Math.max(0, Math.min(p.y + height, finger.bottom) - Math.max(p.y, finger.top));
  const fitted = candidates.map(fit);
  const preferred = candidates.find((candidate, index) => candidate.x === fitted[index].x && candidate.y === fitted[index].y && !overlap(candidate));
  const chosen = preferred || fitted.reduce((best, candidate) => overlap(candidate) < overlap(best) ? candidate : best);
  return { x: chosen.x + width / 2, y: chosen.y };
}
