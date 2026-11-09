import { expect, it } from 'vitest';
import { CardDragSession } from './cardDragSession';
it('lets quick release complete once and rejects a late Motion start/end', () => {
  const drag = new CardDragSession(); drag.press(true);
  expect(drag.quickRelease()).toBe(true); expect(drag.start()).toBe(false); expect(drag.complete()).toBe(false);
  expect(drag.dragged).toBe(true); expect(drag.selectedOnPress).toBe(true);
});
it('keeps Motion ownership, deduplicates cancellation and starts a fresh press', () => {
  const drag = new CardDragSession(); drag.press(false); drag.start();
  expect(drag.quickRelease()).toBe(false); expect(drag.cancel()).toBe(true); expect(drag.cancel()).toBe(false); expect(drag.complete()).toBe(false);
  drag.press(true); expect(drag.dragged).toBe(false); expect(drag.start()).toBe(true); expect(drag.complete()).toBe(true); expect(drag.complete()).toBe(false);
});
