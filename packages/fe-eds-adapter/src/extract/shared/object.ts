/**
 * Structural helpers for walking the plain-object trees that the UI kit uses to
 * declare its theme. Everything here is total: no throwing, no mutation.
 */

export type JsonPrimitive = string | number | boolean | null;
export type PlainRecord = Record<string, unknown>;

export const isPlainRecord = (value: unknown): value is PlainRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isLeaf = (value: unknown): value is JsonPrimitive =>
  value === null || ["string", "number", "boolean"].includes(typeof value);

export interface LeafEntry {
  /** Property names from the root of the walked tree down to the leaf. */
  readonly path: readonly string[];
  readonly value: JsonPrimitive;
}

/**
 * Depth-first walk yielding every primitive leaf with its full path.
 *
 * Arrays are treated as leaves-by-index so that a stray array in the theme cannot
 * silently disappear from the extraction; the index becomes a path segment.
 */
export const collectLeaves = (root: unknown, basePath: readonly string[] = []): LeafEntry[] => {
  const out: LeafEntry[] = [];

  const visit = (value: unknown, path: readonly string[]): void => {
    if (isLeaf(value)) {
      out.push({ path, value });
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        visit(item, [...path, String(index)]);
      });
      return;
    }

    if (isPlainRecord(value)) {
      for (const key of Object.keys(value)) {
        visit(value[key], [...path, key]);
      }
      return;
    }

    // `undefined`, functions and symbols are not representable in the artifact.
    // Dropping them silently would be a data loss, so they surface as a null leaf.
    out.push({ path, value: null });
  };

  visit(root, basePath);

  return out;
};

/** Reads a dot-delimited path out of a nested record. Returns `undefined` when absent. */
export const getByPath = (root: unknown, path: readonly string[]): unknown => {
  let current: unknown = root;

  for (const segment of path) {
    if (!isPlainRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
};

/** Groups items by a derived string key, preserving insertion order within a group. */
export const groupBy = <T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> => {
  const grouped = new Map<string, T[]>();

  for (const item of items) {
    const key = keyOf(item);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      grouped.set(key, [item]);
    }
  }

  return grouped;
};
