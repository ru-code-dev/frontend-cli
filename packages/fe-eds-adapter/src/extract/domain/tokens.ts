import { z } from "zod";

import { TOKEN_CATEGORIES, TOKEN_VALUE_KINDS } from "../tokens/classify.ts";
import { DIMENSION_UNITS } from "../tokens/dimension.ts";
import { REFERENCE_TIERS } from "../tokens/references.ts";
import { THEME_MODES, TOKEN_TIERS } from "../tokens/tiers.ts";

/**
 * Wire contract for `artifacts/tokens.json`.
 *
 * The schema is the single source of truth: the TypeScript types below are inferred
 * from it, and every extractor run validates its own output against it before the
 * file is written. A downstream analyser can therefore trust the shape without
 * defensive parsing.
 *
 * Design decisions worth knowing:
 *
 * - Token *identity* is mode-independent (`tier` + `path`); resolved values are keyed
 *   by theme mode. A token that renders differently in dark mode is one token, not two.
 * - Both `authored` and `resolved` are kept. `authored` preserves `{edsRef.…}`
 *   provenance needed for tier-violation rules; `resolved` is what actually ships.
 * - Nullable is used in preference to optional so the JSON shape is uniform and every
 *   field is explicit when read back.
 */

export const themeModeSchema = z.enum(THEME_MODES);

export const tokenTierSchema = z.enum(TOKEN_TIERS);

export const tokenPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const perModeSchema = <T extends z.ZodType>(value: T) =>
  z.object({
    light: value,
    dark: value,
  });

export const rgbaSchema = z.object({
  r: z.number(),
  g: z.number(),
  b: z.number(),
  a: z.number(),
});

export const oklchSchema = z.object({
  l: z.number(),
  c: z.number(),
  h: z.number(),
});

