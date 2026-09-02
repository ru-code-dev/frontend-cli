import type { KitAdapter } from "./adapter.ts";
import { applyRuleConfig } from "./config/apply.ts";
import type { RuleConfig } from "./config/types.ts";
import { analyzerResultSchema, type AnalyzerResult, type Domain } from "./domain/findings.ts";
import { unexpandableSpreads } from "./domain/token-reference.ts";
import { buildUsage } from "./metrics/usage.ts";
import { buildRuleContext } from "./rules/context.ts";
import { collectRuleLimitations, domainOf, registryFor, runRules } from "./rules/index.ts";
import { scanProject } from "./scanner/scan.ts";
import { buildSummary, countCleanFiles } from "./summary.ts";

/**
 * `@smart-tools/fg-analyzer-engine` — the public surface.
 *
 * A port of the analysis half of `hackathon2026/ds-analyzer`, cut at the seam h2 §7 named: that
 * CLI loads a design system's extracted artifacts unconditionally before any rule runs
 * (`ds-analyzer/src/cli/run-analyze.ts:56`, an unguarded `readFileSync` — see
 * `ds-analyzer/src/kit/spec.ts:200-208`), so it cannot run on a project that does not ship them.
 *
 * The cut is now a **seam** rather than an amputation. `analyzeProject` takes an optional
 * {@link KitAdapter}: an imported object, from a package whose own build embedded whatever that
 * design system needs. Two shapes of run, one code path:
 *
 *  - **no adapter** — the eleven generic rules, three domains, a four-key summary, no `usage`.
 *    Bit-for-bit what this package did before the seam existed.
 *  - **adapter** — its rules join the registry, its queries light up the kit-aware branches of
 *    the generic rules, the scanner tags kit components, and the adoption half of the payload
 *    (`usage`, the eight-key `byCategory`, health/adoption/coverage) comes back.
 *
 * Nothing in this package names a design system, reads an artifact, or resolves a path to one.
 *
 * Three stages, none of which builds or executes the analysed project:
 *
 *  1. **Scan** — walk by file extension, parse each code file once with ts-morph and run
 *     `eslint-plugin-jsx-a11y` in memory over the same text; parse stylesheets with postcss.
 *  2. **Rules** — pure functions from those facts to findings. No rule opens a file.
 *  3. **Summarise** — identity, snippets and occurrence counts attached in one place.
 */

export type {
  A11yFacet,
  AnalyzerResult,
  AnalyzerSummary,
  Candidate,
  Domain,
  Expected,
  Finding,
  FindingCategory,
  Severity,
  Snippet,
  Usage,
} from "./domain/findings.ts";
export {
  a11ySchema,
  analyzerResultSchema,
  analyzerSummarySchema,
  candidateSchema,
  domainSchema,
  expectedSchema,
  findingCategorySchema,
  findingSchema,
  GENERIC_CATEGORIES,
  severitySchema,
  snippetSchema,
  usageSchema,
} from "./domain/findings.ts";
export type { Limitation, LimitationReason, ProjectProfile } from "./domain/profile.ts";
export { limitationSchema } from "./domain/profile.ts";
export {
  tokenColorForReference,
  tokenIdForReference,
  unexpandableSpreads,
} from "./domain/token-reference.ts";

/* --------------------------------------------------------------------------------------- *
 * RULE CONFIGURATION — the ESLint-shaped view over a finished run.
 *
 * Two pure functions and a derived catalog, exported as a unit because a second implementation
 * of them lives in the dashboard (which applies the config live, in the browser, over the
 * embedded payload) and is checked against these by a parity test. `analyzeProject` uses them
 * for exactly one thing: computing the summary over the VISIBLE set while the payload keeps
 * every raw finding (design D11).
 * --------------------------------------------------------------------------------------- */

