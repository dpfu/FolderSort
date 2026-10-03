import { describe, expect, it } from 'vitest';
import { CLIP_CACHE_KEY, contentMatches, contentOrder, hasCurrentContent, isContentAnalysis, normalizeVector, packVector, unpackVector } from './contentSimilarity';

const vector = (axis: number, nearby = 0) => normalizeVector(Float32Array.from({ length: 512 }, (_, i) => i === axis ? 1 : i === axis + 1 ? nearby : 0));

describe('content similarity', () => {
  it('ranks related content against the closest reference and excludes references themselves', () => {
    const a = { id: 'cat', vector: vector(0) }, b = { id: 'car', vector: vector(10) };
    const candidates = [a, b, { id: 'other-cat', vector: vector(0, .1) }, { id: 'other-car', vector: vector(10, .3) }, { id: 'unrelated', vector: vector(30) }];
    const matches = contentMatches(candidates, [a, b], 2);
    expect(matches.map((match) => [match.id, match.referenceId])).toEqual([['other-cat', 'cat'], ['other-car', 'car']]);
    expect(matches[0].distance).toBeLessThan(matches[1].distance);
    expect(contentMatches(candidates, [], 5)).toEqual([]);
  });

  it('preserves complete groups and determinism when large ordering uses a shortlist', () => {
    const images = Array.from({ length: 320 }, (_, index) => ({ id: `group-${index % 8}-${index}`, vector: vector((index % 8) * 20) }));
    const ordered = contentOrder(images);
    expect(new Set(ordered).size).toBe(320);
    const groups = ordered.map((id) => id.split('-')[1]);
    expect(groups.filter((group, index) => !index || group !== groups[index - 1])).toHaveLength(8);
    expect(contentOrder(images)).toEqual(ordered);
  });

  it('refines the projected shortlist with full vectors for a large board query', () => {
    const references = Array.from({ length: 100 }, (_, index) => ({ id: `reference-${index}`, vector: vector(index * 4) }));
    const candidates = Array.from({ length: 800 }, (_, index) => ({ id: `candidate-${index}`, vector: vector((index % 100) * 4, .05) }));
    const matches = contentMatches(candidates, references, 5);
    expect(matches).toHaveLength(5);
    for (const match of matches) {
      const index = Number(match.id.split('-')[1]);
      expect(match.referenceId).toBe(`reference-${index % 100}`);
      expect(match.distance).toBeLessThan(.002);
    }
  });

  it('round-trips compact portable vectors and rejects invalid or incompatible cached data', () => {
    const original = vector(20, .3), packed = packVector(original);
    expect(unpackVector(packed)).toEqual(original);
    expect(isContentAnalysis(packed)).toBe(true);
    expect(hasCurrentContent(packed)).toBe(true);
    expect(hasCurrentContent({ ...packed, model: 'different-model:v1' })).toBe(false);
    expect(isContentAnalysis({ ...packed, vector: 'bad' })).toBe(false);
    expect(isContentAnalysis({ ...packed, model: '../invalid model' })).toBe(false);
    expect(isContentAnalysis(packVector(new Float32Array(512)))).toBe(false);
    const invalid = original.slice(); invalid[2] = NaN;
    expect(isContentAnalysis(packVector(invalid))).toBe(false);
    expect(() => normalizeVector(new Float32Array(512))).toThrow('Invalid CLIP');
    expect(packed.model).toBe(CLIP_CACHE_KEY);
  });
});
