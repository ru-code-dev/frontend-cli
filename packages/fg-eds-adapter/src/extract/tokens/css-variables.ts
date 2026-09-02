/**
 * Re-implementation of the kit's CSS-variable naming rule.
 *
 * `packages/theme/src/cssVariables.ts` + `packages/base/createCssVariables.ts` emit
 * variables by joining the path with `-` under a fixed prefix, and — critically —
 * the tier name is *not* part of the path: `createCssTemplateFile(theme.edsRef, …)`
 * is called with the tier object already unwrapped, so `edsRef.palette.pink.pink500`
 * becomes `--sds-eng-palette-pink-pink500`.
 *
 * Only the `edsRef` and `edsSys` tiers are emitted as CSS variables. Component
 * tokens are consumed through the JS theme object and have no CSS counterpart.
 */

import type { TokenTier } from "./tiers.ts";

export const CSS_VARIABLE_PREFIX = "sds-eng";

/** Tiers that `createCssVariables.ts` emits into `dist/css`. */
const CSS_EMITTED_TIERS: ReadonlySet<TokenTier> = new Set<TokenTier>(["ref", "sys"]);

/**
 * The generator wraps values in quotes when the leaf key is exactly `fontFamily`,
 * because font stacks contain commas and spaces.
 */
export const isQuotedCssValue = (path: readonly string[]): boolean => path.at(-1) === "fontFamily";

/**
 * Builds the CSS custom-property name for a token path, or `null` when the tier is
 * not emitted as CSS.
 *
 * @param tier  Token tier the path belongs to.
 * @param path  Path *within* the tier — must not include the tier name itself.
 */
export const toCssVariableName = (tier: TokenTier, path: readonly string[]): string | null => {
  if (!CSS_EMITTED_TIERS.has(tier) || path.length === 0) {
    return null;
  }

  return `--${[CSS_VARIABLE_PREFIX, ...path].join("-")}`;
};

/** `var(--…)` reference form, for suggestion text in analyser findings. */
export const toCssVariableReference = (variableName: string): string => `var(${variableName})`;
