/**
 * Deterministic comparators. Ported from
 * `hackathon2026/ds-analyzer/src/shared/sort.ts:1-22`; `compareNumbers`/`sortNumbers` are
 * dropped because no ported rule calls them (see the report's DELTAS table).
 *
 * `String.prototype.localeCompare` is locale-sensitive: it orders `helper` before `Mode`
 * under an ICU collation but after it under code-unit ordering, and the active locale
 * depends on the machine. Results are committed and diffed, so ordering must be identical
 * on every machine — hence plain code-unit comparison everywhere.
 */

export const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** Sorts a copy of `values` in deterministic code-unit order. */
export const sortStrings = (values: Iterable<string>): string[] => [...values].sort(compareStrings);

export const compareNumbers = (left: number, right: number): number => left - right;

/** Numbers ascending, materialised. */
export const sortNumbers = (values: Iterable<number>): number[] => [...values].sort(compareNumbers);

/** Items by a string key, stable and reproducible. */
export const sortBy = <T>(items: Iterable<T>, keyOf: (item: T) => string): T[] =>
  [...items].sort((left, right) => compareStrings(keyOf(left), keyOf(right)));