export const colorValueSchema = z.object({
  hex: z.string().regex(/^#[0-9a-f]{8}$/),
  rgba: rgbaSchema,
  oklch: oklchSchema,
  hasAlpha: z.boolean(),
});

export const dimensionValueSchema = z.object({
  value: z.number(),
  unit: z.enum(DIMENSION_UNITS),
  px: z.number().nullable(),
});

export const tokenReferenceSchema = z.object({
  raw: z.string(),
  tier: z.enum(REFERENCE_TIERS),
  path: z.string(),
  segments: z.array(z.string()),
  alpha: z.number().nullable(),
});

export const compTokenFacetsSchema = z.object({
  raw: z.string(),
  words: z.array(z.string()),
  slot: z.string().nullable(),
  category: z.string().nullable(),
  modifiers: z.array(z.string()),
  state: z.string().nullable(),
  size: z.string().nullable(),
  view: z.string().nullable(),
});

export const tokenSchema = z.object({
  /** Fully qualified, stable id: `<tier>.<path…>`. */
  id: z.string().min(1),
  tier: tokenTierSchema,
  path: z.array(z.string()).min(1),
  /** `path` joined with `.` — denormalised for cheap lookups. */
  pathString: z.string().min(1),
  /** Final path segment. */
  key: z.string().min(1),

  kind: z.enum(TOKEN_VALUE_KINDS),
  category: z.enum(TOKEN_CATEGORIES),

  /**
   * Value exactly as written in the theme source, before reference resolution.
   *
   * Per-mode because the `sys` tier is authored twice (`sysLight` / `sysDark`) and the
   * two point at different primitives. For `ref` and `comp` both entries are equal.
   */
  authored: perModeSchema(tokenPrimitiveSchema),
  /** Value after `calcTheme()` resolution, per theme mode. */
  resolved: perModeSchema(tokenPrimitiveSchema),
  /** `true` when the light and dark resolutions differ. */
  themeDependent: z.boolean(),

  /** Outgoing edges to other tiers parsed out of `authored`, per mode. */
  references: perModeSchema(z.array(tokenReferenceSchema)),

  /** Populated when `kind === 'color'` and the resolved value parses as a colour. */
  color: perModeSchema(colorValueSchema.nullable()).nullable(),
  /** Populated when the resolved value parses as a single scalar dimension. */
  dimension: perModeSchema(dimensionValueSchema.nullable()).nullable(),

  /** CSS custom property emitted for this token, or `null` for the `comp` tier. */
  cssVariable: z.string().nullable(),

  /** Owning component for `comp`-tier tokens, e.g. `button`; `null` otherwise. */
  component: z.string().nullable(),
  /** Positional decomposition of a `comp`-tier key; `null` for other tiers. */
  facets: compTokenFacetsSchema.nullable(),

  /**
   * Extraction anomalies attached to this token, e.g. `non-finite-number` when the
   * theme evaluates to `NaN`. Empty for well-formed tokens. Aggregated into
   * `diagnostics` so a reader sees both the per-token detail and the summary.
   */
  anomalies: z.array(z.string()),
});

export const tokenReverseIndexSchema = z.object({
  /** `--sds-eng-…` → token id. One-to-one by construction. */
  cssVariable: z.record(z.string(), z.string()),
  /** Canonical `#rrggbbaa` → token ids resolving to that colour, per mode. */
  color: perModeSchema(z.record(z.string(), z.array(z.string()))),
  /** Pixel value (as a decimal string) → token ids, per mode. */
  dimensionPx: perModeSchema(z.record(z.string(), z.array(z.string()))),
  /** Stringified resolved value → token ids, per mode. Catches fonts, shadows, keywords. */
  literal: perModeSchema(z.record(z.string(), z.array(z.string()))),
});

export const tokenScalesSchema = z.object({
  /** Sorted unique pixel values per typographic/geometric scale. */
  borderRadiusPx: z.array(z.number()),
  borderWidthPx: z.array(z.number()),
  fontSizePx: z.array(z.number()),
  lineHeightPx: z.array(z.number()),
  fontWeights: z.array(z.number()),
  fontFamilies: z.array(z.string()),
  letterSpacing: z.array(z.string()),
  /**
   * Every distinct pixel value appearing anywhere in the token set. This is the
   * closest thing the kit has to a spacing scale — see `diagnostics`.
   */
  allDimensionPx: z.array(z.number()),
});

export const diagnosticSeveritySchema = z.enum(["info", "warning", "error"]);

export const diagnosticSchema = z.object({
  code: z.string().min(1),
  severity: diagnosticSeveritySchema,
  message: z.string().min(1),
  /** Token ids or paths the diagnostic refers to; capped to keep the artifact readable. */
  samples: z.array(z.string()),
  count: z.number().int().nonnegative(),
});

export const tokensArtifactSchema = z.object({
  $schema: z.literal("ds-analyzer/tokens@1"),
  meta: z.object({
    /** Path to the UI kit the artifact was extracted from, relative to the repo root. */
    sourceRoot: z.string(),
    themePackageVersion: z.string().nullable(),
    cssVariablePrefix: z.string(),
    modes: z.array(themeModeSchema),
    counts: z.object({
      total: z.number().int().nonnegative(),
      byTier: z.record(tokenTierSchema, z.number().int().nonnegative()),
      byCategory: z.record(z.string(), z.number().int().nonnegative()),
      byKind: z.record(z.string(), z.number().int().nonnegative()),
      components: z.number().int().nonnegative(),
      cssVariables: z.number().int().nonnegative(),
      themeDependent: z.number().int().nonnegative(),
    }),
  }),
  tokens: z.array(tokenSchema),
  scales: tokenScalesSchema,
  reverseIndex: tokenReverseIndexSchema,
  diagnostics: z.array(diagnosticSchema),
});

export type ThemeModeName = z.infer<typeof themeModeSchema>;
export interface PerMode<T> {
  light: T;
  dark: T;
}
export type ColorValueDto = z.infer<typeof colorValueSchema>;
export type DimensionValueDto = z.infer<typeof dimensionValueSchema>;
export type TokenReferenceDto = z.infer<typeof tokenReferenceSchema>;
export type CompTokenFacetsDto = z.infer<typeof compTokenFacetsSchema>;
export type TokenDto = z.infer<typeof tokenSchema>;
export type TokenReverseIndexDto = z.infer<typeof tokenReverseIndexSchema>;
export type TokenScalesDto = z.infer<typeof tokenScalesSchema>;
export type DiagnosticDto = z.infer<typeof diagnosticSchema>;
export type TokensArtifact = z.infer<typeof tokensArtifactSchema>;
