/**
 * The wire contract between the analyzer and this dashboard.
 *
 * Split out of `data.ts` so it stays free of DOM references: the analyzer typechecks this
 * file through a type-only import to prove the two declarations of `Severity` and
 * `FindingCategory` have not drifted apart. That check is erased at build time and adds
 * nothing to the bundle, so the dashboard keeps building without any dependency on the
 * analyzer — only the contract is now verified instead of assumed.
 *
 * Types only. Anything that touches `document` belongs in `lib/read-payload.ts`.
 */

export type Severity = "error" | "warning" | "info" | "candidate";

export type FindingCategory =
  | "token"
  | "typography"
  | "font"
  | "api"
  | "override"
  | "component"
  | "icon"
  | "a11y";

/**
 * A11y facet; `null` on findings that carry no accessibility consequence.
 *
 * Kept as a nested object rather than flattened for the same reason as in the analyzer:
 * `pattern` is meaningless on a colour literal.
 */
export interface A11yFacet {
  wcag: string[];
  pattern: string | null;
  impact: string;
  /** One sentence on what to do; prose guidance, never pasteable code. `null` when none. */
  fix: string | null;
}

export interface Expected {
  token: string | null;
  cssVar: string | null;
  /**
   * The member path a consumer writes to reach the token, e.g.
   * `themeTokens.edsSys.Background.backAccent`.
   *
   * A design system can publish a token through two channels, and which one a consumer writes
   * depends on the system: EDS 1.x has only a custom property, EDS 2.x has both and its
   * consumers write the member path — in a `.css.ts` there is no `var(--…)` to write. So a
   * finding carries both and `value` holds the one to offer first.
   *
   * OPTIONAL, never `null`-filled: a report produced against a css-var-only design system omits
   * the field entirely, which is what keeps every existing payload byte-identical.
   */
  jsPath?: string | null | undefined;
  component: string | null;
  value: string;
}

export interface Snippet {
  before: string;
  after: string | null;
  highlightLine: number;
  startLine: number;
  /** Pre-rendered by Shiki at generation time; zero highlighting cost in the browser. */
  beforeHtml: string;
  afterHtml: string | null;
}

export interface Finding {
  id: string;
  rule: string;
  subkind: string | null;
  category: FindingCategory;
  severity: Severity;
  confidence: number;
  file: string;
  line: number;
  column: number;
  snippet: Snippet;
  actual: string;
  expected: Expected | null;
  why: string;
  note: string | null;
  rootCause: { file: string; line: number; name: string } | null;
  appliedTo: { component: string; slot: string | null } | null;
  a11y: A11yFacet | null;
  autoFixable: boolean;
  needsAgent: boolean;
  candidates: { component: string; score: number; reasons: string[] }[];
  impact: { occurrences: number; files: number };
  /** Findings share a key when fixing one teaches you how to fix the rest. */
  impactKey: string;
}

/**
 * The reader's view over the rules — `WORKFLOW/features/rule-config/plans/rc-design.md` §3.
 *
 * `off` hides the finding; `on` keeps whatever severity the rule assigned (which for
 * `a11y.lint` varies per sub-rule, so `on` is not a synonym for any one severity); the four
 * severities force one. Six values, no more: the panel's `<select>` is this list.
 */
export type RuleLevel = "off" | "on" | Severity;

/**
 * The RESOLVED config the payload embeds — the DEFAULT view, not the only one.
 *
 * `source` names the file it came from, because a reader looking at a report with half the
 * rules switched off is owed the path of the file that switched them off. `defaults` means
 * nobody configured anything and every finding is shown.
 */
export interface RuleConfig {
  readonly default: RuleLevel;
  readonly categories: Readonly<Partial<Record<FindingCategory, RuleLevel>>>;
  readonly rules: Readonly<Record<string, RuleLevel>>;
  readonly source: { readonly kind: "file"; readonly path: string } | { readonly kind: "defaults" };
}

/**
 * One controllable thing, as the panel lists it.
 *
 * The catalog carries rules that produced NOTHING as well as rules that fired — which is the
 * point: "0 icon problems" only means something once you can see that the icon rules ran.
 * `subrules` is `[]` for every rule but `a11y.lint`, which addresses its 30 jsx-a11y checks
 * individually as `a11y.lint/<name>`.
 */
export interface RuleCatalogEntry {
  readonly id: string;
  readonly category: FindingCategory;
  readonly description: string;
  readonly builtinSeverity: Severity | "mixed";
  readonly subrules: readonly {
    readonly id: string;
    readonly severity: Severity;
    readonly description: string;
  }[];
  /** `"engine"`, or the kit adapter's id. Open by construction, hence `string`. */
  readonly origin: string;
}

