/**
 * Deterministic JSON.
 *
 * Object keys are emitted in sorted order at every depth, so two runs over the same kit — in
 * any order, on any machine — produce byte-identical output. Arrays keep the order the
 * extractor put them in; every array that could vary is already sorted at the point it is built.
 */
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}
