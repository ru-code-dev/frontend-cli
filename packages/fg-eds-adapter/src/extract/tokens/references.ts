/**
 * Parser for the kit's token-reference syntax.
 *
 * Authored values point at other tiers with brace templates produced by
 * `makeTemplates()`:
 *
 *   '{edsRef.palette.pink.pink500}'                 — a plain alias
 *   'rgba({edsRef.palette.white},0.06)'             — an alias with an alpha overlay
 *   '0px 1px 2px 0px rgba(10,22,43,0.1), 0px …'     — a literal, no references
 *
 * Preserving these edges (rather than only the resolved value) is what makes the
 * artifact able to answer "which tier does this component token depend on?", which
 * in turn powers the ref-used-instead-of-sys rule in the deviation analyser.
 */

export const REFERENCE_TIERS = ["edsRef", "edsSys"] as const;

export type ReferenceTier = (typeof REFERENCE_TIERS)[number];

export interface TokenReference {
  /** Verbatim template including braces, e.g. `{edsRef.palette.pink.pink500}`. */
  readonly raw: string;
  readonly tier: ReferenceTier;
  /** Path within the tier, e.g. `palette.pink.pink500`. */
  readonly path: string;
  readonly segments: string[];
  /**
   * Alpha applied on top of the referenced colour when the reference is wrapped in
   * `rgba(...)`, expressed as 0-1. `null` for plain aliases.
   */
  readonly alpha: number | null;
}

const REFERENCE_PATTERN = /\{([A-Za-z][\w$]*)\.([^{}]+)\}/g;

/** Matches `rgba( {ref} , 0.06 )` — the only wrapper form the kit uses. */
const RGBA_WRAPPED_PATTERN = /rgba\(\s*(\{[^{}]+\})\s*,\s*([0-9.]+)\s*\)/g;

const isReferenceTier = (value: string): value is ReferenceTier =>
  (REFERENCE_TIERS as readonly string[]).includes(value);

/**
 * Extracts every token reference contained in an authored value.
 *
 * Non-string inputs and plain literals yield an empty list, so callers can treat
 * "no references" and "not a reference-bearing value" identically.
 */
export const parseReferences = (input: unknown): TokenReference[] => {
  if (typeof input !== "string") {
    return [];
  }

  // Alpha overlays are collected first so the plain-alias pass can skip them.
  const alphaByRaw = new Map<string, number>();
  for (const match of input.matchAll(RGBA_WRAPPED_PATTERN)) {
    const raw = match[1];
    const alpha = Number.parseFloat(match[2] ?? "");
    if (raw !== undefined && Number.isFinite(alpha)) {
      alphaByRaw.set(raw, alpha);
    }
  }

  const references: TokenReference[] = [];

  for (const match of input.matchAll(REFERENCE_PATTERN)) {
    const [raw, tier, path] = match;
    if (raw === undefined || tier === undefined || path === undefined || !isReferenceTier(tier)) {
      continue;
    }

    references.push({
      raw,
      tier,
      path,
      segments: path.split("."),
      alpha: alphaByRaw.get(raw) ?? null,
    });
  }

  return references;
};

/** `true` when the authored value is a single reference and nothing else. */
export const isPureAlias = (input: unknown): boolean => {
  if (typeof input !== "string") {
    return false;
  }

  const references = parseReferences(input);

  return references.length === 1 && references[0]?.raw === input.trim();
};

/** `true` when the authored value contains at least one unresolved reference. */
export const hasUnresolvedReference = (input: unknown): boolean =>
  parseReferences(input).length > 0;