export type { RuleConfig, RuleCatalogEntry, RuleLevel } from "./config/types.ts";
export {
  DEFAULT_RULE_CONFIG,
  RULE_LEVELS,
  ruleConfigSchema,
  ruleConfigSourceSchema,
  ruleLevelSchema,
} from "./config/types.ts";
export type { ConfigurableFinding } from "./config/apply.ts";
export { applyRuleConfig, isVisible, resolveLevel } from "./config/apply.ts";
export { ruleCatalog } from "./config/catalog.ts";

/* --------------------------------------------------------------------------------------- *
 * The adapter seam, and the toolkit an adapter is written against.
 *
 * Everything below is exported for one reason: a kit adapter's rules must reach the *same*
 * helpers this engine's own rules and its spacing index reach. Two copies of
 * `extractValueLiterals` or `dimensionScaleOf` would eventually disagree about which
 * declarations take part, and the disagreement would surface as a finding that appears in one
 * of two runs of the same code. None of it carries design-system knowledge.
 * --------------------------------------------------------------------------------------- */

export type {
  KitAdapter,
  KitBinding,
  KitMetricsInput,
  KitPatternEvidence,
  TokenReferenceModel,
} from "./adapter.ts";
export type { ImportedBinding, StyleFactoryModule } from "./scanner/collectors/vanilla-extract.ts";
export type {
  DeclarationRule,
  ElementRule,
  FrequencyIndex,
  ImportRule,
  RawFinding,
  Rule,
  RuleContext,
  RuleLabel,
  StyleRule,
} from "./rules/types.ts";
export {
  isAnalysableStyleValue,
  overElements,
  overImports,
  overStyleValues,
} from "./rules/types.ts";
export type {
  AppliedTo,
  Declaration,
  ImportRecord,
  JsxElement,
  LintMessage,
  Observations,
  ReExportRecord,
  StyleRef,
  StyleValue,
  TokenReference,
} from "./domain/observations.ts";
export { tokenReferenceSchema } from "./domain/observations.ts";
export type { KitSource } from "./domain/profile.ts";
export { literalColumn } from "./rules/position.ts";
export {
  buildSketch,
  MIN_TOKENS_FOR_SKETCH,
  sketchSimilarity,
} from "./rules/components/minhash.ts";
export type { ColorValue, Oklch, Rgba } from "./css/color.ts";
export { colorDistance, isColorLiteral, parseColor, rgbaToOklch } from "./css/color.ts";
export type { DimensionUnit, DimensionValue } from "./css/dimension.ts";
export {
  DEFAULT_REM_BASE_PX,
  DIMENSION_UNITS,
  isDimensionLiteral,
  parseDimension,
  toPixelScale,
} from "./css/dimension.ts";
export type { ColorRole, DimensionScaleName, StyleCategory } from "./css/properties.ts";
export {
  colorRoleOf,
  cssPropertyFromStyleKey,
  dimensionScaleOf,
  isKnownStyleProperty,
  looksLikeStyleObject,
  styleCategoryOf,
  TYPOGRAPHY_PROPERTIES,
} from "./css/properties.ts";
export type {
  ColorLiteral,
  CustomPropertyReference,
  DimensionLiteral,
  ValueLiteral,
} from "./css/value.ts";
export {
  customPropertyReference,
  extractValueLiterals,
  isSoleCustomPropertyReference,
  namedColorToHex,
  splitFontFamilies,
} from "./css/value.ts";
export { CSS_NAMED_COLORS, NON_COLOR_KEYWORDS } from "./css/named-colors.ts";
export { editDistance } from "./shared/edit-distance.ts";
export { compareNumbers, compareStrings, sortBy, sortNumbers, sortStrings } from "./shared/sort.ts";
export { isDeepPackageImport, packageNameOf } from "./scanner/resolve.ts";

