/**
 * Dimension parsing.
 *
 * The kit authors dimensions inconsistently — `borderRadius` values are bare
 * numbers while `lineHeights` are `px` strings — so the extractor normalises both
 * into `{ value, unit }` and additionally records a pixel projection where one is
 * unambiguous. That projection is what lets the deviation analyser answer
 * "is `13px` on the scale?" without re-deriving unit semantics.
 */

export const DIMENSION_UNITS = ["px", "rem", "em", "%", "vh", "vw", "ch", "none"] as const;

export type DimensionUnit = (typeof DIMENSION_UNITS)[number];

export interface DimensionValue {
  readonly value: number;
  readonly unit: DimensionUnit;
  /**
   * Value in CSS pixels, when derivable without knowing the rendering context.
   * `rem`/`em` are resolved against `remBasePx`; `%`, `vh`, `vw` and `ch` stay `null`.
   */
  readonly px: number | null;
}

const DIMENSION_PATTERN = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem|em|%|vh|vw|ch)?$/i;

const CONTEXT_DEPENDENT_UNITS: ReadonlySet<DimensionUnit> = new Set(["%", "vh", "vw", "ch"]);

export const DEFAULT_REM_BASE_PX = 16;

const roundTo = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const toPixels = (value: number, unit: DimensionUnit, remBasePx: number): number | null => {
  if (CONTEXT_DEPENDENT_UNITS.has(unit)) {
    return null;
  }

  // A unitless dimension in this kit is always a raw pixel count (`borderRadius.l = 8`).
  if (unit === "px" || unit === "none") {
    return roundTo(value, 4);
  }

  return roundTo(value * remBasePx, 4);
};

/**
 * Parses a dimension authored as a number or a CSS length string.
 * Returns `null` for anything that is not a single scalar dimension.
 */
export const parseDimension = (
  input: string | number,
  remBasePx: number = DEFAULT_REM_BASE_PX,
): DimensionValue | null => {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      return null;
    }
    return { value: input, unit: "none", px: toPixels(input, "none", remBasePx) };
  }

  const match = DIMENSION_PATTERN.exec(input.trim());
  if (!match) {
    return null;
  }

  const value = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(value)) {
    return null;
  }

  const unit = (match[2]?.toLowerCase() ?? "none") as DimensionUnit;

  return { value, unit, px: toPixels(value, unit, remBasePx) };
};

export const isDimensionLiteral = (input: string | number): boolean =>
  parseDimension(input) !== null;

/**
 * Builds the sorted, de-duplicated pixel scale implied by a set of dimensions.
 * Context-dependent units are excluded because they have no pixel projection.
 */
export const toPixelScale = (dimensions: readonly DimensionValue[]): number[] => {
  const pixels = new Set<number>();

  for (const dimension of dimensions) {
    if (dimension.px !== null) {
      pixels.add(dimension.px);
    }
  }

  return [...pixels].sort((a, b) => a - b);
};
