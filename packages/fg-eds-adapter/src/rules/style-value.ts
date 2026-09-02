/**
 * The two facts every token rule needs about a style declaration, in one place.
 *
 * ## Why a shared module rather than a line in each rule
 *
 * A design system can publish a token through two channels — a CSS custom property inside the
 * value text, and a member path off an imported object — and a rule must not care which. Before
 * this file, `token.tier.violation` looked only at `var(--…)` literals, which is correct for
 * EDS 1.x and blind on EDS 2.x, where `borderColor: themeTokens.ref.palette.coldGray90` is the
 * whole finding and there is no `var(` anywhere in the value. Answering the question once means
 * the two channels cannot drift apart rule by rule.
 *
 * ## `!important` under vanilla-extract
 *
 * `StyleValue.important` is set by the CSS and CSS-in-JS collectors, which parse a declaration.
 * A vanilla-extract style object holds a JavaScript STRING — `'13px !important'` — so the flag
 * is `false` and the suffix is in the value. `style.override.important` must see it either way,
 * so the question is asked here rather than in the rule.
 */
import type { StyleValue } from "@smart-tools/fg-analyzer-engine";

import type { TokenDto } from "../domain/artifacts.ts";
import type { KitSpec } from "../kit/spec.ts";

/** `true` when the declaration is marked `!important`, in whichever dialect it was written. */
export const isImportant = (styleValue: StyleValue): boolean =>
  styleValue.important || /!\s*important\s*$/i.test(styleValue.value);

/**
 * The kit token this declaration REFERENCES, or `null` when it is a literal.
 *
 * Reads `StyleValue.reference`, which the engine populates for both kinds, so a rule asking
 * "is this a token?" reads one field and gets one answer.
 */
export const referencedToken = (styleValue: StyleValue, kit: KitSpec): TokenDto | null =>
  styleValue.reference === null ? null : kit.tokenForReference(styleValue.reference);

/**
 * The value a declaration effectively applies: the token's resolved value when it references
 * one, the authored text otherwise.
 *
 * What makes the typography rule work on a half-migrated block — `fontSize` from a token and
 * the other three typed by hand is only visible as a partial ramp if both halves are expressed
 * in the same vocabulary.
 */
export const effectiveValue = (styleValue: StyleValue, kit: KitSpec): string => {
  const token = referencedToken(styleValue, kit);
  if (token === null) return styleValue.value;

  const resolved = token.resolved[kit.mode] ?? token.resolved.light;
  return resolved === null ? styleValue.value : String(resolved);
};
