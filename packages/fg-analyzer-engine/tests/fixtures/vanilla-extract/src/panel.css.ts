import { globalStyle, style, styleVariants } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";

/**
 * Every shape design §2.1 lists, in one file.
 *
 * The numbers are the point of half of it: vanilla-extract appends `px` to a numeric value on
 * a dimension property and leaves the unitless ones alone, so `padding: 21` and
 * `fontWeight: 500` have to come out as `21px` and `500`.
 */
export const panel = style({
  padding: 21,
  fontWeight: 500,
  lineHeight: 1.5,
  zIndex: 3,
  opacity: 0.5,
  flexGrow: 1,
  color: "#2969e3",
  selectors: {
    "&:hover": {
      backgroundColor: "#ff1f78",
    },
  },
  "@media": {
    "screen and (min-width: 768px)": {
      padding: 32,
    },
  },
});

export const tone = styleVariants({
  danger: [panel, { borderColor: "#d0021b" }],
  calm: { borderColor: "#4a90e2" },
});

export const button = recipe({
  base: {
    borderRadius: 4,
  },
  variants: {
    size: {
      sm: { fontSize: 12 },
      md: { fontSize: 14 },
    },
  },
  compoundVariants: [
    {
      variants: { size: "sm" },
      style: { letterSpacing: "0.4px" },
    },
  ],
  defaultVariants: {
    size: "md",
  },
});

globalStyle(`${panel} > p`, {
  marginTop: 8,
});
