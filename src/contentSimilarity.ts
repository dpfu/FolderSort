// Pin both weights and preprocessing: cached vectors must stay comparable.
export const CLIP_MODEL = 'Xenova/mobileclip_s0';
export const CLIP_REVISION = '757d59c9c6870a76a4b0306f05f5061bca15c39f';
export const CLIP_DIMENSIONS = 512;
export const CLIP_CACHE_KEY = `${CLIP_MODEL}@${CLIP_REVISION}:fp32:white-512:v1`;
export type ContentAnalysis = { model: string; vector: string };
export type EmbeddedImage = { id: string; vector: Float32Array };
export type ContentMatch = { id: string; referenceId: string; distance: number };
export type ClipProgress = { phase: 'loading' | 'ready'; percent?: number };
export type ClipJob =
  | { kind: 'init' }
  | { kind: 'embed'; id: string; blob: Blob }
  | { kind: 'pixels'; id: string; pixels: Uint8ClampedArray; width: number; height: number }
  | { kind: 'cache'; images: Array<{ id: string; clip: ContentAnalysis }> }
  | { kind: 'order'; ids: string[] }
  | { kind: 'similar'; candidates: string[]; references: string[]; limit: number };
export type ClipResult = ContentAnalysis | string[] | ContentMatch[] | null;

export function normalizeVector(values: ArrayLike<number>): Float32Array {
  if (values.length !== CLIP_DIMENSIONS) throw new Error('Unexpected CLIP embedding size');
  let norm = 0;
  for (let i = 0; i < values.length; i++) norm += values[i] * values[i];
  if (!Number.isFinite(norm) || norm < 1e-12) throw new Error('Invalid CLIP embedding');
  const scale = 1 / Math.sqrt(norm);
  return Float32Array.from(values, (value) => value * scale);
}

// Native byte/base64 conversion avoids a JS callback for every embedding byte.
// Keep portable fallbacks for browsers without these TypedArray additions.
const byteCodec = Uint8Array as typeof Uint8Array & { fromBase64?: (value: string, options?: { lastChunkHandling: 'strict' }) => Uint8Array };
const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

export function packVector(vector: Float32Array): ContentAnalysis {
  let bytes: Uint8Array;
  if (littleEndian) bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
  else {
    bytes = new Uint8Array(vector.length * 4);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < vector.length; i++) view.setFloat32(i * 4, vector[i], true);
  }
  const native = bytes as Uint8Array & { toBase64?: () => string };
  // A CLIP vector is only 2,048 bytes, safely below argument-count limits.
  return { model: CLIP_CACHE_KEY, vector: native.toBase64 ? native.toBase64() : btoa(String.fromCharCode(...bytes)) };
}

export function unpackVector(analysis: ContentAnalysis): Float32Array {
  let bytes: Uint8Array;
  if (byteCodec.fromBase64) bytes = byteCodec.fromBase64(analysis.vector, { lastChunkHandling: 'strict' });
  else {
    const binary = atob(analysis.vector);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  }
  if (bytes.byteLength !== CLIP_DIMENSIONS * 4) throw new Error('Invalid CLIP embedding size');
  if (littleEndian && bytes.byteOffset % 4 === 0) return new Float32Array(bytes.buffer, bytes.byteOffset, CLIP_DIMENSIONS);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = new Float32Array(CLIP_DIMENSIONS);
  for (let i = 0; i < result.length; i++) result[i] = view.getFloat32(i * 4, true);
  return result;
}

export function isContentAnalysis(value: unknown): value is ContentAnalysis {
  if (!value || typeof value !== 'object') return false;
  const analysis = value as ContentAnalysis;
  if (typeof analysis.model !== 'string' || analysis.model.length > 200 ||
      !/^[\w/@:.-]+$/.test(analysis.model) || typeof analysis.vector !== 'string' ||
      analysis.vector.length !== 2732 || (!byteCodec.fromBase64 && !/^[A-Za-z0-9+/]+=$/.test(analysis.vector))) return false;
  try {
    // Exact encoded/decoded lengths and strict native padding validation
    // reject whitespace and malformed base64 without scanning it again in JS.
    const vector = unpackVector(analysis);
    let norm = 0;
    for (const number of vector) {
      if (!Number.isFinite(number) || Math.abs(number) > 1.001) return false;
      norm += number * number;
    }
    return Math.abs(norm - 1) < .01;
  } catch { return false; }
}

