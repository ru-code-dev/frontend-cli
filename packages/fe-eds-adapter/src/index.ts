import type { KitAdapter, KitBinding, Rule } from "@smart-tools/fe-analyzer-engine";

import { COMPONENTS, KIT_A11Y, KIT_ICONS, KIT_SIGNATURES, TOKENS } from "./artifacts/index.ts";
import type {
  ComponentsArtifact,
  KitA11yArtifact,
  KitIconsArtifact,
  KitSignaturesArtifact,
  TokensArtifact,
} from "./domain/artifacts.ts";
import { DEFAULT_KIT_SOURCE } from "./extract/provenance.ts";
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
 * `@smart-tools/fe-eds-adapter` — the EDS design system, as one importable object.
 *
 * ## What this package is
 *
 * Everything `@smart-tools/fe-analyzer-engine` cannot know on its own about one particular
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

/** The snapshot compiled into this bundle. */
export const EMBEDDED_ARTIFACTS: EdsArtifacts = {
  tokens: TOKENS,
  components: COMPONENTS,
  "kit-a11y": KIT_A11Y,
  "kit-icons": KIT_ICONS,
  "kit-signatures": KIT_SIGNATURES,
};

/**
 * The version the embedded snapshot describes, read off the snapshot itself.
 *
 * NOT a literal `"1.13.0"` sitting in this file. `tokens.json`'s `meta.themePackageVersion` is
 * the value the extractor stamped from `packages/theme/package.json` of the checkout it ran
 * against, so re-embedding a newer snapshot updates the notice with no edit here — and a literal
 * would be the second place the version is written down, which is one too many.
 */
export const EMBEDDED_VERSION: string | null =
  (TOKENS as { readonly meta?: { readonly themePackageVersion?: string | null } }).meta
    ?.themePackageVersion ?? null;

/**
 * Build the adapter over one set of artifacts.
 *
 * WHY A FACTORY, when `edsAdapter` below is the only thing the registry consumes. Because the
 * five artifacts are no longer a compile-time constant: `fe --parse-ui-kit eds` writes a newer
 * five to `~/.fe/kits/eds/`, and a run that finds them there must measure against those. The
 * alternative — an adapter that reads the corpus itself, lazily, on first rule call — is exactly
 * the unguarded-read seam this package was built to remove (`src/artifacts/index.ts:26-29`);
 * making the artifacts an ARGUMENT keeps the loading decision at the edge, where it can fail
 * softly, and leaves this function total and synchronous.
 *
 * Rule order mirrors `hackathon2026/ds-analyzer/src/rules/index.ts:37-64` with the engine's own
 * eleven removed. Order is not load-bearing — findings are re-sorted by source position — but
 * keeping it makes the two registries diffable against each other.
 */
export function createEdsAdapter(artifacts: EdsArtifacts = EMBEDDED_ARTIFACTS): KitAdapter {
  const kit = new KitSpec(artifacts.tokens, artifacts.components, "light");
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
  const binding: KitBinding = {
    iconCount: icons.iconCount,
    tokenColorHex: (cssVariable) => kit.tokenByCssVariable(cssVariable)?.color?.light?.hex ?? null,
    tokenIdOf: (cssVariable) => kit.tokenByCssVariable(cssVariable)?.id ?? null,
    a11yAvailable: a11y.available,
    canonicalComponentFor: (role) => a11y.canonicalComponentFor(role),
    variantValues: (component, prop) => kit.variantValues(component, prop),
    componentNames: () => kit.componentNames(),
  };

  return {
    id: EDS_KIT_ID,
    kitPackages: KIT_PACKAGES,
    wrappedUpstreamScope: WRAPPED_UPSTREAM_SCOPE,
    rules,
    // See `rules/components/custom.ts`: `component.novel` emits `component.duplicate` too, so
    // the engine's split-out copy of the clustering must not also run.
    replaces: ["component.duplicate"],
    domains: ["tokens", "api"],
    binding,
    summaryExtras,
  };
}

/** The `--ui-kit` / `--parse-ui-kit` spelling, and the corpus directory name. */
export const EDS_KIT_ID = "eds";

/**
 * The packages that *are* the kit, and the scope it wraps. These were module constants in the
 * hackathon's scanner (`profile/kit-sources.ts:29,37`), which is what made that file
 * un-portable; they are data here, and this is the file that owns them.
 */
export const KIT_PACKAGES: readonly string[] = ["@sds-eng/base", "@sds-eng/theme"];

export const WRAPPED_UPSTREAM_SCOPE = "@v-uik";

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
 * supersedes it. A run that finds a valid `~/.fe/kits/eds/` builds its own with
 * {@link createEdsAdapter} instead.
 */
export const edsAdapter: KitAdapter = createEdsAdapter();

export { A11ySpec } from "./kit/a11y-spec.ts";
export { IconSpec } from "./kit/icon-spec.ts";
export { KnowledgeSpec } from "./kit/knowledge-spec.ts";
export { KitSpec } from "./kit/spec.ts";
export { svgFingerprint, type SvgGeometry } from "./icons/fingerprint.ts";
export type * from "./domain/artifacts.ts";

/* --------------------------------------------------------------------------------------- *
 * THE EXTRACTION SIDE — everything `fe --parse-ui-kit eds` needs, and nothing a report needs.
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
