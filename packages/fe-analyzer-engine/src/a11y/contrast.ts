import type { ColorValue } from "../css/color.ts";

/**
 * WCAG contrast, computed without a browser. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/a11y/contrast.ts:1-116` (only the `ColorValue` import path
 * moved with the module it names).
 *
 * A browser is normally needed for contrast only to answer "what two colours ended up on top
 * of each other" — the arithmetic itself is a pure function, and where the pairing is
 * knowable from the source, so is the verdict.
 *
 * Implements WCAG 2.1 SC 1.4.3 (contrast minimum) and 1.4.11 (non-text contrast).
 */

/** WCAG 2.1 thresholds. Large text is ≥18.66px bold or ≥24px regular. */
export const CONTRAST_THRESHOLDS = {
  normalText: 4.5,
  largeText: 3,
  nonText: 3,
} as const;

export const LARGE_TEXT_PX = 24;
export const LARGE_TEXT_BOLD_PX = 18.66;
export const BOLD_WEIGHT = 700;

const linearise = (channel: number): number => {
  const normalised = channel / 255;

  return normalised <= 0.03928 ? normalised / 12.92 : Math.pow((normalised + 0.055) / 1.055, 2.4);
};

/** WCAG relative luminance, 0 (black) to 1 (white). */
export const relativeLuminance = (color: ColorValue): number => {
  const { r, g, b } = color.rgba;

  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
};

/**
 * Composites a partially transparent foreground over an opaque backdrop.
 *
 * Not an optional refinement: disabled states are routinely alpha colours like `#13181b47`,
 * and treating that as opaque would report a contrast the user never sees — in the wrong
 * direction, since the composited colour is always closer to the backdrop.
 */
export const compositeOver = (foreground: ColorValue, backdrop: ColorValue): ColorValue => {
  const alpha = foreground.rgba.a;

  if (alpha >= 1) {
    return foreground;
  }

  const blend = (channel: "r" | "g" | "b"): number =>
    Math.round(foreground.rgba[channel] * alpha + backdrop.rgba[channel] * (1 - alpha));

  const rgba = { r: blend("r"), g: blend("g"), b: blend("b"), a: 1 };
  const hex = `#${[rgba.r, rgba.g, rgba.b].map((value) => value.toString(16).padStart(2, "0")).join("")}ff`;

  return { ...foreground, hex, rgba };
};

/**
 * Contrast ratio between two colours, 1 to 21.
 *
 * `foreground` is composited over `background` first, so a translucent text colour is judged
 * as it renders rather than as it is written.
 */
export const contrastRatio = (foreground: ColorValue, background: ColorValue): number => {
  const composited = compositeOver(foreground, background);
  const lighter = Math.max(relativeLuminance(composited), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(composited), relativeLuminance(background));

  return (lighter + 0.05) / (darker + 0.05);
};

/** The threshold that applies to text of a given size and weight. */
export const thresholdFor = (input: {
  readonly fontSizePx: number | null;
  readonly fontWeight: number | null;
}): number => {
  const { fontSizePx, fontWeight } = input;

  if (fontSizePx === null) {
    // Unknown size is judged at the stricter bar. Assuming "large" would let every
    // unmeasured pair through, which is the failure mode that makes a checker pointless.
    return CONTRAST_THRESHOLDS.normalText;
  }

  const bold = fontWeight !== null && fontWeight >= BOLD_WEIGHT;

  return fontSizePx >= LARGE_TEXT_PX || (bold && fontSizePx >= LARGE_TEXT_BOLD_PX)
    ? CONTRAST_THRESHOLDS.largeText
    : CONTRAST_THRESHOLDS.normalText;
};

export interface ContrastVerdict {
  readonly ratio: number;
  readonly threshold: number;
  readonly passes: boolean;
  /** WCAG success criterion the verdict is measured against. */
  readonly criterion: "1.4.3" | "1.4.11";
}

export const judgeTextContrast = (input: {
  readonly foreground: ColorValue;
  readonly background: ColorValue;
  readonly fontSizePx: number | null;
  readonly fontWeight: number | null;
}): ContrastVerdict => {
  const ratio = contrastRatio(input.foreground, input.background);
  const threshold = thresholdFor(input);

  return { ratio, threshold, passes: ratio >= threshold, criterion: "1.4.3" };
};

/** Rounds for display without ever rounding a failure up into a pass. */
export const formatRatio = (ratio: number): string =>
  `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
