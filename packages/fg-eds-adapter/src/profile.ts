/**
 * A KIT PROFILE — one design system's shape, as data.
 *
 * ## Why this file exists
 *
 * `@smart-tools/fg-eds-adapter` describes TWO design systems that share a scope and share almost
 * nothing else. EDS 1.x publishes tokens as `var(--sds-eng-…)` custom properties out of
 * `packages/theme`, wraps `@v-uik`, and names its component classes with the upstream's BEM.
 * EDS 2.x publishes them as a member path off `themeTokens`, wraps nothing, styles itself with
 * vanilla-extract and emits build-hashed class names (`WORKFLOW/features/eds2/reports/
 * s1-v2-facts.md` §5 lists the fifteen breaks).
 *
 * The obvious answer — a second adapter package — is the wrong one: the fifteen rule functions
 * would be duplicated, and the day one of them is fixed the other stops agreeing. The answer
 * here is that the RULES stay one implementation and everything they knew about "the kit" that
 * is actually version-specific moves into this object. A rule reads the profile; it never
 * branches on `id`.
 *
 * ## Adding a third design system
 *
 * One `KitProfile` literal, one extractor pipeline (`src/extract/<name>/`), one entry in
 * `EDS_PROFILES`, one artifact directory, one registry row. Nothing in `src/rules/**` changes,
 * because everything in there that could differ between kits is a field below. That claim is
 * what `tests/profile.test.ts` checks: it walks `EDS_PROFILES` rather than naming either kit.
 */
import type { StyleFactoryModule } from "@smart-tools/fg-analyzer-engine";

/**
 * The style dialects the engine's collectors know, restated.
 *
 * `StyleSyntax` is inferred from `styleSyntaxSchema`
 * (`packages/fg-analyzer-engine/src/domain/profile.ts:38-64`) but is NOT exported from that
 * package's entry point, and widening its public surface is not this change's business. The
 * union is repeated here rather than typed as `string[]` so a typo in a profile is a compile
 * error; `tests/profile.test.ts` asserts every value a profile declares is one the engine's own
 * schema accepts, which is what keeps this copy honest.
 */
export type KitStyleSyntax =
  | "css"
  | "css-modules"
  | "scss"
  | "scss-modules"
  | "less"
  | "styled-components"
  | "emotion"
  | "inline-style"
  | "jss"
  | "ts-literal"
  | "vanilla-extract";

/** The two registered profile ids; also the `--ui-kit` spellings and the corpus directories. */
export type KitProfileId = "eds" | "eds2";

/**
 * How a consumer names a token, per channel.
 *
 * BOTH may be present, and for EDS 2.x both are: a token has a stable custom property AND a
 * member path (design §6, correcting the design's own §0 assumption that v2 names are hashed).
 * `prefer` decides which one a finding offers first — the one consumers actually write.
 */
export interface TokenReferenceChannels {
  /** `{ prefix: "sds-eng" }` ⇒ `var(--sds-eng-…)`. `null` when the kit emits no custom props. */
  readonly cssVar: { readonly prefix: string } | null;
  /**
   * `{ modules, exportName }` ⇒ `themeTokens.edsSys.Background.backAccent`.
   *
   * `modules` is a LIST because one object is published from a barrel, a subpath and a second
   * package, and a consumer may reach it by any of them (S1 trap T2). Resolution keys on the
   * IMPORT SOURCE, never on the identifier — the showroom has a `themeTokens` of its own
   * (trap T1).
   */
  readonly jsPath: { readonly modules: readonly string[]; readonly exportName: string } | null;
  readonly prefer: "css-var" | "js-path";
}

/** What the tier system means for THIS kit — the knowledge `token.tier.violation` runs on. */
export interface TokenTierPolicy {
  /**
   * Tiers that are raw paint: referencing one from product code is the violation.
   *
   * EDS 1.x has one (`ref`). EDS 2.x has two, because it carries both its own legacy palette
   * (`edsRef`) and a newer material-style one (`ref`) — S1 break V5.
   */
  readonly primitive: readonly string[];
  /** Tiers a consumer is meant to reference; the replacement is looked for here. */
  readonly semantic: readonly string[];
  /** Where the typography tuples live: `<tier>.<group>.…`, e.g. `edsSys.Typography`. */
  readonly typography: { readonly tier: string; readonly group: string };
  /**
   * When a reference into a primitive tier is a finding.
   *
   * `same-role-only` is EDS 1.x's, and its reasoning is in `rules/tokens/tier.ts`: the kit has
   * far more palette entries than semantic roles, so demanding a role token that does not exist
   * would be demanding a fix nobody can make.
   *
   * `any-colour` is EDS 2.x's, and the difference is a difference in the kits. Its primitive
   * tiers are the kit's OWN theme composition layer — `edsSys` is defined in terms of `edsRef`
   * and `sys` in terms of `ref` — so product code has no business naming either, whether or not
   * a same-role twin happens to exist. The rule stays about COLOUR: `edsRef.borderRadius.m` is
   * the shape scale the kit itself consumes for radii and there is no semantic layer above it,
   * so referencing it is correct and reporting it would be noise.
   */
  readonly tierViolation: "same-role-only" | "any-colour";
}

