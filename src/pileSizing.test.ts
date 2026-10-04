import { describe, expect, it, vi } from 'vitest';
import { pileSizeGeometry, readPileSize } from './pileSizing';

describe('resizable pile', () => {
  it('contains complete images and leaves board room across viewport changes', () => {
    for (const [width, height] of [[1440, 1000], [768, 1024], [390, 844], [320, 568], [844, 390]]) {
      for (const preferences of [{ imageSize: 112 }, { imageSize: 240, height: 500 }, { imageSize: 72, height: 150 }]) {
        const size = pileSizeGeometry(width, height, preferences);
        expect(size.paneHeight - size.head - size.grip).toBeGreaterThanOrEqual(size.imageSize + 16);
        expect(size.imageSize).toBeGreaterThanOrEqual(72);
        expect(size.paneHeight).toBeLessThanOrEqual(size.maxHeight);
        expect(height - size.paneHeight).toBeGreaterThanOrEqual(Math.min(260, Math.round(height * .46)));
      }
    }
    // A short landscape viewport clamps the display, without overwriting the
    // saved larger size needed when returning to portrait.
    const preferences = { imageSize: 240, height: 450 };
    expect(pileSizeGeometry(844, 390, preferences).imageSize).toBeLessThan(240);
    expect(pileSizeGeometry(390, 844, preferences).imageSize).toBe(240);
  });

  it('recovers from malformed preferences and keeps projects independent', () => {
    const values = new Map([
      ['folder-sort-pile:broken', 'null'],
      ['folder-sort-pile:huge', JSON.stringify({ imageSize: 5000, height: -30 })],
    ]);
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) || null });
    try {
      expect(readPileSize('broken')).toEqual({ imageSize: 112 });
      expect(readPileSize('huge')).toEqual({ imageSize: 240, height: 120 });
      expect(readPileSize('another')).toEqual({ imageSize: 112, height: undefined });
    } finally { vi.unstubAllGlobals(); }
  });
});
