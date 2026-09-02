import { themeTokens } from "@sds-eng/base-exp";
import { style } from "@vanilla-extract/css";

const FIELD_STATE = "backNegative";

export const form = style({
  display: "grid",
  gap: 16,
  maxWidth: 360,
});

/** Correct, statically resolvable token reference. */
export const submitRow = style({
  display: "flex",
  gap: 8,
  justifyContent: "flex-end",
  borderTop: `1px solid ${themeTokens.edsSys.Border.borderBase}`,
});

/** Computed member access — the token cannot be named statically. */
export const errorText = style({
  color: themeTokens.edsSys.Background[FIELD_STATE],
  fontSize: "13px",
});