/** How raw lengths are judged. The two kits publish very different amounts of scale. */
export interface DimensionPolicy {
  /**
   * `true` when a literal that IS on the kit's ramp is still reported (at `info`).
   *
   * EDS 1.x says yes: the value is right and the reference is missing, and the report has
   * always counted that. EDS 2.x says no, and the reason is that its ramp is complete — the
   * theme resolves to 41 distinct pixel values covering spacing, radii and the type ramp, so
   * `gap: 8` in a v2 project is the kit's own step written as a number. Reporting every one of
   * them at `info` would bury the ones that are actually off the scale, which is the finding
   * that matters.
   */
  readonly reportOnScale: boolean;
  /**
   * What judges a property no named ramp governs (`padding`, `gap`, `height`).
   *
   * `frequency` is v1's: the kit publishes no spacing tier (its own `spacing-scale-missing`
   * diagnostic), so the only evidence is how rare the value is in the project itself.
   * `kit-dimensions` is v2's: the kit's resolved token set IS a spacing scale, so a value is
   * judged against it and the project's habits are not consulted at all.
   */
  readonly scaleless: "frequency" | "kit-dimensions";
  /**
   * Which properties a raw length is judged on at all.
   *
   * `engine` keeps `dimensionScaleOf`'s list (`packages/fg-analyzer-engine/src/css/
   * properties.ts:77-102`): the four named ramps plus padding and gap. That list exists because
   * EDS 1.x can say nothing about a `height` — it publishes no scale that would judge one.
   *
   * `all-lengths` is EDS 2.x's, and it is only honest because its ramp is complete: with 41
   * resolved pixel values covering the whole theme, `height: 21px` and `width: 213px` ARE
   * answerable, and leaving them out would mean the two most common hand-typed sizes in a
   * migration go unreported. A property the engine's list already governs keeps its named ramp;
   * only the properties it declines are picked up.
   */
  readonly governs: "engine" | "all-lengths";
}

/** How `style.override` recognises the kit's own classes in a consumer's selector. */
export interface ClassNamePolicy {
  /**
   * `"sds-eng"` — the prefix every emitted class starts with, or `null` when the kit's classes
   * are not recognisable from their name (EDS 1.x, whose classes are the upstream's BEM and are
   * reached through the linking pass instead).
   *
   * A PREFIX and not a whole name, because a v2 class ends in a build hash that moves whenever
   * a file moves (S1 §4): `sds-eng-button-root-1yq2fw03` today, something else tomorrow. A
   * consumer physically cannot write an exact kit class, so they write
   * `[class*='sds-eng-button-root']` — and matching anything narrower than the prefix would find
   * nothing a real project contains.
   */
  readonly prefix: string | null;
}

/**
 * Everything the adapter needs to know about ONE version of the design system.
 *
 * Every field answers a question a rule or an extractor would otherwise have hardcoded.
 */
export interface KitProfile {
  readonly id: KitProfileId;
  /** Shown in the report's adapter stamp and in `--help`. */
  readonly displayName: string;
  /** The packages that ARE the kit; autodetect and `import.internal` both read this. */
  readonly packages: readonly string[];
  /** The scope the kit wraps, or `null` when it wraps nothing. */
  readonly upstreamScope: string | null;
  readonly tokenReference: TokenReferenceChannels;
  readonly tokens: TokenTierPolicy;
  readonly dimensions: DimensionPolicy;
  readonly classNames: ClassNamePolicy;
  /** Modules whose exports produce vanilla-extract style objects; passed to the scanner. */
  readonly styleFactories: readonly StyleFactoryModule[];
  /** The style dialects a consumer of this kit is expected to write. */
  readonly styling: readonly KitStyleSyntax[];
  /** Where `--parse-ui-kit <id>` clones from when `--source` says nothing. */
  readonly source: { readonly repo: string; readonly ref: string | null };
  /** Which extraction pipeline regenerates this kit's corpus. */
  readonly extractor: "v1" | "v2";
  /** `~/.fg/kits/<corpusDir>/`. */
  readonly corpusDir: string;
  /**
   * `true` when `api.deprecated` also inspects IMPORT BINDINGS, not only JSX elements.
   *
   * EDS 1.x deprecates components, which are read off JSX. EDS 2.x's public deprecations are
   * two HOOKS — `useFieldSizing` and `useLocalStorage` — which never appear as an element, so
   * a JSX-only rule reports zero on a project that uses them every day. Profile-gated rather
   * than switched on for everyone, because widening the rule for v1 would change the parity
   * goldens this package is required to keep byte-identical.
   */
  readonly deprecatedImports: boolean;
  /**
   * How `variantValues(component, prop)` finds a prop's legal values.
   *
   * `plural` is the EDS 1.x convention — a const object called `views` governs `view`. `exact`
   * is EDS 2.x's, where the authority is `recipe({ variants: { view: … } })` and the group is
   * named exactly as the prop (S1 break V6).
   */
  readonly variantLookup: "plural" | "exact";
}

