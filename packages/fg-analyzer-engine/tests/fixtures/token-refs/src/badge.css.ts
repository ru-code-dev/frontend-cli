import { recipe, style } from "./style-functions.css.ts";

import { themeTokens } from "@acme/design-tokens";

/**
 * The majority shape in a real design system, and the reason the file name is a trigger.
 *
 * The factories are wrapped once and re-exported from a RELATIVE project module whose path
 * differs in every directory, so no adapter can enumerate it and the import list says nothing.
 * What these files have in common is the extension the bundler itself matches on.
 */
export const badge = style({
  color: themeTokens.sys.color.textTertiary,
  padding: 3,
});

export const badgeSize = recipe({
  base: { gap: 2 },
  variants: {
    dense: {
      true: { gap: 1 },
    },
  },
});
