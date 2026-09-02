import type { StyleValue } from "../domain/observations.ts";

/**
 * Where a literal sits on its line. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/rules/position.ts:1-30`.
 *
 * Collectors record the start of the *declaration*, which for CSS text is the property name. A
 * finding has to point at the offending literal itself so the report can underline it, so the
 * property and its separator are stepped over.
 *
 * Style objects and JSX attributes already record the value node, so nothing is added there.
 * The distinction is small but it is the difference between highlighting `#ff1f78` and
 * highlighting `background`.
 */

const VALUE_FOLLOWS_PROPERTY: ReadonlySet<StyleValue["source"]> = new Set([
  "css",
  "css-modules",
  "scss",
  "scss-modules",
  "less",
  "styled-components",
  "emotion",
]);

/** Column of the literal at `offset` within `styleValue`'s value. */
export const literalColumn = (styleValue: StyleValue, offset: number): number => {
  const separator = VALUE_FOLLOWS_PROPERTY.has(styleValue.source)
    ? styleValue.property.length + 2
    : 0;

  return styleValue.column + separator + offset;
};