/**
 * THE SCANNER, exported for ONE caller: an adapter that extracts its own kit's corpus.
 *
 * `analyzeProject` above is scan-then-rules, and it is what every consumer of this engine wants.
 * `scanProject` is the first half on its own, and it is here because
 * `@smart-tools/fg-eds-adapter`'s kit-knowledge extractor reads the KIT's sources with it
 * (`packages/fg-eds-adapter/src/extract/kit-knowledge/extract.ts`), for the reason the hackathon
 * gives at `ds-analyzer/src/kit-knowledge/extract.ts:20-28`: the kit's components and a product's
 * components must be described in **identical vocabulary**, or the similarity scoring that
 * compares them is comparing two different measurements. The only way to guarantee that is for
 * both sides to run the same collector — this one — rather than a second copy of it.
 *
 * That makes this a seam rather than a convenience. Re-porting the scanner into the adapter is
 * the alternative, and it is precisely the drift this export exists to prevent.
 */
export type { ScanOptions, ScanResult } from "./scanner/scan.ts";
export { scanProject } from "./scanner/scan.ts";

/** The engine's own domains, in the order the report shows them. */
export const ALL_DOMAINS: readonly Domain[] = ["a11y", "components", "icons"];

export interface AnalyzeOptions {
  /** File, directory or repository root to analyse. */
  readonly dir: string;
  /**
   * Domains to run. Defaults to {@link ALL_DOMAINS}, plus whatever domains the adapter adds
   * when one is connected.
   */
  readonly domains?: readonly Domain[];
  /**
   * Extra ignore patterns in gitignore syntax, on top of the walker's hard list
   * (`node_modules/`, `dist/`, build output — `scanner/profile/ignore.ts`) and every
   * `.gitignore` in the tree.
   */
  readonly ignore?: readonly string[];
  /**
   * The design system to analyse against — an imported object, never a path.
   *
   * Omitted means none, and the run is the generic one this package has always performed.
   */
  readonly adapter?: KitAdapter;
  /**
   * PROGRESS, and nothing else.
   *
   * A full scan of a real repository is minutes of silence, and a CLI that wants to draw a bar
   * over it has no way to know how far along the run is. This is that way: a callback the
   * engine invokes as it goes, carrying which stage it is in and how much of that stage is
   * behind it. It cannot influence the result — the two stages that report through it
   * (`scanner/scan.ts`'s collector loops and `rules/index.ts`'s registry loop) treat it as
   * write-only — and omitting it leaves `analyzeProject` bit-for-bit what it was, which is why
   * this package's existing suites did not have to change to accommodate it.
   */
  readonly onProgress?: (event: AnalyzeProgress) => void;
  /**
   * The user's view over the rules: what to hide, what to re-grade.
   *
   * EVERY rule still runs and the result still carries EVERY finding — the config is applied
   * after the fact (design D3/D11). What it changes is the *summary*: counts, clean files and
   * the adapter's adoption extras are computed over the visible set, because a user who
   * switched a category off is asking not to be told about it twice.
   *
   * Omitting it leaves this function bit-for-bit what it was: the visible set is then the raw
   * set BY IDENTITY, `suppressedCount` is absent from the result, and every existing suite
   * passes unchanged.
   */
  readonly ruleConfig?: RuleConfig;
}

/**
 * One tick of {@link AnalyzeOptions.onProgress}.
 *
 * Two stages, because two is what a user can distinguish: reading the project, then checking
 * it. `done` counts up to `total` within a stage and `total` is fixed for the duration of that
 * stage, so a renderer can turn the pair into a percentage without keeping state of its own.
 */
export interface AnalyzeProgress {
  readonly stage: "scan" | "rules";
  readonly done: number;
  readonly total: number;
}

/** The rules that will run for a given domain selection, for a caller that wants to say so. */
export const rulesFor = (
  domains: readonly Domain[] = ALL_DOMAINS,
  adapter?: KitAdapter,
): readonly { id: string; description: string }[] =>
  registryFor(adapter)
    .filter((rule) => domains.includes(domainOf(rule)))
    .map((rule) => ({ id: rule.id, description: rule.description }));

