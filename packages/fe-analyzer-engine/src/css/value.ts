import { CSS_NAMED_COLORS, NON_COLOR_KEYWORDS } from "./named-colors.ts";

/**
 * Extraction of design literals from a CSS declaration value. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/css/value.ts:1-185`.
 *
 * One declaration can hide several independent decisions:
 *
 *   border: 1px solid #2969e3     → a width and a colour
 *   box-shadow: 0 0 0 2px #ff2078 → a colour (the offsets are geometry, not design)
 *   padding: 11px 13px            → two lengths
 *
 * Reporting the declaration as a whole would make the diff unactionable, so the value is
 * tokenised and every literal comes back with its offset inside the string. The caller turns
 * that offset into a column.
 *
 * Two things are deliberately *not* extracted:
 *
 *  - the inside of `var(--x, fallback)` — the whole point of a fallback is that it is a
 *    fallback, and the custom property itself is reported separately for the tier rule;
 *  - the inside of `url(…)` — data URIs are full of things that look like hex colours.
 *
 * Bare numbers are also skipped. In CSS text a unitless number is `line-height: 1.5`,
 * `flex: 1`, `opacity: .5` or `font-weight: 500`; treating those as pixel lengths would be
 * wrong far more often than right. Inline style objects are the exception, and they are
 * handled by their own collector, which knows the property and can apply React's
 * number-means-px rule.
 */

export interface ColorLiteral {
  readonly kind: "color";
  /** Exactly as written, e.g. `#ff1f78` or `rgba(0, 0, 0, 0.5)`. */
  readonly raw: string;
  /** Character offset of `raw` within the value string. */
  readonly offset: number;
}

export interface DimensionLiteral {
  readonly kind: "dimension";
  /** Exactly as written, e.g. `13px`. */
  readonly raw: string;
  readonly offset: number;
}

export interface CustomPropertyReference {
  readonly kind: "var";
  /** Custom property name including the leading dashes. */
  readonly name: string;
  readonly offset: number;
}

export type ValueLiteral = ColorLiteral | DimensionLiteral | CustomPropertyReference;

const HEX = /^#[0-9a-fA-F]{3,8}\b/;
const COLOR_FUNCTIONS = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
]);
const SKIPPED_FUNCTIONS = new Set(["url"]);
const LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(px|rem|em|vh|vw|vmin|vmax|ch|ex|cm|mm|in|pt|pc|q)\b/i;
const IDENTIFIER = /^-{0,2}[a-zA-Z_][\w-]*/;

/** Reads a balanced `name(...)` starting at `start`; returns its full text or `null`. */
const readFunctionCall = (value: string, start: number, nameLength: number): string | null => {
  let depth = 0;

  for (let index = start + nameLength; index < value.length; index += 1) {
    const character = value[index];

    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  // Unbalanced parentheses: the declaration is malformed, so nothing is claimed about it.
  return null;
};

/**
 * Splits a declaration value into the design literals it contains.
 *
 * `allowNamedColors` should be `false` for values recovered from TypeScript string literals,
 * where a bare word carries no guarantee of being a colour.
 */
export const extractValueLiterals = (
  value: string,
  options: { readonly allowNamedColors?: boolean } = {},
): ValueLiteral[] => {
  const allowNamedColors = options.allowNamedColors ?? true;
  const literals: ValueLiteral[] = [];
  let index = 0;

  while (index < value.length) {
    const rest = value.slice(index);

    if (rest.startsWith("/*")) {
      const end = value.indexOf("*/", index + 2);
      index = end === -1 ? value.length : end + 2;
      continue;
    }

    const hex = HEX.exec(rest);
    if (hex) {
      literals.push({ kind: "color", raw: hex[0], offset: index });
      index += hex[0].length;
      continue;
    }

    const length = LENGTH.exec(rest);
    if (length) {
      literals.push({ kind: "dimension", raw: length[0], offset: index });
      index += length[0].length;
      continue;
    }

    const identifier = IDENTIFIER.exec(rest);
    if (identifier) {
      const word = identifier[0];
      const afterWord = rest.slice(word.length);
      const isCall = afterWord.startsWith("(");
      const lowered = word.toLowerCase();

      if (isCall && lowered === "var") {
        const call = readFunctionCall(value, index, word.length);
        const name = /^var\(\s*(--[\w-]+)/.exec(call ?? "")?.[1];
        if (name) {
          literals.push({ kind: "var", name, offset: index });
        }
        index += call?.length ?? word.length;
        continue;
      }

      if (isCall && SKIPPED_FUNCTIONS.has(lowered)) {
        const call = readFunctionCall(value, index, word.length);
        index += call?.length ?? word.length;
        continue;
      }

      if (isCall && COLOR_FUNCTIONS.has(lowered)) {
        const call = readFunctionCall(value, index, word.length);
        if (call) {
          literals.push({ kind: "color", raw: call, offset: index });
          index += call.length;
          continue;
        }
      }

      if (
        !isCall &&
        allowNamedColors &&
        !NON_COLOR_KEYWORDS.has(lowered) &&
        CSS_NAMED_COLORS.has(lowered)
      ) {
        literals.push({ kind: "color", raw: word, offset: index });
      }

      index += word.length;
      continue;
    }

    index += 1;
  }

  return literals;
};

/** Canonical hex for a CSS named colour, or `null`. */
export const namedColorToHex = (word: string): string | null =>
  CSS_NAMED_COLORS.get(word.toLowerCase()) ?? null;

/**
 * Font families in a `font-family` value, unquoted and in order.
 *
 * A design system records its families as full stacks, so comparison happens family by family
 * rather than on the whole string.
 */
export const splitFontFamilies = (value: string): string[] =>
  value
    .split(",")
    .map((entry) =>
      entry
        .trim()
        .replace(/^['"]|['"]$/g, "")
        .trim(),
    )
    .filter((entry) => entry.length > 0);

/** `true` when the whole value is a single `var(--…)` reference and nothing else. */
export const isSoleCustomPropertyReference = (value: string): boolean =>
  /^var\(\s*--[\w-]+\s*\)$/.test(value.trim());
