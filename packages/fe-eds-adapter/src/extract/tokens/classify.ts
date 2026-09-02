import { splitIdentifierWords } from "../shared/string.ts";

import { parseColor } from "./color.ts";
import { parseDimension } from "./dimension.ts";
import { parseReferences } from "./references.ts";

/**
 * Classification of a token's *value*, not of its role in the design system.
 *
 * Classification is deliberately path-first: `borderRadius.none = 0` and
 * `fontWeights.regular = 400` are both bare numbers, and only the path
 * distinguishes a length from a weight. Value shape is the fallback.
 */
export const TOKEN_VALUE_KINDS = [
  "color",
  "shadow",
  "fontFamily",
  "fontWeight",
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "dimension",
  "keyword",
  "unknown",
] as const;

export type TokenValueKind = (typeof TOKEN_VALUE_KINDS)[number];

export const TOKEN_CATEGORIES = ["color", "typography", "dimension", "shadow", "other"] as const;

export type TokenCategory = (typeof TOKEN_CATEGORIES)[number];

const CATEGORY_BY_KIND: Readonly<Record<TokenValueKind, TokenCategory>> = {
  color: "color",
  shadow: "shadow",
  fontFamily: "typography",
  fontWeight: "typography",
  fontSize: "typography",
  lineHeight: "typography",
  letterSpacing: "typography",
  dimension: "dimension",
  keyword: "other",
  unknown: "other",
};

/**
 * Path-word signals, checked in order. The first rule whose words all appear in the
 * token path wins, which keeps `bodyTypographyFontSize` (fontSize) from being
 * captured by the broader `typography` signal.
 */
const PATH_RULES: readonly { readonly kind: TokenValueKind; readonly words: readonly string[] }[] =
  [
    { kind: "fontFamily", words: ["font", "family"] },
    { kind: "fontFamily", words: ["font", "families"] },
    { kind: "fontWeight", words: ["font", "weight"] },
    { kind: "fontWeight", words: ["font", "weights"] },
    { kind: "fontSize", words: ["font", "size"] },
    { kind: "lineHeight", words: ["line", "height"] },
    { kind: "lineHeight", words: ["line", "heights"] },
    { kind: "letterSpacing", words: ["letter", "spacing"] },
    { kind: "shadow", words: ["shadow"] },
    { kind: "shadow", words: ["elevation"] },
    { kind: "color", words: ["palette"] },
    { kind: "color", words: ["color"] },
  ];

const KEYWORD_VALUES: ReadonlySet<string> = new Set([
  "none",
  "inherit",
  "initial",
  "unset",
  "auto",
  "normal",
]);

/** A shadow is a length-triple (or more) followed by a colour, optionally comma-repeated. */
const SHADOW_PATTERN = /^(-?[\d.]+px\s+){2,}/;

const wordsOf = (path: readonly string[]): string[] =>
  path.flatMap((segment) => splitIdentifierWords(segment));

const matchesRule = (pathWords: readonly string[], ruleWords: readonly string[]): boolean =>
  ruleWords.every((word) => pathWords.includes(word));

const classifyByValue = (value: string | number): TokenValueKind => {
  if (typeof value === "number") {
    return "dimension";
  }

  const trimmed = value.trim();

  if (KEYWORD_VALUES.has(trimmed.toLowerCase())) {
    return "keyword";
  }
  if (SHADOW_PATTERN.test(trimmed)) {
    return "shadow";
  }
  if (parseColor(trimmed) !== null) {
    return "color";
  }
  if (parseDimension(trimmed) !== null) {
    return "dimension";
  }
  // Font stacks are the only comma-separated non-shadow strings in the theme.
  if (trimmed.includes(",")) {
    return "fontFamily";
  }

  return "unknown";
};

/**
 * Determines the value kind of a token from its path and its authored + resolved values.
 *
 * `resolved` is preferred for shape detection because an authored value may still be
 * an unresolved `{edsRef.…}` template that carries no shape information of its own.
 */
export const classifyTokenValue = (
  path: readonly string[],
  authored: string | number | boolean | null,
  resolved: string | number | boolean | null,
): TokenValueKind => {
  const pathWords = wordsOf(path);

  for (const rule of PATH_RULES) {
    if (matchesRule(pathWords, rule.words)) {
      return rule.kind;
    }
  }

  const probe = typeof resolved === "string" || typeof resolved === "number" ? resolved : authored;

  if (typeof probe !== "string" && typeof probe !== "number") {
    return "unknown";
  }

  // An unresolved alias tells us nothing about shape; defer rather than guess wrong.
  if (parseReferences(probe).length > 0) {
    return "unknown";
  }

  return classifyByValue(probe);
};

export const categoryOfKind = (kind: TokenValueKind): TokenCategory => CATEGORY_BY_KIND[kind];
