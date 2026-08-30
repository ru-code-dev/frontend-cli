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

export interface Summary {
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
  limitations: { file: string; line: number | null; reason: string; detail: string }[];
}

export interface Payload {
  project: { name: string | null; root: string };
  generatedAt: string;
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
  findings: Finding[];
  /** Rule id → one-line description, for the filter panel. */
  ruleDescriptions: Record<string, string>;
}
