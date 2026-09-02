import { style } from "@vanilla-extract/css";

import { themeTokens } from "@acme/design-tokens";
import * as design from "@acme/design-tokens";

/**
 * A FAKE design system, on purpose.
 *
 * `@acme/design-tokens` exists nowhere: the engine must build the reference out of the import
 * as it was written, without resolving it, without a kit connected, and without knowing what
 * any of these names mean. A fixture pointing at a real kit would let a hardcoded module name
 * pass this suite.
 */
const role = "textPrimary";

export const card = style({
  color: themeTokens.sys.color.textPrimary,
  backgroundColor: themeTokens["sys"].color.surface,
  borderColor: design.themeTokens.sys.color.border,
  boxShadow: `${themeTokens.sys.color.shadow} 0px 0px 0px 1px inset`,
  outlineColor: themeTokens.sys.color[role],
  padding: 12,
});

/** A token GROUP spread in, plus one property of its own. */
const localBase = { fontWeight: 400 };

export const cardText = style({
  ...themeTokens.sys.typography.body,
  color: themeTokens.sys.color.textPrimary,
});

export const cardMeta = style({
  ...localBase,
  fontSize: 12,
});
