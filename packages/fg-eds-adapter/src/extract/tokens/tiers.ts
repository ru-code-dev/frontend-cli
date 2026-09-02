/**
 * The three token tiers of the sds-eng design system.
 *
 * - `ref`  — primitives with no semantics: the raw palette, the type ramp, radii.
 *            Consumers must not reference these directly; doing so bypasses theming.
 * - `sys`  — semantic aliases resolved per theme mode (`Background.backAccent`).
 *            This is the tier product code is expected to consume.
 * - `comp` — per-component contracts (`button.colorBackgroundContainedPrimary`),
 *            consumed by the components themselves rather than by product code.
 */
export const TOKEN_TIERS = ["ref", "sys", "comp"] as const;

/**
 * EDS 2.x has FIVE top-level tiers, not three (S1 break V5, `reports/s1-v2-facts.md:386`):
 * `ref`/`sys` are a new material-style pair and `edsRef`/`edsSys` are the two the 1.x artifact
 * calls `ref`/`sys`. So a v2 `sys.color.*` and a v1 `sys.Background.*` are different things, and
 * a v1 `sys.Background.backAccent` is a v2 `edsSys.Background.backAccent`.
 *
 * TOKEN IDS ARE THEREFORE PER-PROFILE and nothing keyed on one may cross profiles — which is why
 * the artifact records the tier as data and the SPEC, not this module, decides what a tier means.
 * The union below is the wire vocabulary of both profiles; {@link TOKEN_TIERS} stays exactly the
 * three v1 emits, so a v1 re-extraction's `meta.counts.byTier` keeps its three keys.
 */
export const TOKEN_TIERS_V2 = ["comp", "edsRef", "edsSys", "ref", "sys"] as const;

/** Every tier name either profile can emit. */
export const ALL_TOKEN_TIERS = ["ref", "sys", "comp", "edsRef", "edsSys"] as const;

export type TokenTier = (typeof ALL_TOKEN_TIERS)[number];

export const THEME_MODES = ["light", "dark"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

/**
 * Root key each tier occupies inside the runtime theme object produced by
 * `calcTheme()`, used to build fully-qualified token ids.
 */
export const TIER_ROOT_KEY: Readonly<Record<(typeof TOKEN_TIERS)[number], string>> = {
  ref: "edsRef",
  sys: "edsSys",
  comp: "comp",
};

/** Fully-qualified, mode-independent token id, e.g. `sys.Background.backAccent`. */
export const toTokenId = (tier: TokenTier, path: readonly string[]): string =>
  [tier, ...path].join(".");
