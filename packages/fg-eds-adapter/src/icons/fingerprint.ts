/**
 * Geometry fingerprint for SVG icons. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/icons/fingerprint.ts:1-129`.
 *
 * Two icons are "the same icon" when their drawing commands agree — not when their markup does.
 * A re-export from a design tool changes attribute order, precision, ids and metadata while
 * drawing identical geometry, so the fingerprint is built only from the shapes, with numbers
 * rounded to a tolerance.
 *
 * Extraction is regex-based rather than XML parsing, deliberately: the same function must run
 * over `.svg` files, over inline `<svg>` JSX (which is not valid XML), and over whatever
 * fragment of markup a rule can see. A parser would reject two of the three.
 *
 * Matching is exact-on-normalized-geometry only. "Visually similar but redrawn" cannot be
 * decided statically with any honesty; that tier belongs to the AI stage.
 */

export interface SvgGeometry {
  /** Stable hash of the normalized shape list. */
  readonly fingerprint: string;
  readonly viewBox: string | null;
  /** Number of shapes that contributed — 0-shape inputs return `null` instead. */
  readonly shapeCount: number;
  /** The normalized shapes themselves, `kind:data` — enough to re-render the icon. */
  readonly shapes: readonly string[];
}

/** Numeric precision for coordinates; tighter than any icon grid, looser than export noise. */
const PRECISION = 2;

const round = (value: string): string => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  const rounded = parsed.toFixed(PRECISION);
  // `1.00` and `1` must agree.
  return String(Number.parseFloat(rounded));
};

/** Normalizes a path `d` (or a points list): canonical separators, rounded numbers. */
export const normalizeShapeData = (data: string): string =>
  data
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ?([a-zA-Z]) ?/g, "$1")
    .replace(/-?\d*\.?\d+(?:e-?\d+)?/gi, (number) => round(number))
    .trim();

/** FNV-1a, hex — deterministic and dependency-free. */
const hash = (value: string): string => {
  let state = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index);
    state = Math.imul(state, 0x01000193) >>> 0;
  }

  return state.toString(16).padStart(8, "0");
};

const attribute = (tag: string, name: string): string | null => {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`).exec(tag);
  return match?.[1] ?? null;
};

/** Shape tags that draw something; everything else in an SVG is grouping or metadata. */
const SHAPE_PATTERN = /<(path|circle|rect|ellipse|line|polyline|polygon)\b[^>]*>/gi;

const NUMERIC_SHAPE_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  circle: ["cx", "cy", "r"],
  rect: ["x", "y", "width", "height", "rx", "ry"],
  ellipse: ["cx", "cy", "rx", "ry"],
  line: ["x1", "y1", "x2", "y2"],
};

/**
 * Reads the geometry of the first `<svg>` element in `markup`.
 *
 * Returns `null` when no shape is found — an `<svg>` built entirely from `{expression}` children
 * carries no static geometry, and fingerprinting its wrapper would match every other empty
 * wrapper in the project.
 */
export const svgFingerprint = (markup: string): SvgGeometry | null => {
  const svgTag = /<svg\b[^>]*>/i.exec(markup);
  const viewBox = svgTag ? attribute(svgTag[0], "viewBox") : null;

  const shapes: string[] = [];

  for (const match of markup.matchAll(SHAPE_PATTERN)) {
    const tag = match[0];
    const kind = (match[1] ?? "").toLowerCase();

    if (kind === "path") {
      const data = attribute(tag, "d");
      if (data !== null && data.length > 0) {
        shapes.push(`path:${normalizeShapeData(data)}`);
      }
      continue;
    }

    if (kind === "polyline" || kind === "polygon") {
      const points = attribute(tag, "points");
      if (points !== null && points.length > 0) {
        shapes.push(`${kind}:${normalizeShapeData(points)}`);
      }
      continue;
    }

    const names = NUMERIC_SHAPE_ATTRIBUTES[kind] ?? [];
    const values = names.map((name) => {
      const value = attribute(tag, name);
      return value === null ? "" : round(value);
    });
    if (values.some((value) => value.length > 0)) {
      shapes.push(`${kind}:${values.join(" ")}`);
    }
  }

  if (shapes.length === 0) {
    return null;
  }

  return {
    fingerprint: hash(shapes.join("|")),
    viewBox: viewBox === null ? null : normalizeShapeData(viewBox),
    shapeCount: shapes.length,
    shapes,
  };
};