/** Where each kit is cloned from. One statement, re-exported as the adapter's metadata. */
export const EDS_REPOSITORY = "https://gitverse.ru/sbertech/ui-kit-eds-ce.git";

/** The EDS 2.x branch. `null` for v1, which lives on the repository's default branch. */
export const EDS2_REF = "develop-2.0";

export const EDS_PROFILES: Readonly<Record<KitProfileId, KitProfile>> = {
  eds: {
    id: "eds",
    displayName: "EDS 1.x",
    packages: ["@sds-eng/base", "@sds-eng/theme"],
    upstreamScope: "@v-uik",
    tokenReference: {
      cssVar: { prefix: "sds-eng" },
      jsPath: null,
      prefer: "css-var",
    },
    tokens: {
      primitive: ["ref"],
      semantic: ["sys"],
      typography: { tier: "sys", group: "Typography" },
      tierViolation: "same-role-only",
    },
    dimensions: { reportOnScale: true, scaleless: "frequency", governs: "engine" },
    classNames: { prefix: null },
    styleFactories: [],
    styling: ["css", "scss", "css-modules", "styled-components", "emotion", "inline-style"],
    source: { repo: EDS_REPOSITORY, ref: null },
    extractor: "v1",
    corpusDir: "eds",
    deprecatedImports: false,
    variantLookup: "plural",
  },
  eds2: {
    id: "eds2",
    displayName: "EDS 2.x",
    packages: ["@sds-eng/base-exp", "@sds-eng/kit-exp"],
    // Nothing. `import.bypass` stays registered so one `fg.config.json` addresses both kits
    // (design E6) and declares a `no-upstream` limitation instead of emitting findings.
    upstreamScope: null,
    tokenReference: {
      // The names are NOT hashed: the kit's `identifiers` hook returns `sds-eng-${debugId}`
      // with no hash for every file called `tokens`, and all five tier contracts live in one
      // (`../ui-kit-eds-ce-2/vite.config.base.ts:14-21`, verified against the real library —
      // S1 §1d). So a v2 token has both channels, and a finding can offer both.
      cssVar: { prefix: "sds-eng" },
      jsPath: {
        modules: ["@sds-eng/base-exp", "@sds-eng/kit-exp", "@sds-eng/base-exp/theme"],
        exportName: "themeTokens",
      },
      // What a consumer writes (S1 §4): the member path. The custom property is offered second.
      prefer: "js-path",
    },
    tokens: {
      primitive: ["edsRef", "ref"],
      semantic: ["edsSys", "sys"],
      typography: { tier: "edsSys", group: "Typography" },
      tierViolation: "any-colour",
    },
    dimensions: { reportOnScale: false, scaleless: "kit-dimensions", governs: "all-lengths" },
    classNames: { prefix: "sds-eng" },
    styleFactories: [
      // `makeStyles` is the kit-internal factory a consumer *can* call
      // (`../ui-kit-eds-ce-2/packages/base/src/theme/makeStyles.ts:14-39`); declaring it makes a
      // file that never imports `@vanilla-extract/*` still take part in the dialect.
      { module: "@sds-eng/base-exp", names: ["makeStyles", "createStyle", "createRecipe"] },
      { module: "@sds-eng/kit-exp", names: ["makeStyles", "createStyle", "createRecipe"] },
    ],
    styling: ["vanilla-extract", "inline-style", "css", "css-modules"],
    source: { repo: EDS_REPOSITORY, ref: EDS2_REF },
    extractor: "v2",
    corpusDir: "eds2",
    deprecatedImports: true,
    variantLookup: "exact",
  },
};

/** The registered ids, in registry order. */
export const KIT_PROFILE_IDS: readonly KitProfileId[] = ["eds", "eds2"];