/**
 * Analyses a project on disk.
 *
 * `async` although every stage is synchronous: the whole run is CPU-bound file reading and
 * parsing, and the signature is the one the CLI and the report package build against —
 * widening it later would be a breaking change for a gain of nothing.
 */
export const analyzeProject = async (options: AnalyzeOptions): Promise<AnalyzerResult> => {
  const adapter = options.adapter;
  const domains =
    options.domains ??
    (adapter === undefined ? ALL_DOMAINS : [...ALL_DOMAINS, ...(adapter.domains ?? [])]);

  const onProgress = options.onProgress;
  const { profile, observations } = scanProject({
    path: options.dir,
    ...(options.ignore === undefined ? {} : { ignore: options.ignore }),
    ...(onProgress === undefined
      ? {}
      : { onFile: (done, total) => void onProgress({ stage: "scan", done, total }) }),
    ...(adapter === undefined
      ? {}
      : {
          kit: {
            kitPackages: adapter.kitPackages,
            wrappedUpstreamScope: adapter.wrappedUpstreamScope,
            ...(adapter.binding.tokenReferenceModel?.styleFactories === undefined
              ? {}
              : { styleFactories: adapter.binding.tokenReferenceModel.styleFactories }),
          },
        }),
  });

  const context = buildRuleContext({
    profile,
    observations,
    ...(adapter === undefined ? {} : { kit: adapter.binding }),
  });
  const rules = registryFor(adapter);
  const findings = runRules(context, {
    domains,
    rules,
    ...(onProgress === undefined
      ? {}
      : { onRule: (done, total) => void onProgress({ stage: "rules", done, total }) }),
  });

  // The config is a VIEW, applied here and nowhere else. `findings` stays the raw set for the
  // payload; `visible` is what every counter below is computed over. With no config the two
  // are the SAME ARRAY, which is what makes the no-config path bit-for-bit unchanged rather
  // than merely equivalent.
  const ruleConfig = options.ruleConfig;
  const visible = ruleConfig === undefined ? findings : applyRuleConfig(findings, ruleConfig);

  // Rule limitations join the scanner's, because to the reader they are the same fact:
  // something was not checked. Where the gap came from is an implementation detail.
  const limitations = [
    ...profile.limitations,
    ...collectRuleLimitations(context, { domains, rules }),
    // A token GROUP spread into a style object that the connected kit cannot expand. Only a
    // kit can answer that, so the question is put here rather than in the collector — and with
    // no adapter there is nobody to ask and this list is empty, exactly as before.
    ...(adapter === undefined ? [] : unexpandableSpreads(observations, adapter.binding)),
  ];

  // Everything below this line is the adapter-gated half of the payload. With no adapter the
  // three constants stay `undefined` and the result is the object this function always built.
  const usage =
    adapter === undefined
      ? undefined
      : buildUsage(observations, visible, adapter.binding, context.sources);
  const extras =
    adapter?.summaryExtras === undefined || usage === undefined
      ? undefined
      : adapter.summaryExtras({
          usage,
          findings: visible,
          observations,
          cleanFiles: countCleanFiles(observations, visible),
        });

  const result: AnalyzerResult = {
    $schema: "fg-analyzer-engine/analysis@1",
    domains: [...domains],
    findings,
    summary: buildSummary({
      observations,
      findings: visible,
      limitations,
      withAdapter: adapter !== undefined,
      ...(extras === undefined ? {} : { extras }),
    }),
    ...(usage === undefined ? {} : { usage }),
    ...(ruleConfig === undefined ? {} : { suppressedCount: findings.length - visible.length }),
  };

  // The shape is a contract with the report package, and a contract nobody checks is a
  // comment. Parsing costs microseconds against a run that reads the whole project.
  return analyzerResultSchema.parse(result);
};
