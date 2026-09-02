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

export type TokenTier = (typeof TOKEN_TIERS)[number];

export const THEME_MODES = ["light", "dark"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

/**
 * Root key each tier occupies inside the runtime theme object produced by
 * `calcTheme()`, used to build fully-qualified token ids.
 */
export const TIER_ROOT_KEY: Readonly<Record<TokenTier, string>> = {
  ref: "edsRef",
  sys: "edsSys",
  comp: "comp",
};

/** Fully-qualified, mode-independent token id, e.g. `sys.Background.backAccent`. */
export const toTokenId = (tier: TokenTier, path: readonly string[]): string =>
  [tier, ...path].join(".");
