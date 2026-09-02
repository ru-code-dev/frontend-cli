/**
 * The five artifact shapes this adapter embeds, as read.
 *
 * Ported from the Zod contracts in `hackathon2026/ds-analyzer/src/domain/{tokens,components,
 * kit-a11y,kit-icons,kit-knowledge}.ts`, as TypeScript interfaces rather than as schemas, and
 * that choice is worth defending.
 *
 * In the hackathon those schemas ran twice: the extractor validated what it *wrote*, and the
 * analyzer validated what it *read* off a directory a user could have edited, deleted or built
 * with a different version of the tool (`kit/spec.ts:200-208`). Here there is no directory and
 * no user: the JSON is compiled into `dist/index.mjs` by this package's own build, from files
 * committed alongside this source. Re-parsing four megabytes on every run would validate the
 * build against itself, cost the run a second, and drag a second copy of every extractor-side
 * enum (`TOKEN_CATEGORIES`, `REFERENCE_TIERS`, `THEME_MODES` …) into a package that reads none
 * of them.
 *
 * What replaces the runtime check is a build-time one: `tests/artifacts.test.ts` asserts the
 * shape and the counts of every embedded file, so a re-extraction that changed the contract
 * fails the suite instead of failing a user's run.
 *
 * Only the fields the specs and rules actually read are declared. A field left out is a field
 * nothing consults; it is still in the JSON, and adding its declaration is the whole cost of
 * starting to use it.
 */

export type ThemeModeName = "light" | "dark";

export interface PerMode<T> {
  readonly light: T;
  readonly dark: T;
}

export interface ColorValueDto {
  /** Canonical `#rrggbbaa`. */
  readonly hex: string;
}

export interface DimensionValueDto {
  readonly px: number | null;
}

export type TokenPrimitive = string | number | boolean | null;

export interface TokenDto {
  /** Fully qualified, stable id: `<tier>.<path…>`. */
  readonly id: string;
  readonly tier: "ref" | "sys" | "comp";
  readonly path: readonly string[];
  /** `path` joined with `.` — denormalised for cheap lookups. */
  readonly pathString: string;
  /** Final path segment. */
  readonly key: string;
  readonly kind: string;
  /** Value after theme resolution, per mode. */
  readonly resolved: PerMode<TokenPrimitive>;
  /** Populated when the resolved value parses as a colour. */
  readonly color: PerMode<ColorValueDto | null> | null;
  /** Populated when the resolved value parses as a single scalar dimension. */
  readonly dimension: PerMode<DimensionValueDto | null> | null;
  /** CSS custom property emitted for this token, or `null` for the `comp` tier. */
  readonly cssVariable: string | null;
}

export interface TokenScalesDto {
  readonly borderRadiusPx: readonly number[];
  readonly borderWidthPx: readonly number[];
  readonly fontSizePx: readonly number[];
  readonly lineHeightPx: readonly number[];
  readonly fontWeights: readonly number[];
  readonly fontFamilies: readonly string[];
  readonly letterSpacing: readonly string[];
  readonly allDimensionPx: readonly number[];
}

export interface TokensArtifact {
  readonly $schema: string;
  readonly tokens: readonly TokenDto[];
  readonly scales: TokenScalesDto;
}

export interface VariantSetDto {
  /** Identifier of the declaration, e.g. `views`. */
  readonly name: string;
  /** Public keys, i.e. the values a consumer writes in JSX. */
  readonly keys: readonly string[];
}

export interface SlotSetDto {
  readonly slots: readonly { readonly name: string; readonly doc: { readonly inner: boolean } }[];
}

export interface UiKitComponentDto {
  readonly name: string;
  /** `true` when re-exported from the kit's public barrel. */
  readonly public: boolean;
  readonly variants: readonly VariantSetDto[];
  readonly slots: readonly SlotSetDto[];
  /** Packages under the wrapped-upstream scope that this component wraps. */
  readonly wraps: readonly string[];
}

export interface PublicSymbolDto {
  readonly name: string;
  readonly deprecated: boolean;
  readonly deprecationNote: string | null;
}

export interface ComponentsArtifact {
  readonly $schema: string;
  readonly components: readonly UiKitComponentDto[];
  readonly publicSymbols: readonly PublicSymbolDto[];
}

export interface KitPattern {
  readonly component: string;
  /** ARIA roles the implementation renders. */
  readonly roles: readonly string[];
  /** `aria-*` attributes the implementation sets. */
  readonly ariaAttributes: readonly string[];
  /** `KeyboardEvent.key` values the implementation compares against. */
  readonly keysHandled: readonly string[];
  readonly managesFocus: boolean;
}

export interface SpacingStep {
  readonly px: number;
  readonly occurrences: number;
}

export interface KitA11yArtifact {
  readonly $schema: string;
  readonly meta: {
    readonly upstreamVersion: string;
    readonly packagesScanned: number;
    /** `false` when the upstream was not installed; every collection is then empty. */
    readonly upstreamAvailable: boolean;
  };
  readonly patterns: readonly KitPattern[];
  readonly spacing: {
    readonly steps: readonly SpacingStep[];
    readonly totalDeclarations: number;
    readonly coverage: number;
    readonly gridBase: number;
    readonly gridCoverage: number;
    readonly offGridSteps: readonly SpacingStep[];
  };
}

export interface KitIconVariant {
  readonly size: number;
  readonly viewBox: string | null;
  /** Geometry hash from `svgFingerprint`; the match key. */
  readonly fingerprint: string;
  /** Normalized drawing data of each shape, enough to re-render the icon. */
  readonly paths: readonly string[];
}

export interface KitIcon {
  readonly name: string;
  readonly variants: readonly KitIconVariant[];
}

export interface KitIconsArtifact {
  readonly $schema: string;
  readonly meta: { readonly counts: { readonly icons: number; readonly files: number } };
  readonly icons: readonly KitIcon[];
  readonly legacyComponents: readonly string[];
}

export interface KitSignature {
  readonly name: string;
  /** Prop names visible on a bare checkout. Known-incomplete. */
  readonly propSignature: readonly string[];
  /** TF-IDF weight per prop across the whole kit — what makes prop overlap meaningful. */
  readonly propWeights: Readonly<Record<string, number>>;
  readonly ariaRoles: readonly string[];
  readonly ariaAttributes: readonly string[];
  /** Host tags the kit component's own source renders. */
  readonly nativeTags: readonly string[];
  /** CSS properties reachable from the component source. */
  readonly cssProperties: readonly string[];
  /** Identifier-free token stream of the component source, for clone detection. */
  readonly astSignature: readonly string[];
  /** Names the ecosystem uses for the same concept. */
  readonly synonyms: readonly string[];
}

export interface KitSignaturesArtifact {
  readonly $schema: string;
  readonly meta: {
    readonly counts: { readonly components: number; readonly withoutSource: number };
  };
  readonly signatures: readonly KitSignature[];
}
