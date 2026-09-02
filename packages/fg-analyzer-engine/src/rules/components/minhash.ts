/**
 * MinHash over token-shingle sets — the clone detector's engine. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/rules/components/minhash.ts:1-72`.
 *
 * Two declarations are compared as *sets of 3-token shingles* of their identifier-free AST
 * streams. Jaccard similarity of those sets survives exactly the edits a fork makes — renamed
 * variables (already erased upstream), reordered members, small insertions — and collapses
 * under a genuine rewrite. MinHash approximates that Jaccard in O(n) with a fixed-size
 * sketch, which is what keeps all-pairs comparison affordable.
 *
 * No `Math.random`: the hash family is derived from fixed odd multipliers, so sketches are
 * reproducible across runs — a requirement, since findings must be deterministic.
 *
 * **The shingle separator is `\0`, and it is load-bearing.** The hackathon's committed source
 * joins with a space (`ds-analyzer/src/rules/components/minhash.ts:46`), but its *shipped*
 * `skills/ds-audit/scripts/ds.mjs` — the runnable tool this port is measured against — joins
 * with `\0`. The two produce different shingle *strings* for the same token stream, therefore
 * different FNV hashes, therefore different sketches and different similarity estimates: on the
 * `kit-components` parity fixture the space form estimates `App`≈`Dashboard` at 0.8125 and the
 * `\0` form below the 0.8 duplicate threshold, which is one finding of difference. Neither is
 * "more correct" — MinHash is an estimator — but only one of them matches the tool, and matching
 * the tool is the acceptance test (`tests/parity.test.ts`). The engine's own 38 tests pass
 * unchanged either way: no fixture of theirs sits near a threshold.
 */

const SHINGLE_SIZE = 3;

export const SKETCH_SIZE = 64;

/** FNV-1a with a seed folded in; cheap, uniform enough for sketching. */
const hashShingle = (shingle: string, seed: number): number => {
  let state = (0x811c9dc5 ^ seed) >>> 0;

  for (let index = 0; index < shingle.length; index += 1) {
    state ^= shingle.charCodeAt(index);
    state = Math.imul(state, 0x01000193) >>> 0;
  }

  return state >>> 0;
};

/** Seeds are fixed odd constants — determinism is part of the contract. */
const SEEDS: readonly number[] = Array.from(
  { length: SKETCH_SIZE },
  (_, index) => (index * 2 + 1) * 0x9e3779b1,
);

/**
 * Streams shorter than this are not sketched at all — a 9-token styled-component template
 * would otherwise "match" every other tiny template.
 */
export const MIN_TOKENS_FOR_SKETCH = 40;

/** Builds the sketch. Returns `null` for streams too short to shingle meaningfully. */
export const buildSketch = (tokens: readonly string[]): Uint32Array | null => {
  if (tokens.length < MIN_TOKENS_FOR_SKETCH) {
    return null;
  }

  const shingles = new Set<string>();
  for (let index = 0; index + SHINGLE_SIZE <= tokens.length; index += 1) {
    shingles.add(tokens.slice(index, index + SHINGLE_SIZE).join("\0"));
  }

  const sketch = new Uint32Array(SKETCH_SIZE).fill(0xffffffff);

  for (const shingle of shingles) {
    for (let hash = 0; hash < SKETCH_SIZE; hash += 1) {
      const value = hashShingle(shingle, SEEDS[hash] ?? 0);
      if (value < (sketch[hash] ?? 0xffffffff)) {
        sketch[hash] = value;
      }
    }
  }

  return sketch;
};

/** Estimated Jaccard similarity of the underlying shingle sets, 0..1. */
export const sketchSimilarity = (left: Uint32Array, right: Uint32Array): number => {
  let agree = 0;
  for (let index = 0; index < SKETCH_SIZE; index += 1) {
    if (left[index] === right[index]) {
      agree += 1;
    }
  }
  return agree / SKETCH_SIZE;
};
