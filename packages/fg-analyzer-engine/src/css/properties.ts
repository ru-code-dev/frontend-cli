/**
 * Recognising CSS by property name. Ported from
 * `hackathon2026/ds-analyzer/src/css/properties.ts:1-306` — the style-object recogniser and
 * the camelCase→CSS spelling converter, which the TypeScript and style-object collectors both
 * need, plus the three classifiers below.
 *
 * `colorRoleOf`, `dimensionScaleOf` and `styleCategoryOf` (source lines 52-143) answer
 * questions only a token or override rule asks. No rule *in this package* asks them; a kit
 * adapter's rules do, and they are CSS knowledge rather than design-system knowledge — the
 * answers depend on the property name alone. Keeping one copy here is what stops the engine's
 * spacing-frequency index (`rules/context.ts`, which needs `dimensionScaleOf`) and an
 * adapter's dimension rule from disagreeing about which properties take part.
 */

/** Semantic role a colour plays, matching a design system's `sys`-tier naming. */
export type ColorRole = "background" | "foreground" | "border";

/** Named scale in a token artifact's `scales` that governs lengths in a property. */
export type DimensionScaleName = "borderRadiusPx" | "borderWidthPx" | "fontSizePx" | "lineHeightPx";

/** Override policy bucket for a property applied to a kit component. */
export type StyleCategory = "layout" | "repaint" | "size";

const BACKGROUND_PROPERTIES: ReadonlySet<string> = new Set([
  "background",
  "background-color",
  "background-image",
]);

const FOREGROUND_PROPERTIES: ReadonlySet<string> = new Set([
  "color",
  "fill",
  "stroke",
  "caret-color",
  "text-decoration-color",
  "text-emphasis-color",
  "-webkit-text-fill-color",
]);

const BORDER_PROPERTY_PATTERN =
  /^(border|outline|column-rule)(-(top|right|bottom|left|block|inline|start|end))*(-color|-width|-style)?$/;

/**
 * Role a colour in `property` plays, or `null` when the property carries no role.
 *
 * `box-shadow` and `text-shadow` deliberately return `null`: a shadow colour maps to no single
 * tier group, so the suggestion falls back to plain tier preference.
 */
export const colorRoleOf = (property: string): ColorRole | null => {
  const name = property.toLowerCase();

  if (BACKGROUND_PROPERTIES.has(name)) {
    return "background";
  }
  if (FOREGROUND_PROPERTIES.has(name)) {
    return "foreground";
  }
  if (BORDER_PROPERTY_PATTERN.test(name)) {
    return "border";
  }

  return null;
};

/**
 * How lengths in `property` are judged.
 *
 * - `{ scale }` — a design system publishes a scale, so membership is decidable.
 * - `{ scale: null }` — the property is a design decision but no scale governs it, so the
 *   only available check is a frequency heuristic over the project's own habits.
 * - `null` — the property is not a design decision at all.
 *
 * The last case is the important one. `width`, `height`, `margin` and positional offsets are
 * layout: there is no token that could ever replace `min-width: 480px`, so reporting it
 * produces a finding nobody can act on.
 */
export const dimensionScaleOf = (property: string): { scale: DimensionScaleName | null } | null => {
  const name = property.toLowerCase();

  if (name === "border-radius" || (name.startsWith("border-") && name.endsWith("-radius"))) {
    return { scale: "borderRadiusPx" };
  }
  if (name === "font-size") {
    return { scale: "fontSizePx" };
  }
  if (name === "line-height") {
    return { scale: "lineHeightPx" };
  }
  if (BORDER_PROPERTY_PATTERN.test(name)) {
    // Covers both `border-width` and the `border` / `border-bottom` shorthands, which carry a
    // width in their value.
    return { scale: "borderWidthPx" };
  }
  if (name === "padding" || name.startsWith("padding-")) {
    return { scale: null };
  }
  if (name === "gap" || name === "row-gap" || name === "column-gap") {
    return { scale: null };
  }

  return null;
};

const SIZE_PROPERTIES: ReadonlySet<string> = new Set(["height", "min-height", "max-height"]);

const REPAINT_PREFIXES = ["background", "border", "outline", "font", "text-"];

const REPAINT_PROPERTIES: ReadonlySet<string> = new Set([
  "color",
  "opacity",
  "box-shadow",
  "fill",
  "stroke",
  "backdrop-filter",
  "filter",
  "line-height",
  "letter-spacing",
]);

