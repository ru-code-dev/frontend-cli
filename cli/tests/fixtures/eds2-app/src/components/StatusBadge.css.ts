import { themeTokens } from "@sds-eng/base-exp";
import { style } from "@vanilla-extract/css";

export const badge = style({
  alignItems: "center",
  display: "inline-flex",
  gap: 4,
  paddingInline: 8,
  borderRadius: themeTokens.edsRef.borderRadius.l,
  backgroundColor: themeTokens.edsSys.Background.backHighlight,
});

export const badgeIcon = style({
  height: 16,
  width: 16,
});
