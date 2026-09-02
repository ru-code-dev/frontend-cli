import { z } from "zod";

/**
 * Wire contract for `artifacts/kit-icons.json`.
 *
 * The kit ships its icons as SVG sources (`packages/base/src/icons/svg/ioNN-Name.svg`);
 * the per-icon React components are generated at build time and are absent from a bare
 * checkout, so the SVGs are the ground truth this artifact captures. One entry per icon
 * name; a variant per shipped size.
 *
 * `paths` is stored alongside the fingerprint so the dashboard can *render* a matched
 * icon instead of naming it — a gallery of names is not a gallery.
 */

export const kitIconVariantSchema = z.object({
  /** Nominal size from the filename, e.g. `16` from `io16-Search.svg`. */
  size: z.number().int().positive(),
  viewBox: z.string().nullable(),
  /** Geometry hash from `svgFingerprint`; the match key. */
  fingerprint: z.string().min(1),
  /** Normalized drawing data of each shape, enough to re-render the icon. */
  paths: z.array(z.string()),
});

export const kitIconSchema = z.object({
  /** Icon name from the filename, e.g. `Search` or `META-API`. */
  name: z.string().min(1),
  variants: z.array(kitIconVariantSchema).min(1),
});

export const kitIconsArtifactSchema = z.object({
  $schema: z.literal("ds-analyzer/kit-icons@1"),
  // Timestamp-free like every artifact: run metadata lives in extraction-summary.json,
  // so reruns diff cleanly in version control.
  meta: z.object({
    counts: z.object({
      icons: z.number().int().nonnegative(),
      files: z.number().int().nonnegative(),
      /** SVG files whose geometry could not be read; recorded, never silently dropped. */
      unreadable: z.number().int().nonnegative(),
    }),
  }),
  icons: z.array(kitIconSchema),
  /** Hand-written icon components exported from the icons barrel (`old/`), plus the wrapper. */
  legacyComponents: z.array(z.string()),
});

export type KitIconVariant = z.infer<typeof kitIconVariantSchema>;
export type KitIcon = z.infer<typeof kitIconSchema>;
export type KitIconsArtifact = z.infer<typeof kitIconsArtifactSchema>;