/**
 * A locally declared component the design-system team should look at.
 *
 * `snippetHtml` is added at render time (Shiki, like finding snippets); the analyzer's
 * artifact carries only the raw `snippet` text.
 */
export interface CustomComponent {
  name: string;
  file: string;
  line: number;
  usages: number;
  files: number;
  props: string[];
  kitComponentsUsed: string[];
  hasInlineSvg: boolean;
  snippet: string;
  snippetHtml: string;
  /** `kit-like`: resembles a kit component · `kit-candidate`: reused, kit has nothing like it · `local`: neither. */
  verdict: "kit-like" | "kit-candidate" | "local";
  nameMatch: { component: string; kind: "exact" | "contains" | "similar" } | null;
  /** Kit-token references attributable to this component (own file + imported stylesheets). */
  tokenRefs: number;
  /** Hardcoded design values in the same scope, counted off the findings. */
  hardcodedValues: number;
  tokenVerdict: "tokens" | "mixed" | "hardcode" | "no-styles";
}

export interface Usage {
  components: {
    name: string;
    usages: number;
    files: number;
    findings: number;
    overrides: number;
    props: Record<string, Record<string, number>>;
  }[];
  unusedComponents: string[];
  foreignComponents: { name: string; usages: number; local: boolean; source: string | null }[];
  customComponents: CustomComponent[];
  /** Every rendered component element in exactly one bucket; sums to `total`. */
  elementBreakdown: {
    total: number;
    kit: number;
    kitClean: number;
    customTokens: number;
    customMixed: number;
    customHardcode: number;
    customUnstyled: number;
    foreign: number;
  };
  tokenUsage: Record<string, number>;
}

/**
 * THE ADAPTER-GATED FIELDS ARE OPTIONAL, AND THAT IS THE VISIBILITY MECHANISM.
 *
 * `healthScore`, `healthFormula`, `adoption`, `tokenCoverage` and `kitGaps` are the source
 * dashboard's kit-adoption metrics. They are meaningless without a design system to measure
 * adoption OF (h5 §2d), and the engine emits them only when a `KitAdapter` is connected
 * (`packages/fg-analyzer-engine/src/domain/findings.ts:262-303`, all `.optional()`). Spelling
 * them optional here is what makes `tsgo` refuse a screen that reads one without a guard — the
 * panels are hidden by the type system rather than by a convention somebody has to remember.
 * `lib/kit.ts` is the single place that turns the optionality into a decision.
 */
export interface Summary {
  healthScore?: number;
  healthFormula?: string;
  adoption?: number;
  tokenCoverage?: number;
  files: { scanned: number; clean: number };
  findings: {
    total: number;
    bySeverity: Record<Severity, number>;
    byRule: Record<string, number>;
    byCategory: Record<FindingCategory, number>;
    autoFixable: number;
    needsAgent: number;
  };
  positives: { label: string; detail: string }[];
  kitGaps?: { value: string; token: string; role: string; occurrences: number }[];
  limitations: { file: string; line: number | null; reason: string; detail: string }[];
}

export interface Payload {
  project: { name: string | null; root: string };
  generatedAt: string;
  /**
   * Which design-system adapter produced this report, and `null` when none matched.
   *
   * Types only — no screen reads it. It is declared because this file is the description of
   * what actually arrives in the `ds-data` slot, and a field the payload carries but the
   * contract omits is a contract that has started lying.
   */
  adapter: { name: string; version: string } | null;
  /**
   * Diff-check context (`ds.mjs check`): compared range and the findings sitting on
   * changed lines. `null` on regular audits — the dashboard then shows nothing extra.
   */
  diff: {
    range: string;
    changedFiles: number;
    changedLines: number;
    newFindingIds: string[];
  } | null;
  /**
   * Kit icon name → drawing data (normalized shapes, `kind:data`), for every kit icon the
   * findings reference. Lets the gallery render the icon itself instead of naming it.
   */
  iconPreviews: Record<string, { viewBox: string | null; shapes: string[] }>;
  summary: Summary;
  /** Adapter-gated, like the kit half of {@link Summary}; absent on an adapter-less report. */
  usage?: Usage;
  /**
   * EVERY finding the run produced — raw, un-filtered, at the severity its rule assigned.
   *
   * Design D11: the config never reaches this array. `ruleConfig` below is applied here, in
   * the browser, on every render, which is what lets the reader switch a category back on and
   * see it immediately instead of re-running the analyzer.
   */
  findings: Finding[];
  /** Rule id → one-line description, for the filter panel. */
  ruleDescriptions: Record<string, string>;
  /** The config the generator summarised under — this dashboard's starting view (design D10). */
  ruleConfig: RuleConfig;
  /** Every rule that could have fired; `[]` when the generator supplied no catalog. */
  ruleCatalog: RuleCatalogEntry[];
}
