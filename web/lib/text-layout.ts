/**
 * Text-layout recognition fingerprint (Layer 1.5). A flat upload's exact-byte
 * content hash misses on any re-saved / re-exported copy — but such copies keep
 * the same VISIBLE TEXT. So we fingerprint the extracted text with MinHash and
 * recognize a known form by Jaccard text similarity, then apply that form's
 * exact catalog placement (no vision, no recall gap).
 *
 * MinHash gives a compact (128-int) signature whose agreement fraction estimates
 * the Jaccard similarity of the two forms' text-shingle sets — a 0..1 confidence
 * for a clean threshold. Everything here is PURE + deterministic (same text →
 * same signature every process), so signatures compare across machines/time.
 *
 * Text EXTRACTION is the caller's job (poppler in the eval; a JS extractor like
 * pdfjs when wired for prod) — this module only consumes the text string.
 */

export const NUM_HASHES = 128;
const SHINGLE_K = 5; // 5-word shingles: form-specific phrasing, robust to byte/whitespace noise
const MAX32 = 0xffffffff;

// FNV-1a 32-bit — hash a shingle string to an int.
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Fixed, deterministic permutation coefficients (seeded LCG) — generated once at
// module load, identical every process, so signatures are comparable forever.
const COEFFS: Array<[number, number]> = (() => {
  let seed = 0x9e3779b9 >>> 0;
  const next = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed;
  };
  const out: Array<[number, number]> = [];
  for (let i = 0; i < NUM_HASHES; i++) out.push([next() | 1, next()]); // a odd, b any
  return out;
})();

/** Normalize text + emit the set of k-word shingle hashes. */
export function textShingles(text: string, k = SHINGLE_K): number[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < k) {
    // Too little text for k-grams — fall back to single words so a tiny doc still
    // produces *some* signal (it just won't match a big form).
    return [...new Set(words.map((w) => fnv1a(w)))];
  }
  const set = new Set<number>();
  for (let i = 0; i + k <= words.length; i++) {
    set.add(fnv1a(words.slice(i, i + k).join(" ")));
  }
  return [...set];
}

/** MinHash signature (NUM_HASHES ints) of a shingle-hash set. */
export function minhash(shingleHashes: number[]): number[] {
  const sig = new Array<number>(NUM_HASHES).fill(MAX32);
  for (const x of shingleHashes) {
    for (let i = 0; i < NUM_HASHES; i++) {
      const [a, b] = COEFFS[i];
      const h = (Math.imul(a, x) + b) >>> 0;
      if (h < sig[i]) sig[i] = h;
    }
  }
  return sig;
}

/** Full text → MinHash signature. */
export function computeTextFingerprint(text: string): number[] {
  return minhash(textShingles(text));
}

/** Estimated Jaccard similarity (0..1) = fraction of agreeing signature slots. */
export function jaccard(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let eq = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) eq++;
  return eq / a.length;
}
