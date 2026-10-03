/** Versioned because changing preprocessing invalidates existing hashes. */
export const ANALYSIS_VERSION = 1;
export const HASH_SAMPLE_SIZE = 32;
// An exploratory visual match, not proof that two originals are duplicates.
export const CLOSE_MATCH_DISTANCE = 16;

export type VisualAnalysis = { version: number; width: number; height: number; hash: string };
export type ImageMetadata = {
  visual?: VisualAnalysis;
  clip?: import('./contentSimilarity').ContentAnalysis;
  // An undecodable immutable original should not force a model reload every
  // visit. This marker is tied to the same model/preprocessing version.
  clipSkipped?: string;
  fileModifiedAt?: number | null;
};
export type HashedImage = { id: string; hash: string };
export type SimilarMatch = { id: string; referenceId: string; distance: number };
export type PileOrder = 'random' | 'similarity' | 'semantic' | 'modified' | 'bytes' | 'resolution' | 'aspect' | 'name';
const comparePaths = new Intl.Collator(undefined, { numeric: true }).compare;

export function isVisualAnalysis(value: unknown): value is VisualAnalysis {
  if (!value || typeof value !== 'object') return false;
  const analysis = value as VisualAnalysis;
  return Number.isInteger(analysis.version) && analysis.version > 0 &&
    Number.isInteger(analysis.width) && analysis.width > 0 && analysis.width <= 100_000 &&
    Number.isInteger(analysis.height) && analysis.height > 0 && analysis.height <= 100_000 &&
    typeof analysis.hash === 'string' && /^[0-9a-f]{16}$/.test(analysis.hash);
}

export function hasCurrentAnalysis(value: unknown): value is VisualAnalysis {
  return isVisualAnalysis(value) && value.version === ANALYSIS_VERSION;
}

const cosines = Array.from({ length: 8 }, (_, frequency) =>
  Float64Array.from({ length: HASH_SAMPLE_SIZE }, (_, pixel) => Math.cos(Math.PI * (2 * pixel + 1) * frequency / (2 * HASH_SAMPLE_SIZE))));

/** DCT pHash from a 32×32 RGBA sample. Alpha is composited onto white. */
export function perceptualHash(rgba: ArrayLike<number>): string {
  const size = HASH_SAMPLE_SIZE;
  if (rgba.length !== size * size * 4) throw new Error('Expected a 32×32 image sample');
  const gray = new Float64Array(size * size);
  for (let pixel = 0; pixel < gray.length; pixel++) {
    const offset = pixel * 4;
    const alpha = rgba[offset + 3] / 255;
    gray[pixel] = (.299 * rgba[offset] + .587 * rgba[offset + 1] + .114 * rgba[offset + 2]) * alpha + 255 * (1 - alpha);
  }
  // Two separable passes keep this small enough for the canvas fallback too.
  const rows = new Float64Array(size * 8);
  for (let y = 0; y < size; y++) for (let u = 0; u < 8; u++) {
    for (let x = 0; x < size; x++) rows[y * 8 + u] += gray[y * size + x] * cosines[u][x];
  }
  const coefficients = new Float64Array(64);
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
    let value = 0;
    for (let y = 0; y < size; y++) value += rows[y * 8 + u] * cosines[v][y];
    value *= (u ? 1 : Math.SQRT1_2) * (v ? 1 : Math.SQRT1_2);
    // Avoid platform-dependent roundoff bits on uniform/low-detail images.
    coefficients[v * 8 + u] = Math.abs(value) < 1e-7 ? 0 : value;
  }
  // Ignore DC (overall brightness); keep its bit zero in the stored 64-bit hash.
  const median = [...coefficients.slice(1)].sort((a, b) => a - b)[31];
  let high = 0;
  let low = 0;
  for (let bit = 1; bit < 64; bit++) {
    if (coefficients[bit] <= median) continue;
    if (bit < 32) high |= 1 << (31 - bit);
    else low |= 1 << (63 - bit);
  }
  return (high >>> 0).toString(16).padStart(8, '0') + (low >>> 0).toString(16).padStart(8, '0');
}

