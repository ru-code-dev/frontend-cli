/**
 * Recognising CSS by property name. Ported from
 * `hackathon2026/ds-analyzer/src/css/properties.ts:145-306` — the style-object recogniser
 * and the camelCase→CSS spelling converter, which the TypeScript and style-object collectors
 * both need.
 *
 * The three classifiers that file also holds — `colorRoleOf`, `dimensionScaleOf`,
 * `styleCategoryOf` (source lines 52-143) — are NOT ported: each answers a question only a
 * token or override rule asks ("which `sys` role does this colour play", "which kit ramp
 * governs this length", "is this override a repaint"), and no such rule is in this package.
 */

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
