import type { KitAdapter, KitBinding, Rule } from "@smart-tools/fg-analyzer-engine";

import { COMPONENTS, KIT_A11Y, KIT_ICONS, KIT_SIGNATURES, TOKENS } from "./artifacts/index.ts";
import {
  COMPONENTS_V2,
  KIT_A11Y_V2,
  KIT_ICONS_V2,
  KIT_SIGNATURES_V2,
  TOKENS_V2,
} from "./artifacts/v2/index.ts";
import type {
  ComponentsArtifact,
  KitA11yArtifact,
  KitIconsArtifact,
  KitSignaturesArtifact,
  TokensArtifact,
} from "./domain/artifacts.ts";
import { DEFAULT_KIT_SOURCE } from "./extract/provenance.ts";
import { EDS_PROFILES, type KitProfile } from "./profile.ts";
import { A11ySpec } from "./kit/a11y-spec.ts";
import { IconSpec } from "./kit/icon-spec.ts";
import { KnowledgeSpec } from "./kit/knowledge-spec.ts";
import { KitSpec } from "./kit/spec.ts";
import { summaryExtras } from "./metrics/health.ts";
import { patternKeyboardRule } from "./rules/a11y/pattern-keyboard.ts";
import { bypassImportRule, doNotUseImportRule, internalImportRule } from "./rules/api/imports.ts";
import { styleOverrideRule } from "./rules/api/overrides.ts";
import { deprecatedApiRule, invalidPropRule } from "./rules/api/props.ts";
import { customComponentRule, novelComponentRule } from "./rules/components/custom.ts";
import { foreignSvgFileRule, inlineSvgRule } from "./rules/icons/icons.ts";
import type { KitContext } from "./rules/kit-context.ts";
import { colorLiteralRule } from "./rules/tokens/color.ts";
import { dimensionLiteralRule } from "./rules/tokens/dimension.ts";
import { foreignFontRule } from "./rules/tokens/font.ts";
import { tierViolationRule } from "./rules/tokens/tier.ts";
import { partialTypographyRule } from "./rules/tokens/typography.ts";

/**
 * `@smart-tools/fg-eds-adapter` — the EDS design system, as one importable object.
 *
 * ## What this package is
 *
 * Everything `@smart-tools/fg-analyzer-engine` cannot know on its own about one particular
 * design system: five extracted artifacts (4.1 MB of JSON, compiled into `dist/index.mjs` by
 * this package's own build) and the fifteen rule functions that read them. Import
 * {@link edsAdapter}, hand it to `analyzeProject`, and the engine reports everything the
 * hackathon's `ds-analyzer` reported. Import nothing, and the engine is exactly what it was.
 *
 * ## Why it is an object rather than a directory
 *
 * The hackathon's analyzer opened `artifacts/tokens.json` with an unguarded `readFileSync`
 * before any rule ran (`ds-analyzer/src/cli/run-analyze.ts:56`; h2 §3, h5 §4.2 both call it the
 * blocker). Anyone without the kit checked out got a stack trace instead of an audit. Here the
 * artifacts are `import`ed, so they are in the bundle: there is no path to get wrong, no
 * `existsSync` to be false, and no failure mode between "the adapter is installed" and "the
 * adapter works".
 *
 * ## The nineteen rule ids
 *
 * Fifteen rule functions, nineteen ids — `style.override` emits four and `component.custom`
 * emits three. Together with the engine's eleven (one of which, `component.duplicate`, stands
 * down here in favour of the source's `component.novel`, which emits it) that is the
 * hackathon's full registry of 32 ids, restored.
 *
 * ## TWO design systems, one set of rules
 *
 * This package describes EDS 1.x and EDS 2.x, which share a scope and share almost nothing else:
 * 1.x publishes tokens as `var(--sds-eng-…)` out of `packages/theme` and wraps `@v-uik`; 2.x
 * publishes them as a member path off `themeTokens`, wraps nothing, styles itself with
 * vanilla-extract and emits build-hashed class names (`WORKFLOW/features/eds2/reports/
 * s1-v2-facts.md` §5 lists all fifteen differences).
 *
 * The fifteen rule functions above are ONE implementation for both. Everything they used to know
 * about "the kit" that turns out to be version-specific lives in a {@link KitProfile}
 * (`./profile.ts`) — which tiers are primitive, which channel a consumer writes, how a class
 * name is recognised, which subpaths are public. A rule reads the profile; no rule branches on
 * `profile.id`. Adding a THIRD design system is one profile literal, one extractor pipeline
 * under `src/extract/<name>/`, one artifact directory and one registry row, with nothing in
 * `src/rules/**` touched — and `tests/profile.test.ts` walks `EDS_PROFILES` rather than naming a
 * kit, so the third one is covered the moment it is registered.
 */

