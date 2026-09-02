import { makeStyles } from "@acme/kit";

import { themeTokens } from "@acme/design-tokens";

/**
 * vanilla-extract in a file that carries neither the convention nor the import.
 *
 * Not `.css.ts`, and it never imports `@vanilla-extract/*`: the factory comes from the kit.
 * Whether this is read as vanilla-extract therefore depends ENTIRELY on the connected kit
 * declaring `makeStyles` as a style factory — with no adapter it is an ordinary object
 * literal, and that difference is what the binding test asserts.
 */
const { style } = makeStyles("shell");

export const shell = style({
  color: themeTokens.sys.color.textSecondary,
  padding: 7,
});
