import { z } from "zod";

/**
 * Wire contract for `artifacts/kit-a11y.json` — what the kit's own components do about
 * accessibility, and the spacing scale its implementations actually follow.
 *
 * Both facts come from `@v-uik`, the upstream library the kit wraps, and both exist for the
 * same reason: the analyzer makes claims about consumer code that are only honest if the
 * kit has been checked first.
 *
 *  - "Replace your hand-rolled tabs with the kit's" is advice worth giving only once we can
 *    show the kit's `Tabs` handles the arrow keys. Until then it is a guess wearing a
 *    recommendation's clothes.
 *  - "13px is a magic number" needs something to be magic against. The kit publishes no
 *    spacing tier, so the alternative was a frequency heuristic over the consumer's own
 *    code — which cannot distinguish a team's spacing unit from a mistake repeated often.
 *
 * Extracted from compiled `dist/` output, so it is evidence rather than specification:
 * every record carries the file it came from and rules must not treat absence as proof of
 * absence. See `confidence` on the pattern records.
 */

export const kitPatternSchema = z.object({
  /** Kit component name, e.g. `Tabs`. */
  component: z.string().min(1),
  /** `@v-uik` packages the evidence was read from. */
  packages: z.array(z.string()),
  /**
   * How the component was tied to its upstream package.
   *
   * `wraps` is read from `components.json`; `name` is a fallback for the thirty-four
   * components that import through the `@v-uik/base` barrel and therefore declare no
   * specific package. The fallback is reliable here because the upstream's naming is
   * one-to-one, but it is a guess and is labelled as one.
   */
  matchedBy: z.enum(["wraps", "name"]),
  /** ARIA roles the implementation renders, e.g. `['tab', 'tablist']`. */
  roles: z.array(z.string()),
  /** `aria-*` attributes the implementation sets. */
  ariaAttributes: z.array(z.string()),
  /** `KeyboardEvent.key` values the implementation compares against. */
  keysHandled: z.array(z.string()),
  /** `true` when the implementation reaches for focus-management helpers. */
  managesFocus: z.boolean(),
});

/**
 * A spacing step and how much of the kit stands behind it.
 *
 * Kept as counts rather than a bare list because the distribution is the argument: `8px`
 * appears 132 times and `11px` three times, and collapsing both into "on the scale" would
 * throw away the only thing that distinguishes a step from an accident.
 */
export const spacingStepSchema = z.object({
  px: z.number().int().nonnegative(),
  occurrences: z.number().int().positive(),
});

export const kitA11yArtifactSchema = z.object({
  $schema: z.literal("ds-analyzer/kit-a11y@1"),
  meta: z.object({
    /** `@v-uik` version the evidence was read from. */
    upstreamVersion: z.string(),
    /** Packages scanned, so a partial install is visible rather than silent. */
    packagesScanned: z.number().int().nonnegative(),
    /**
     * `false` when `@v-uik` was not installed. Every collection is then empty, and rules
     * that depend on this artifact must report a limitation instead of a finding.
     */
    upstreamAvailable: z.boolean(),
  }),
  patterns: z.array(kitPatternSchema),
  spacing: z.object({
    /**
     * Steps holding at least `minShare` of all spacing declarations, ascending.
     *
     * This is a scale the kit follows, not one it publishes — `@v-uik` has no spacing tier.
     * Rules must weight it accordingly: a value off this scale is worth an `info`, never
     * the `error` that a value off the published radius ramp would earn.
     */
    steps: z.array(spacingStepSchema),
    /** Every spacing declaration counted, including the ones that did not make the scale. */
    totalDeclarations: z.number().int().nonnegative(),
    /** Share of declarations the scale accounts for; the scale's own trustworthiness. */
    coverage: z.number().min(0).max(1),
    /**
     * The grid the steps sit on, in pixels.
     *
     * Frequency alone does not separate a step from an accident here: `12px` appears six
     * times and `15px` three, and no threshold splits them without also discarding `24px`
     * and `32px`, which are plainly real. Divisibility does what frequency cannot — every
     * genuine step is a multiple of this base, and every value that is not is an outlier
     * regardless of how often the upstream repeated it.
     */
    gridBase: z.number().int().positive(),
    /** Share of declarations that are multiples of {@link gridBase}. */
    gridCoverage: z.number().min(0).max(1),
    /** Steps observed that are not multiples of the grid — the upstream's own outliers. */
    offGridSteps: z.array(spacingStepSchema),
  }),
  diagnostics: z.array(
    z.object({
      code: z.string(),
      severity: z.enum(["info", "warning", "error"]),
      message: z.string(),
      samples: z.array(z.string()),
      count: z.number().int().nonnegative(),
    }),
  ),
});

export type KitPattern = z.infer<typeof kitPatternSchema>;
export type SpacingStep = z.infer<typeof spacingStepSchema>;
export type KitA11yArtifact = z.infer<typeof kitA11yArtifactSchema>;