/**
 * The five artifacts an adapter is built from — embedded, or read off disk.
 *
 * This interface is the whole reason `--parse-ui-kit` can change what a report measures against
 * without changing a single rule: every rule below reaches its data through the {@link KitContext}
 * that {@link createEdsAdapter} closes over, so swapping the five inputs swaps the design system
 * and nothing else moves.
 */
export interface EdsArtifacts {
  readonly tokens: TokensArtifact;
  readonly components: ComponentsArtifact;
  readonly "kit-a11y": KitA11yArtifact;
  readonly "kit-icons": KitIconsArtifact;
  readonly "kit-signatures": KitSignaturesArtifact;
}

/** The EDS 1.x snapshot compiled into this bundle. */
export const EMBEDDED_ARTIFACTS: EdsArtifacts = {
  tokens: TOKENS,
  components: COMPONENTS,
  "kit-a11y": KIT_A11Y,
  "kit-icons": KIT_ICONS,
  "kit-signatures": KIT_SIGNATURES,
};

/** The EDS 2.x snapshot, extracted from `develop-2.0` by this package's own v2 pipeline. */
export const EMBEDDED_ARTIFACTS_V2: EdsArtifacts = {
  tokens: TOKENS_V2,
  components: COMPONENTS_V2,
  "kit-a11y": KIT_A11Y_V2,
  "kit-icons": KIT_ICONS_V2,
  "kit-signatures": KIT_SIGNATURES_V2,
};

/**
 * The version the embedded snapshot describes, read off the snapshot itself.
 *
 * NOT a literal `"1.13.0"` sitting in this file. `tokens.json`'s `meta.themePackageVersion` is
 * the value the extractor stamped from `packages/theme/package.json` of the checkout it ran
 * against, so re-embedding a newer snapshot updates the notice with no edit here — and a literal
 * would be the second place the version is written down, which is one too many.
 */
export const EMBEDDED_VERSION: string | null = TOKENS.meta?.themePackageVersion ?? null;

/**
 * The EDS 2.x version the embedded v2 snapshot describes — `2.0.0`.
 *
 * Read off the snapshot for the same reason as {@link EMBEDDED_VERSION}: the extractor stamped
 * it from `packages/base/package.json` of the checkout it ran against (S1 break V11 — EDS 2.x
 * has no `packages/theme` to read a version from), so re-embedding a newer snapshot updates the
 * notice with no edit here.
 */
export const EMBEDDED_VERSION_V2: string | null = TOKENS_V2.meta?.themePackageVersion ?? null;

/**
 * Build the adapter over one set of artifacts.
 *
 * WHY A FACTORY, when `edsAdapter` below is the only thing the registry consumes. Because the
 * five artifacts are no longer a compile-time constant: `fg --parse-ui-kit eds` writes a newer
 * five to `~/.fg/kits/eds/`, and a run that finds them there must measure against those. The
 * alternative — an adapter that reads the corpus itself, lazily, on first rule call — is exactly
 * the unguarded-read seam this package was built to remove (`src/artifacts/index.ts:26-29`);
 * making the artifacts an ARGUMENT keeps the loading decision at the edge, where it can fail
 * softly, and leaves this function total and synchronous.
 *
 * Rule order mirrors `hackathon2026/ds-analyzer/src/rules/index.ts:37-64` with the engine's own
 * eleven removed. Order is not load-bearing — findings are re-sorted by source position — but
 * keeping it makes the two registries diffable against each other.
 */