/**
 * Override policy bucket.
 *
 * Defaults to `layout`, which is the non-finding: on a real project roughly four out of five
 * `className`s on kit components only set margins and widths, and a report where most findings
 * are noise does not get read twice.
 */
export const styleCategoryOf = (property: string): StyleCategory => {
  const name = property.toLowerCase();

  if (name === "padding" || name.startsWith("padding-") || SIZE_PROPERTIES.has(name)) {
    return "size";
  }
  if (REPAINT_PROPERTIES.has(name) || REPAINT_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return "repaint";
  }

  return "layout";
};

/** `true` for the typographic properties that form a five-field type tuple. */
export const TYPOGRAPHY_PROPERTIES: ReadonlySet<string> = new Set([
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
]);

/**
 * CSS properties common enough to identify a style object by its keys.
 *
 * Style objects are not always written where a collector can see them: teams factor them
 * into helpers — `const styleFor = (active) => ({ color: …, padding: … })` — and pass the
 * result to `style={…}`. The call cannot be evaluated, but the object literal is right
 * there, and its keys give it away.
 *
 * Deliberately a list of *properties*, not a heuristic over shapes. A config object with a
 * `color` field and nothing else must not be mistaken for a style map, which is why the
 * recogniser below also requires a majority and a minimum size.
 */
const STYLE_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "align-content",
  "align-items",
  "align-self",
  "animation",
  "aspect-ratio",
  "backdrop-filter",
  "background",
  "background-color",
  "background-image",
  "background-position",
  "background-size",
  "border",
  "border-bottom",
  "border-color",
  "border-left",
  "border-radius",
  "border-right",
  "border-style",
  "border-top",
  "border-width",
  "bottom",
  "box-shadow",
  "box-sizing",
  "color",
  "column-gap",
  "cursor",
  "display",
  "fill",
  "filter",
  "flex",
  "flex-basis",
  "flex-direction",
  "flex-grow",
  "flex-shrink",
  "flex-wrap",
  "font",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "gap",
  "grid-area",
  "grid-column",
  "grid-row",
  "grid-template-columns",
  "grid-template-rows",
  "height",
  "inset",
  "justify-content",
  "justify-items",
  "justify-self",
  "left",
  "letter-spacing",
  "line-height",
  "list-style",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "object-fit",
  "opacity",
  "order",
  "outline",
  "overflow",
  "overflow-x",
  "overflow-y",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "pointer-events",
  "position",
  "right",
  "row-gap",
  "stroke",
  "text-align",
  "text-decoration",
  "text-overflow",
  "text-transform",
  "top",
  "transform",
  "transition",
  "user-select",
  "vertical-align",
  "visibility",
  "white-space",
  "width",
  "word-break",
  "z-index",
]);

/** `true` when `property` is a CSS property this analyser recognises by name. */
export const isKnownStyleProperty = (property: string): boolean =>
  STYLE_PROPERTY_NAMES.has(property.toLowerCase());

/** Below this many keys there is not enough evidence to call an object a style map. */
const MIN_STYLE_OBJECT_KEYS = 2;

/** Share of keys that must be CSS properties. */
const STYLE_OBJECT_MAJORITY = 0.6;

/**
 * Decides whether a set of object keys describes CSS.
 *
 * Requires both a majority and a minimum size, because a single `color` field is far more
 * likely to be a chart config or a theme constant than a style declaration.
 */
export const looksLikeStyleObject = (keys: readonly string[]): boolean => {
  if (keys.length < MIN_STYLE_OBJECT_KEYS) {
    return false;
  }

  const recognised = keys.filter((key) =>
    isKnownStyleProperty(cssPropertyFromStyleKey(key)),
  ).length;

  return recognised / keys.length >= STYLE_OBJECT_MAJORITY;
};

/**
 * Converts a camelCase React style key to its CSS spelling.
 *
 * Vendor-prefixed keys arrive capitalised (`WebkitTextFillColor`), which has to become
 * `-webkit-text-fill-color` rather than `webkit-text-fill-color`. Custom properties are
 * passed through untouched.
 */
export const cssPropertyFromStyleKey = (key: string): string => {
  if (key.startsWith("--")) {
    return key;
  }

  const dashed = key.replace(/([A-Z])/g, (match) => `-${match.toLowerCase()}`);

  // `WebkitTextFillColor` already becomes `-webkit-…`; React spells the Microsoft prefix in
  // lower case (`msFlexAlign`), so that one has to be re-prefixed by hand.
  return dashed.startsWith("ms-") ? `-${dashed}` : dashed;
};
