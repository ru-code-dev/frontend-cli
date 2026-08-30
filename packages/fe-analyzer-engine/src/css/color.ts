/**
 * Colour parsing and normalisation. Ported from
 * `hackathon2026/ds-analyzer/src/tokens/color.ts:1-224` — moved out of the `tokens/`
 * directory because no token rule is ported and the contrast rule is its only consumer here.
 *
 * Every colour is reduced to one canonical `#rrggbbaa` string, and additionally projected
 * into OKLCH. The OKLCH projection is kept although only `rgba` is read by the contrast
 * maths: `ColorValue` is the shape `judgeTextContrast` was written against, and stripping a
 * field of it would be a rewrite of code this port exists not to rewrite.
 */

export interface Rgba {
  /** 0-255 */
  readonly r: number;
  /** 0-255 */
  readonly g: number;
  /** 0-255 */
  readonly b: number;
  /** 0-1 */
  readonly a: number;
}

export interface Oklch {
  /** Perceptual lightness, 0-1. */
  readonly l: number;
  /** Chroma, unbounded but ~0-0.4 for sRGB. */
  readonly c: number;
  /** Hue angle in degrees, 0-360. `0` for achromatic colours. */
  readonly h: number;
}

export interface ColorValue {
  /** Canonical lowercase `#rrggbbaa`. */
  readonly hex: string;
  readonly rgba: Rgba;
  readonly oklch: Oklch;
  /** `true` when the source notation carried an alpha channel below 1. */
  readonly hasAlpha: boolean;
}

/**
 * The only bare colour keywords recognised. A wider CSS named-colour table would invite
 * false positives when scanning consumer projects, where a word like `gold` is far more
 * likely to be an identifier than a colour.
 */
const NAMED_COLORS: Readonly<Record<string, string>> = {
  transparent: "#00000000",
  black: "#000000ff",
  white: "#ffffffff",
};

const HEX_PATTERN = /^#([0-9a-f]{3,8})$/i;
const RGB_PATTERN = /^rgba?\(([^)]*)\)$/i;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const roundTo = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const byteToHex = (value: number): string =>
  clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");

const expandShortHex = (digits: string): string =>
  digits
    .split("")
    .map((digit) => `${digit}${digit}`)
    .join("");

const parseHex = (input: string): Rgba | null => {
  const match = HEX_PATTERN.exec(input);
  if (!match) {
    return null;
  }

  const digits = match[1] ?? "";
  let normalised: string;

  switch (digits.length) {
    case 3:
      normalised = `${expandShortHex(digits)}ff`;
      break;
    case 4:
      normalised = expandShortHex(digits);
      break;
    case 6:
      normalised = `${digits}ff`;
      break;
    case 8:
      normalised = digits;
      break;
    default:
      return null;
  }

  const channel = (offset: number): number =>
    Number.parseInt(normalised.slice(offset, offset + 2), 16);

  return {
    r: channel(0),
    g: channel(2),
    b: channel(4),
    a: roundTo(channel(6) / 255, 4),
  };
};

const parseChannel = (raw: string, scale: number): number | null => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.endsWith("%")) {
    const percent = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(percent) ? (percent / 100) * scale : null;
  }

  const numeric = Number.parseFloat(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
};

const parseRgb = (input: string): Rgba | null => {
  const match = RGB_PATTERN.exec(input);
  if (!match) {
    return null;
  }

  // Both the legacy comma syntax and the modern `rgb(r g b / a)` syntax appear in the wild.
  const parts = (match[1] ?? "")
    .replace(/\//g, " ")
    .split(/[,\s]+/)
    .filter((part) => part.trim().length > 0);

  if (parts.length < 3 || parts.length > 4) {
    return null;
  }

  const r = parseChannel(parts[0] ?? "", 255);
  const g = parseChannel(parts[1] ?? "", 255);
  const b = parseChannel(parts[2] ?? "", 255);
  const a = parts.length === 4 ? parseChannel(parts[3] ?? "", 1) : 1;

  if (r === null || g === null || b === null || a === null) {
    return null;
  }

  return {
    r: clamp(r, 0, 255),
    g: clamp(g, 0, 255),
    b: clamp(b, 0, 255),
    a: roundTo(clamp(a, 0, 1), 4),
  };
};

/** sRGB gamma decode, per IEC 61966-2-1. */
const srgbToLinear = (channel: number): number => {
  const normalised = channel / 255;
  return normalised <= 0.04045 ? normalised / 12.92 : ((normalised + 0.055) / 1.055) ** 2.4;
};

/** Converts sRGB to OKLCH using Björn Ottosson's OKLab matrices. */
export const rgbaToOklch = (rgba: Rgba): Oklch => {
  const r = srgbToLinear(rgba.r);
  const g = srgbToLinear(rgba.g);
  const b = srgbToLinear(rgba.b);

  const lCone = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mCone = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const sCone = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const lightness = 0.2104542553 * lCone + 0.793617785 * mCone - 0.0040720468 * sCone;
  const aAxis = 1.9779984951 * lCone - 2.428592205 * mCone + 0.4505937099 * sCone;
  const bAxis = 0.0259040371 * lCone + 0.7827717662 * mCone - 0.808675766 * sCone;

  const chroma = Math.sqrt(aAxis * aAxis + bAxis * bAxis);
  // Below this chroma the hue angle is numerical noise, so report it as 0.
  const hue = chroma < 1e-6 ? 0 : ((Math.atan2(bAxis, aAxis) * 180) / Math.PI + 360) % 360;

  return {
    l: roundTo(lightness, 5),
    c: roundTo(chroma, 5),
    h: roundTo(hue, 3),
  };
};

/** Parses any colour notation the collectors can produce. Returns `null` for non-colours. */
export const parseColor = (input: string): ColorValue | null => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const named = NAMED_COLORS[trimmed.toLowerCase()];
  const rgba = parseHex(named ?? trimmed) ?? parseRgb(trimmed);

  if (!rgba) {
    return null;
  }

  return {
    hex: `#${byteToHex(rgba.r)}${byteToHex(rgba.g)}${byteToHex(rgba.b)}${byteToHex(rgba.a * 255)}`,
    rgba,
    oklch: rgbaToOklch(rgba),
    hasAlpha: rgba.a < 1,
  };
};