export function createEdsAdapter(
  artifacts: EdsArtifacts = EMBEDDED_ARTIFACTS,
  profile: KitProfile = EDS_PROFILES.eds,
): KitAdapter {
  const kit = new KitSpec(artifacts.tokens, artifacts.components, "light", profile);
  const a11y = new A11ySpec(artifacts["kit-a11y"]);
  const icons = new IconSpec(artifacts["kit-icons"]);
  const knowledge = new KnowledgeSpec(artifacts["kit-signatures"]);

  const kitContext: KitContext = { kit, a11y, icons, knowledge };

  const rules: readonly Rule[] = [
    colorLiteralRule(kitContext),
    dimensionLiteralRule(kitContext),
    partialTypographyRule(kitContext),
    foreignFontRule(kitContext),
    tierViolationRule(kitContext),
    bypassImportRule(kitContext),
    internalImportRule(kitContext),
    doNotUseImportRule(kitContext),
    invalidPropRule(kitContext),
    deprecatedApiRule(kitContext),
    styleOverrideRule(kitContext),
    patternKeyboardRule(kitContext),
    inlineSvgRule(kitContext),
    foreignSvgFileRule(kitContext),
    customComponentRule(kitContext),
    novelComponentRule(kitContext),
  ];

  /**
   * The four queries the engine's own rules and metrics put to this kit.
   *
   * Everything else the rules above need is reached through the closure they were built with,
   * which is why this surface stays four functions wide however large the kit gets.
   */
  const jsPath = profile.tokenReference.jsPath;

  const binding: KitBinding = {
    iconCount: icons.iconCount,
    tokenColorHex: (cssVariable) => kit.tokenByCssVariable(cssVariable)?.color?.light?.hex ?? null,
    tokenIdOf: (cssVariable) => kit.tokenByCssVariable(cssVariable)?.id ?? null,
    // THE SECOND REFERENCE CHANNEL, declared only by a profile that has one. The engine calls
    // these instead of widening the two above, so the css-var-only profile's binding is the
    // object it has always been (`WORKFLOW/features/eds2/reports/a8-engine-vanilla-jspath.md`
    // §7, D2). `undefined` means "this kit has no js-path model", which is a different fact
    // from "that path is not a token" and the engine treats it as one.
    ...(jsPath === null
      ? {}
      : {
          tokenIdOfReference: (reference) => kit.tokenIdForReference(reference),
          tokenColorHexOfReference: (reference) =>
            kit.tokenForReference(reference)?.color?.light?.hex ?? null,
          tokenReferenceModel: {
            kind: "js-path" as const,
            modules: jsPath.modules,
            exportName: jsPath.exportName,
            ...(profile.styleFactories.length === 0
              ? {}
              : { styleFactories: profile.styleFactories }),
          },
        }),
    a11yAvailable: a11y.available,
    canonicalComponentFor: (role) => a11y.canonicalComponentFor(role),
    variantValues: (component, prop) => kit.variantValues(component, prop),
    componentNames: () => kit.componentNames(),
  };

  return {
    id: profile.id,
    kitPackages: profile.packages,
    wrappedUpstreamScope: profile.upstreamScope,
    rules,
    // See `rules/components/custom.ts`: `component.novel` emits `component.duplicate` too, so
    // the engine's split-out copy of the clustering must not also run.
    replaces: ["component.duplicate"],
    domains: ["tokens", "api"],
    binding,
    summaryExtras: summaryExtras(kit),
  };
}

/** The `--ui-kit` / `--parse-ui-kit` spelling, and the corpus directory name. */
export const EDS_KIT_ID = EDS_PROFILES.eds.id;

/** The `--ui-kit` spelling of EDS 2.x. */
export const EDS2_KIT_ID = EDS_PROFILES.eds2.id;

/**
 * The packages that *are* the kit, and the scope it wraps. These were module constants in the
 * hackathon's scanner (`profile/kit-sources.ts:29,37`), which is what made that file
 * un-portable; they are data here — in `profile.ts`, which owns every such fact for both kit
 * versions — and these two names are the 1.x re-exports the rest of the repository already
 * imports.
 */
