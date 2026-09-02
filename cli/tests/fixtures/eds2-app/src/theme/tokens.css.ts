import { themeTokens } from "@sds-eng/base-exp";
import { style } from "@vanilla-extract/css";

/**
 * The clean baseline: every value comes from a token member path, every number is on
 * the kit's own scale. Nothing in this file may produce a finding.
 */
export const page = style({
  backgroundColor: themeTokens.edsSys.Background.backBase,
  color: themeTokens.edsSys.Foreground.foreParagraph,
  padding: 16,
  gap: 8,
  borderRadius: themeTokens.edsRef.borderRadius.m,
  display: "flex",
  flexDirection: "column",
});

export const section = style({
  ...themeTokens.edsSys.Typography.Body.BodyM,
  color: themeTokens.edsSys.Foreground.foreParagraph,
  marginBlockEnd: 24,
});
