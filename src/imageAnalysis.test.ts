import { describe, expect, it } from 'vitest';
import { ANALYSIS_VERSION, findSimilar, hashDistance, hasCurrentAnalysis, isVisualAnalysis, orderByMetadata, perceptualHash, similarityOrder, type ImageMetadata } from './imageAnalysis';

function sample(brightness = 0, inverted = false) {
  const pixels = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const value = 45 + brightness + ((inverted ? x < 13 : x >= 13) && y >= 9 && y < 26 ? 120 : 0);
    const offset = (y * 32 + x) * 4;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value;
    pixels[offset + 3] = 255;
  }
  return pixels;
}

const visual = { version: ANALYSIS_VERSION, width: 240, height: 120, hash: '0000000000000000' };

describe('local perceptual image analysis', () => {
  it('matches brightness variants and differentiates changed composition', () => {
    const original = perceptualHash(sample());
    expect(original).toMatch(/^[0-9a-f]{16}$/);
    expect(hashDistance(original, perceptualHash(sample(20)))).toBeLessThanOrEqual(2);
    expect(hashDistance(original, perceptualHash(sample(0, true)))).toBeGreaterThan(16);
    expect(hashDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hashDistance('0000000000000000', '8000000000000001')).toBe(2);
  });

  it('composites transparency consistently and keeps uniform images stable', () => {
    const transparent = new Uint8ClampedArray(32 * 32 * 4);
    const white = new Uint8ClampedArray(32 * 32 * 4).fill(255);
    expect(perceptualHash(transparent)).toBe(perceptualHash(white));
    expect(perceptualHash(white)).toBe('0000000000000000');
  });

  it('orders visual neighbors using distance rather than sorting hash strings', async () => {
    const images = [
      { id: 'a', hash: '0000000000000000' },
      { id: 'b', hash: '00000000ffffffff' },
      { id: 'c', hash: '8000000000000000' },
      { id: 'd', hash: '00000000fffffffe' },
    ];
    expect(await similarityOrder(images)).toEqual(['a', 'c', 'd', 'b']);
    expect(await similarityOrder([])).toEqual([]);
    expect(images.map((image) => image.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('finds the nearest board reference, excludes seeds, and rejects distant matches', () => {
    const a = { id: 'a', hash: '0000000000000000' }, b = { id: 'b', hash: 'ffffffffffffffff' };
    expect(findSimilar([a, b, { id: 'near-a', hash: '0000000000000001' }, { id: 'near-b', hash: 'fffffffffffffffc' },
      { id: 'unrelated', hash: '00000000ffffffff' }], [a, b], 3)).toEqual([
      { id: 'near-a', referenceId: 'a', distance: 1 },
      { id: 'near-b', referenceId: 'b', distance: 2 },
    ]);
    expect(findSimilar([b], [a], 3)).toEqual([]);
    expect(findSimilar([a], [], 3)).toEqual([]);
  });

  it('accepts versioned metadata and detects caches requiring reanalysis', () => {
    expect(hasCurrentAnalysis(visual)).toBe(true);
    expect(isVisualAnalysis({ ...visual, version: ANALYSIS_VERSION + 1 })).toBe(true);
    expect(hasCurrentAnalysis({ ...visual, version: ANALYSIS_VERSION + 1 })).toBe(false);
    expect(isVisualAnalysis({ ...visual, hash: 'bad' })).toBe(false);
    expect(isVisualAnalysis({ ...visual, width: Infinity })).toBe(false);
  });

  it('keeps missing dates/dimensions last without inventing an import or creation date', () => {
    const images = [{ id: 'a', path: 'image-10.jpg', size: 400 }, { id: 'b', path: 'image-2.jpg', size: 200 }, { id: 'c', path: 'undated.jpg', size: 800 }];
    const metadata = new Map<string, ImageMetadata>([
      ['a', { fileModifiedAt: 200, visual }],
      ['b', { fileModifiedAt: 100, visual: { ...visual, width: 120, height: 240 } }],
      ['c', { fileModifiedAt: null }],
    ]);
    const ids = (mode: 'modified' | 'bytes' | 'resolution' | 'aspect' | 'name', reverse = false) => orderByMetadata(images, mode, metadata, reverse).map((image) => image.id);
    expect(ids('modified')).toEqual(['b', 'a', 'c']);
    expect(ids('modified', true)).toEqual(['a', 'b', 'c']);
    expect(ids('bytes')).toEqual(['c', 'a', 'b']);
    expect(ids('bytes', true)).toEqual(['b', 'a', 'c']);
    expect(ids('aspect')).toEqual(['b', 'a', 'c']);
    expect(ids('aspect', true)).toEqual(['a', 'b', 'c']);
    expect(ids('name')).toEqual(['b', 'a', 'c']);
    expect(images[0].id).toBe('a');
  });
});