export const KIT_PACKAGES: readonly string[] = EDS_PROFILES.eds.packages;

export const WRAPPED_UPSTREAM_SCOPE = EDS_PROFILES.eds.upstreamScope;

/**
 * WHERE THE KIT IS CLONED FROM when `--parse-ui-kit eds` is given no `--source`.
 *
 * Deliberately here, beside {@link KIT_PACKAGES}, rather than in the CLI: "which repository is
 * this design system" is the same KIND of fact as "which packages are this design system", it
 * changes when the kit moves rather than when the CLI changes, and splitting the two across
 * packages is how the CLI ends up knowing a design system by name. The value itself lives once,
 * in `extract/provenance.ts`, and is re-exported here as the adapter's metadata.
 */
export const EDS_SOURCE = DEFAULT_KIT_SOURCE;

/**
 * THE ADAPTER, over the embedded snapshot — what the registry consumes when nothing on disk
 * supersedes it. A run that finds a valid `~/.fg/kits/eds/` builds its own with
 * {@link createEdsAdapter} instead.
 */
export const edsAdapter: KitAdapter = createEdsAdapter();

/**
 * THE EDS 2.x ADAPTER, over the embedded v2 snapshot.
 *
 * The same fifteen rule functions and the same four specs as {@link edsAdapter}: what differs
 * between the two objects is entirely the profile and the artifacts they were built from, which
 * is the property the whole `KitProfile` design exists to have.
 */
export const eds2Adapter: KitAdapter = createEdsAdapter(EMBEDDED_ARTIFACTS_V2, EDS_PROFILES.eds2);

export type { KitProfile, KitProfileId } from "./profile.ts";
export { EDS2_REF, EDS_PROFILES, EDS_REPOSITORY, KIT_PROFILE_IDS } from "./profile.ts";

export { A11ySpec } from "./kit/a11y-spec.ts";
export { IconSpec } from "./kit/icon-spec.ts";
export { KnowledgeSpec } from "./kit/knowledge-spec.ts";
export { KitSpec } from "./kit/spec.ts";
export { svgFingerprint, type SvgGeometry } from "./icons/fingerprint.ts";
export type * from "./domain/artifacts.ts";

/* --------------------------------------------------------------------------------------- *
 * THE EXTRACTION SIDE — everything `fg --parse-ui-kit eds` needs, and nothing a report needs.
 *
 * It is exported from the SAME entry point as the adapter because it is the same knowledge:
 * the extractors and the rules are two readings of one design system, and a corpus written by
 * one is the corpus the other consumes. Splitting them into two packages would put the schema
 * that validates a file and the code that writes it on opposite sides of a version boundary.
 * --------------------------------------------------------------------------------------- */

export type {
  CorpusProvenance,
  CorpusWarning,
  LoadCorpusOptions,
  LoadedCorpus,
  WriteCorpusOptions,
} from "./corpus.ts";
export {
  corpusDir,
  corpusFile,
  KITS_DIR_ENV,
  kitsRoot,
  loadCorpus,
  writeCorpus,
} from "./corpus.ts";
export type {
  CorpusMember,
  ExtractedKit,
  ExtractKitOptions,
  KitCorpus,
} from "./extract/pipeline.ts";
export {
  CORPUS_MEMBERS,
  extractKit,
  readKitVersion,
  readUpstreamVersion,
} from "./extract/pipeline.ts";
export type { CorpusStamp } from "./extract/provenance.ts";
export { corpusStampSchema, DEFAULT_KIT_SOURCE, EXTRACTOR_VERSION } from "./extract/provenance.ts";
export { isNpmError, NpmError } from "./extract/npm.ts";
export { ArtifactValidationError, ExtractionError } from "./extract/shared/errors.ts";
export type { KitPaths } from "./extract/paths.ts";
export { resolveKitPaths, toKitRelativePath } from "./extract/paths.ts";
export type { KitPathsV2 } from "./extract/v2/paths.ts";
export { detectKitLayout, resolveKitPathsV2 } from "./extract/v2/paths.ts";
export { extractCorpusV2, readKitVersionV2 } from "./extract/v2/pipeline.ts";
