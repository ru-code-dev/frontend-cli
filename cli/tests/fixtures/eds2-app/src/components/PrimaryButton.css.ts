import { themeTokens } from "@sds-eng/base-exp";
import { style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";

/** Hand-rolled clone of the kit button's look, literal by literal. */
export const primaryButton = recipe({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    cursor: "pointer",
    fontFamily: "Inter, Helvetica, Arial, sans-serif",
    fontSize: "13px",
    lineHeight: "21px",
    borderRadius: "7px",
    padding: "7px 13px",
    backgroundColor: "#2969e3",
    color: "#FFFFFF",
  },
  variants: {
    tone: {
      accent: { backgroundColor: "#2a6ae4" },
      exotic: { backgroundColor: "#7c3aed" },
    },
    size: {
      sm: { height: "21px" },
      md: { height: 40 },
    },
  },
  defaultVariants: { tone: "accent", size: "md" },
});

/** Deliberately reaches into the reference tier from product code. */
export const rawSurface = style({
  backgroundColor: themeTokens.edsRef.palette.electric.electric700,
  borderColor: themeTokens.ref.palette.coldGray90,
  borderStyle: "solid",
  borderWidth: 1,
});

/** fontSize from a token, the rest of the ramp left as literals. */
export const partialType = style({
  fontSize: themeTokens.edsSys.Typography.Body.BodyM.fontSize,
  fontFamily: "Inter, sans-serif",
  lineHeight: "19px",
  fontWeight: 500,
});

/** Low-contrast pair, both sides literal. */
export const hint = style({
  color: "#b8bfc7",
  backgroundColor: "#FFFFFF",
  fontSize: "12px",
});
