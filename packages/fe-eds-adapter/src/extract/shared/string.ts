/** Casing helpers used to parse the UI kit's component-token naming convention. */

/**
 * Splits an identifier written in camelCase / PascalCase / snake_case / kebab-case
 * into lower-cased words.
 *
 * Digit runs are kept as their own word so that `borderRadius2` and `gray900`
 * decompose into `['border','radius','2']` and `['gray','900']`.
 */
export const splitIdentifierWords = (identifier: string): string[] => {
  const normalised = identifier.replace(/[_\-\s.]+/g, " ");

  const spaced = normalised
    // camelCase / PascalCase boundary
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    // acronym followed by a word: `HTMLElement` -> `HTML Element`
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    // letter/digit boundaries in both directions
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2");

  return spaced
    .split(" ")
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 0);
};

export const isBlank = (value: string): boolean => value.trim().length === 0;

/** Stable, order-insensitive signature for a set of strings. */
export const signatureOf = (values: readonly string[]): string =>
  [...new Set(values)].sort().join("|");
