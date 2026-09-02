import { themeTokens } from "@sds-eng/base-exp";
import { globalStyle, style } from "@vanilla-extract/css";

export const backdrop = style({
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(10, 22, 43, 0.36)",
  display: "grid",
  placeItems: "center",
});

export const panel = style({
  backgroundColor: themeTokens.edsSys.Background.backBase,
  borderRadius: themeTokens.edsRef.borderRadius.l,
  padding: 24,
  minWidth: 320,
});

/* Reaching into the kit's own emitted class names; they carry a build hash,
   so the only way in is a substring match. */
globalStyle(`${panel} [class*='sds-eng-button-root']`, {
  backgroundColor: "#7c3aed !important",
  borderRadius: "13px !important",
});

globalStyle(`${panel} [class*='sds-eng-text-field-input'] input`, {
  height: "21px",
  paddingInline: "13px",
});