export function hasCurrentContent(analysis: ContentAnalysis | undefined): analysis is ContentAnalysis {
  return analysis?.model === CLIP_CACHE_KEY && isContentAnalysis(analysis);
}

function dot(left: Float32Array, right: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < left.length; i++) sum += left[i] * right[i];
  return sum;
}

// A deterministic random projection is only a shortlist. Final scores always use
// all 512 dimensions. This bounds work when thousands of images are on the board.
const PROJECTED_DIMENSIONS = 32;
let projection: Int8Array | undefined;
function project(vector: Float32Array): Float32Array {
  if (!projection) {
    projection = new Int8Array(PROJECTED_DIMENSIONS * CLIP_DIMENSIONS);
    let seed = 0x6d2b79f5;
    for (let i = 0; i < projection.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      projection[i] = seed & 1 ? 1 : -1;
    }
  }
  const result = new Float32Array(PROJECTED_DIMENSIONS);
  let norm = 0;
  for (let row = 0; row < result.length; row++) {
    let sum = 0;
    for (let col = 0; col < vector.length; col++) sum += vector[col] * projection[row * CLIP_DIMENSIONS + col];
    result[row] = sum; norm += sum * sum;
  }
  const scale = norm > 1e-12 ? 1 / Math.sqrt(norm) : 1;
  for (let i = 0; i < result.length; i++) result[i] *= scale;
  return result;
}

export function contentMatches(candidates: EmbeddedImage[], references: EmbeddedImage[], limit: number): ContentMatch[] {
  if (!references.length || limit < 1) return [];
  const referenceIds = new Set(references.map((image) => image.id));
  const pool = candidates.filter((image) => !referenceIds.has(image.id));
  const rank = (images: EmbeddedImage[], refs: EmbeddedImage[]) => images.map((image) => {
    let score = -Infinity, referenceId = '';
    for (const reference of refs) {
      const similarity = dot(image.vector, reference.vector);
      if (similarity > score) { score = similarity; referenceId = reference.id; }
    }
    return { id: image.id, referenceId, distance: 1 - Math.max(-1, Math.min(1, score)) };
  }).sort((a, b) => a.distance - b.distance);
  if (pool.length * references.length * CLIP_DIMENSIONS <= 32_000_000) return rank(pool, references).slice(0, limit);
  const shortlistIds = new Set(rank(pool.map((image) => ({ ...image, vector: project(image.vector) })),
    references.map((image) => ({ ...image, vector: project(image.vector) }))).slice(0, Math.max(48, limit * 12)).map((match) => match.id));
  return rank(pool.filter((image) => shortlistIds.has(image.id)), references).slice(0, limit);
}

/** Greedy neighbour walk. Large datasets use a four-item projected shortlist,
 * refined with full vectors, instead of an expensive 512-dimensional all-pairs
 * matrix. No matrix is allocated, and tie order remains deterministic. */
export function contentOrder(images: EmbeddedImage[]): string[] {
  if (images.length < 2) return images.map((image) => image.id);
  const vectors = images.length <= 256 ? images.map((image) => image.vector) : images.map((image) => project(image.vector));
  const used = new Uint8Array(images.length);
  const result: string[] = [];
  let current = 0;
  for (let step = 0; step < images.length; step++) {
    used[current] = 1;
    result.push(images[current].id);
    if (step === images.length - 1) break;
    const bestIndices = [-1, -1, -1, -1], bestScores = [-Infinity, -Infinity, -Infinity, -Infinity];
    for (let index = 0; index < images.length; index++) {
      if (used[index]) continue;
      const score = dot(vectors[current], vectors[index]);
      if (score <= bestScores[3]) continue;
      let position = 3;
      while (position > 0 && score > bestScores[position - 1]) {
        bestIndices[position] = bestIndices[position - 1]; bestScores[position] = bestScores[position - 1]; position--;
      }
      bestIndices[position] = index; bestScores[position] = score;
    }
    let next = bestIndices[0], score = -Infinity;
    for (const index of bestIndices) {
      if (index < 0) continue;
      const exact = dot(images[current].vector, images[index].vector);
      if (exact > score) { score = exact; next = index; }
    }
    current = next;
  }
  return result;
}
