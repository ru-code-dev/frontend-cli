/**
 * The wire contract between the analyzer and this dashboard.
 *
 * Split out of `data.ts` so it stays free of DOM references: the analyzer typechecks this
 * file through a type-only import to prove the two declarations of `Severity` and
 * `FindingCategory` have not drifted apart. That check is erased at build time and adds
 * nothing to the bundle, so the dashboard keeps building without any dependency on the
 * analyzer — only the contract is now verified instead of assumed.
 *
 * Types only. Anything that touches `document` belongs in `data.ts`.
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
 * (`packages/fe-analyzer-engine/src/domain/findings.ts:262-303`, all `.optional()`). Spelling
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
  findings: Finding[];
  /** Rule id → one-line description, for the filter panel. */
  ruleDescriptions: Record<string, string>;
}