function popcount(value: number): number {
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function words(hash: string): [number, number] {
  return [Number.parseInt(hash.slice(0, 8), 16), Number.parseInt(hash.slice(8), 16)];
}

function wordDistance(a: [number, number], b: [number, number]): number {
  return popcount(a[0] ^ b[0]) + popcount(a[1] ^ b[1]);
}

export function hashDistance(a: string, b: string): number {
  return wordDistance(words(a), words(b));
}

/** Arrange neighbors by actual Hamming distance, not the numeric hash value.
 * Input order is the stable tie breaker. Run the O(n²) walk in a worker. */
export async function similarityOrder(images: HashedImage[], yieldWork?: () => Promise<void>): Promise<string[]> {
  const hashes = images.map((image) => words(image.hash));
  const used = new Uint8Array(images.length);
  const order: string[] = [];
  let current = 0;
  for (let step = 0; step < images.length; step++) {
    used[current] = 1;
    order.push(images[current].id);
    let next = -1;
    let nearest = Infinity;
    for (let index = 0; index < images.length; index++) {
      if (used[index]) continue;
      const distance = wordDistance(hashes[current], hashes[index]);
      if (distance < nearest) { nearest = distance; next = index; }
      if (distance === 0) break;
    }
    if (next < 0) break;
    current = next;
    if (yieldWork && step % 64 === 0) await yieldWork();
  }
  return order;
}

/** For several board references, use the nearest individual reference. */
export function findSimilar(candidates: HashedImage[], references: HashedImage[], limit: number, maxDistance = CLOSE_MATCH_DISTANCE): SimilarMatch[] {
  const referenceIds = new Set(references.map((image) => image.id));
  const referenceHashes = references.map((image) => ({ ...image, words: words(image.hash) }));
  const matches: SimilarMatch[] = [];
  for (const candidate of candidates) {
    if (referenceIds.has(candidate.id)) continue;
    const hash = words(candidate.hash);
    let distance = Infinity;
    let referenceId = '';
    for (const reference of referenceHashes) {
      const next = wordDistance(hash, reference.words);
      if (next < distance) { distance = next; referenceId = reference.id; }
      if (!distance) break;
    }
    if (distance <= maxDistance) matches.push({ id: candidate.id, referenceId, distance });
  }
  return matches.sort((a, b) => a.distance - b.distance).slice(0, limit);
}

export function orderByMetadata<T extends { id: string; path: string; size: number }>(
  images: T[], order: Exclude<PileOrder, 'random' | 'similarity'>, metadata: Map<string, ImageMetadata>, reverse = false,
): T[] {
  const value = (image: T): number | undefined => {
    const meta = metadata.get(image.id);
    if (order === 'modified') return meta?.fileModifiedAt ?? undefined;
    if (order === 'bytes') return image.size;
    if (!hasCurrentAnalysis(meta?.visual)) return undefined;
    return order === 'resolution' ? meta.visual.width * meta.visual.height : meta.visual.width / meta.visual.height;
  };
  const values = order === 'name' ? new Map<string, number | undefined>() : new Map(images.map((image) => [image.id, value(image)]));
  const direction = (order === 'bytes' || order === 'resolution' ? -1 : 1) * (reverse ? -1 : 1);
  return [...images].sort((a, b) => {
    if (order === 'name') return comparePaths(a.path, b.path) * direction;
    const av = values.get(a.id), bv = values.get(b.id);
    // Missing metadata always goes last, even when the direction is reversed.
    if (av === undefined || bv === undefined) return av === bv ? comparePaths(a.path, b.path) : av === undefined ? 1 : -1;
    return (av - bv) * direction || comparePaths(a.path, b.path);
  });
}

export type AnalysisJob =
  | { kind: 'analyze'; blob: Blob }
  | { kind: 'pixels'; pixels: Uint8ClampedArray; width: number; height: number }
  | { kind: 'order'; images: HashedImage[] }
  | { kind: 'similar'; candidates: HashedImage[]; references: HashedImage[]; limit: number };
export type AnalysisResult = VisualAnalysis | string[] | SimilarMatch[];
