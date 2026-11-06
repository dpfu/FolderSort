import { expect, it } from 'vitest';
import { CameraPlacement } from './cameraPlacement';
it('keeps an explicit camera request through intermediate resize observations and rejects stale releases', () => {
  const camera = new CameraPlacement(), requested = { x: 21, y: 299 };
  const first = camera.begin(requested, { x: 0, y: 0 });
  camera.observe({ x: 0, y: 299 });
  const reflow = camera.begin(requested, { x: 0, y: 0 });
  expect(reflow.target).toBe(requested); expect(camera.finish(first, { x: 0, y: 299 })).toBe(false);
  expect(camera.finish(reflow, requested)).toBe(true);
  camera.observe({ x: 100, y: 200 });
  expect(camera.begin(requested, requested).target).toEqual({ x: 100, y: 200 });
});
it('allows deliberate movement to supersede a pending placement without a late snap back', () => {
  const camera = new CameraPlacement(), requested = { x: 100, y: 200 };
  const pending = camera.begin(requested, requested);
  camera.interrupt({ x: 140, y: 230 });
  expect(camera.owns(pending)).toBe(false); expect(camera.finish(pending, requested)).toBe(false);
  expect(camera.begin(requested, requested).target).toEqual({ x: 140, y: 230 });
});
