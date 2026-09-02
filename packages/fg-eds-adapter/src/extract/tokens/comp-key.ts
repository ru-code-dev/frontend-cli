import { splitIdentifierWords } from "../shared/string.ts";

/**
 * Decomposition of a component-token key.
 *
 * Component tokens follow a positional convention:
 *
 *   [slot?] [category] [modifiers…] [state?]
 *
 *   colorBackgroundContainedPrimaryHover  → slot ∅        category color      modifiers contained,primary  state hover
 *   closeButtonShapeBorderRadiusTopLeft   → slot closeButton  category shape   modifiers border,radius,top,left
 *   bodyTypographyFontSize                → slot body      category typography modifiers font,size
 *   inputShapeBorderRadiusTopLeftMd       → slot input     category shape      modifiers border,radius,top,left,md
 *
 * The decomposition is heuristic — the kit has no machine-readable grammar for these
 * names — so every field is nullable and `words` is always kept verbatim, letting a
 * consumer fall back to raw matching when the heuristic misses.
 */
export interface CompTokenKeyFacets {
  readonly raw: string;
  readonly words: string[];
  /** Sub-element the token styles, e.g. `closeButton`; `null` when the token targets the root. */
  readonly slot: string | null;
  readonly category: string | null;
  /** Words between category and state, e.g. `['contained','primary']`. */
  readonly modifiers: string[];
  /** Interaction state, e.g. `hover`; `null` for the resting state. */
  readonly state: string | null;
  /** Size modifier recognised among `modifiers`, e.g. `md`. */
  readonly size: string | null;
  /** Visual-variant modifier recognised among `modifiers`, e.g. `contained` or `primary`. */
  readonly view: string | null;
}

const CATEGORY_WORDS: readonly string[] = [
  "color",
  "shape",
  "typography",
  "width",
  "height",
  "size",
  "elevation",
  "opacity",
  "padding",
  "margin",
  "gap",
  "offset",
  "duration",
  "transition",
];

const STATE_WORDS: readonly string[] = [
  "hover",
  "active",
  "focus",
  "disabled",
  "checked",
  "unchecked",
  "selected",
  "pressed",
  "visited",
  "indeterminate",
  "loading",
  "readonly",
  "empty",
  "expanded",
  "collapsed",
  "dragging",
];

const SIZE_WORDS: readonly string[] = ["xxs", "xs", "sm", "md", "lg", "xl", "xxl"];

const VIEW_WORDS: readonly string[] = [
  "primary",
  "secondary",
  "tertiary",
  "accent",
  "contained",
  "outlined",
  "ghost",
  "filled",
  "clear",
  "error",
  "negative",
  "positive",
  "warning",
  "info",
  "success",
  "brand",
  "const",
];

const CATEGORIES = new Set(CATEGORY_WORDS);
const STATES = new Set(STATE_WORDS);
const SIZES = new Set(SIZE_WORDS);
const VIEWS = new Set(VIEW_WORDS);

const toCamel = (words: readonly string[]): string =>
  words
    .map((word, index) => (index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join("");

/** Decomposes a component-token key into its positional facets. */
export const parseCompTokenKey = (key: string): CompTokenKeyFacets => {
  const words = splitIdentifierWords(key);

  const categoryIndex = words.findIndex((word) => CATEGORIES.has(word));
  const category = categoryIndex >= 0 ? (words[categoryIndex] ?? null) : null;

  const slotWords = categoryIndex > 0 ? words.slice(0, categoryIndex) : [];
  const tailWords = categoryIndex >= 0 ? words.slice(categoryIndex + 1) : words;

  // States sit at the end and may stack (`checkedHover`), so peel the whole trailing run
  // but report only the outermost (last authored) state, which is the interactive one.
  let stateStart = tailWords.length;
  while (stateStart > 0 && STATES.has(tailWords[stateStart - 1] ?? "")) {
    stateStart -= 1;
  }

  const stateWords = tailWords.slice(stateStart);
  const modifiers = tailWords.slice(0, stateStart);

  return {
    raw: key,
    words,
    slot: slotWords.length > 0 ? toCamel(slotWords) : null,
    category,
    modifiers,
    state: stateWords.length > 0 ? toCamel(stateWords) : null,
    size: modifiers.find((word) => SIZES.has(word)) ?? null,
    view: modifiers.find((word) => VIEWS.has(word)) ?? null,
  };
};

export const KNOWN_CATEGORY_WORDS = CATEGORY_WORDS;
export const KNOWN_STATE_WORDS = STATE_WORDS;
