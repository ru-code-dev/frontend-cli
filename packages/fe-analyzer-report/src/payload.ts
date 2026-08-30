import type {
  Finding,
  FindingCategory,
  Limitation,
  ReportPayload,
  Severity,
  Summary,
} from "./contract.ts";

/**
 * Engine result → dashboard payload.
 *
 * The analyzer engine (`@smart-tools/fe-analyzer-engine`, brief B2 §3) keeps the
 * hackathon's own finding record shape
 * (`hackathon2026/ds-analyzer/src/domain/findings.ts:94-145`) restricted to the ported
 * rules. This module states that shape STRUCTURALLY — no import across package boundaries —
 * so the two packages can land in parallel and B4 reconciles them against this file. Every
 * field below is either required because a surviving dashboard panel reads it, or optional
 * with a stated default; nothing is invented from thin air.
 *
 * Two mappings do real work rather than copying:
 *
 *  - `snippet.beforeHtml`. The source pipeline pre-renders it with Shiki at generation time
 *    (`hackathon2026/ds-analyzer/src/report/render.ts:96-110`) so the browser highlights
 *    nothing. Shiki is NOT a dependency of this port (h3 §2: "not needed for correctness,
 *    only for pretty-printed snippet highlighting"), so the snippet is emitted as escaped
 *    plain text inside the same `.shiki` element the dashboard's stylesheet already styles
 *    (`dashboard/src/index.css:104-113`). Same slot, same typography, no colouring.
 *  - the `summary.findings` counters. Recomputed here when the engine does not carry them,
 *    from the findings themselves — the same aggregation the source computes in
 *    `hackathon2026/ds-analyzer/src/metrics/health.ts`. The kit-adoption half of that module
 *    (health score, adoption, token coverage) is NOT reproduced: the panels that showed it
 *    are deleted, and h5 §2d is explicit that those fields must be dropped rather than
 *    shipped with garbage values.
 */

/** The engine's snippet: the source record minus the two Shiki-rendered fields. */
export interface EngineSnippet {
  readonly before: string;
  readonly after: string | null;
  readonly highlightLine: number;
  readonly startLine: number;
}

/**
 * One finding as the engine emits it.
 *
 * Required = the dashboard cannot render the row without it. `impact`/`impactKey` are
 * required on purpose: every list on the work-plan, files and accessibility screens folds
 * on `impactKey` (`dashboard/src/lib/model.ts:47-94`, `dashboard/src/lib/a11y.ts:55-105`),
 * and re-deriving a grouping here would silently disagree with the engine's own.
 */
export interface EngineFinding {
  readonly id: string;
  readonly rule: string;
  readonly category: FindingCategory;
  readonly severity: Severity;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly snippet: EngineSnippet;
  readonly actual: string;
  readonly why: string;
  readonly autoFixable: boolean;
  readonly impact: { readonly occurrences: number; readonly files: number };
  readonly impactKey: string;
  readonly subkind?: string | null | undefined;
  readonly confidence?: number | undefined;
  readonly expected?: Finding["expected"] | undefined;
  readonly note?: string | null | undefined;
  readonly rootCause?: Finding["rootCause"] | undefined;
  readonly appliedTo?: Finding["appliedTo"] | undefined;
  readonly a11y?: Finding["a11y"] | undefined;
  readonly needsAgent?: boolean | undefined;
  readonly candidates?: Finding["candidates"] | undefined;
}

/**
 * The engine's `summary.findings` block, as the ENGINE types it.
 *
 * Identical to {@link Summary}'s except for `byCategory`, which is widened to a partial
 * record. B4's reconciliation: `@smart-tools/fe-analyzer-engine` narrows its category enum to
 * the three its ported rules can emit (`packages/fe-analyzer-engine/src/domain/findings.ts:39`
 * — B2's delta D15), so `z.record(findingCategorySchema, …)` infers
 * `Record<"component"|"icon"|"a11y", number>`, which is NOT assignable to the dashboard's
 * eight-key `Record<FindingCategory, number>` (`src/contract.ts:105`, itself a transcription of
 * `dashboard/src/contract.ts:88`). The dashboard's shape is the OUTPUT contract and is kept
 * whole — `payloadOf` seeds the five missing categories at 0 rather than emitting a payload
 * with holes in it, which is exactly what `countFindings` already does on the branch where the
 * engine carries no counters at all.
 */
export interface EngineFindingCounts {
  readonly total: number;
  readonly bySeverity: Summary["findings"]["bySeverity"];
  readonly byRule: Summary["findings"]["byRule"];
  readonly byCategory: Readonly<Partial<Record<FindingCategory, number>>>;
  readonly autoFixable: number;
  readonly needsAgent: number;
}

/** The engine's summary. Only `files` cannot be derived from the findings. */
export interface EngineSummary {
  readonly files: { readonly scanned: number; readonly clean: number };
  readonly findings?: EngineFindingCounts | undefined;
  readonly positives?: readonly { readonly label: string; readonly detail: string }[] | undefined;
  readonly limitations?: readonly Limitation[] | undefined;
}

/**
 * What `analyzeProject()` hands back, as this package needs to read it.
 *
 * `project` / `profile` / `generatedAt` are optional because the analysis artifact proper
 * carries only `findings` + `summary`
 * (`hackathon2026/ds-analyzer/src/analyze.ts:57`); the source pipeline passes the project
 * profile and the timestamp alongside it into the renderer
 * (`hackathon2026/ds-analyzer/src/report/render.ts:53-57`). Either shape is accepted.
 */
export interface AnalyzerResult {
  readonly findings: readonly EngineFinding[];
  readonly summary: EngineSummary;
  readonly project?:
    | { readonly name?: string | null | undefined; readonly root?: string | undefined }
    | undefined;
  readonly profile?:
    | {
        readonly name?: string | null | undefined;
        readonly root?: string | undefined;
        readonly limitations?: readonly Limitation[] | undefined;
      }
    | undefined;
  readonly generatedAt?: string | undefined;
  readonly ruleDescriptions?: Readonly<Record<string, string>> | undefined;
}

/** Caller-supplied report metadata; every field overrides its counterpart on the result. */
export interface PayloadOptions {
  /**
   * Stamped into the sidebar. Passed in so `renderReport` stays deterministic — the same
   * reason the source renderer takes it as an input rather than reading the clock
   * (`hackathon2026/ds-analyzer/src/report/render.ts:56`). Defaults to the current time.
   */
  readonly generatedAt?: string | undefined;
  readonly project?:
    | { readonly name?: string | null | undefined; readonly root?: string | undefined }
    | undefined;
}

const SEVERITIES: readonly Severity[] = ["error", "warning", "info", "candidate"];

const CATEGORIES: readonly FindingCategory[] = [
  "token",
  "typography",
  "font",
  "api",
  "override",
  "component",
  "icon",
  "a11y",
];

/** Text → HTML text node. `&` first, or the entities it emits get double-escaped. */
const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The plain-text stand-in for Shiki's markup.
 *
 * `.shiki` is the class the dashboard's stylesheet keys its code typography off
 * (`dashboard/src/index.css:104-113`), so the block lands with the same font, size and
 * line-height a highlighted snippet would have had — only without colour.
 */
const plainSnippetHtml = (code: string): string =>
  `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`;

const emptyCounts = <K extends string>(keys: readonly K[]): Record<K, number> => {
  const counts = {} as Record<K, number>;
  for (const key of keys) {
    counts[key] = 0;
  }
  return counts;
};

/**
 * The engine's counters, widened back to the dashboard's eight-category shape.
 *
 * Seeding first and spreading second means a category the engine DOES count always wins, and
 * one it cannot emit reads as `0` — the same value `countFindings` would have produced for it.
 */
const withAllCategories = (counts: EngineFindingCounts): Summary["findings"] => ({
  ...counts,
  byCategory: { ...emptyCounts(CATEGORIES), ...counts.byCategory },
});

/** The `summary.findings` block, recomputed from the findings when the engine omits it. */
const countFindings = (findings: readonly EngineFinding[]): Summary["findings"] => {
  const bySeverity = emptyCounts(SEVERITIES);
  const byCategory = emptyCounts(CATEGORIES);
  const byRule: Record<string, number> = {};
  let autoFixable = 0;
  let needsAgent = 0;

  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byCategory[finding.category] += 1;
    byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
    if (finding.autoFixable) {
      autoFixable += 1;
    }
    if (finding.needsAgent === true) {
      needsAgent += 1;
    }
  }

  return { total: findings.length, bySeverity, byRule, byCategory, autoFixable, needsAgent };
};

const toFinding = (finding: EngineFinding): Finding => ({
  id: finding.id,
  rule: finding.rule,
  subkind: finding.subkind ?? null,
  category: finding.category,
  severity: finding.severity,
  confidence: finding.confidence ?? 1,
  file: finding.file,
  line: finding.line,
  column: finding.column,
  snippet: {
    before: finding.snippet.before,
    after: finding.snippet.after,
    highlightLine: finding.snippet.highlightLine,
    startLine: finding.snippet.startLine,
    beforeHtml: plainSnippetHtml(finding.snippet.before),
    // Only the "before" side is ever pre-rendered: the diff view builds both sides from the
    // plain text itself (`hackathon2026/ds-analyzer/src/report/render.ts:89-95`).
    afterHtml: null,
  },
  actual: finding.actual,
  expected: finding.expected ?? null,
  why: finding.why,
  note: finding.note ?? null,
  rootCause: finding.rootCause ?? null,
  appliedTo: finding.appliedTo ?? null,
  a11y: finding.a11y ?? null,
  autoFixable: finding.autoFixable,
  needsAgent: finding.needsAgent ?? false,
  candidates: finding.candidates ?? [],
  impact: finding.impact,
  impactKey: finding.impactKey,
});

/** Engine result → the JSON the ported dashboard renders. Pure. */
export function payloadOf(result: AnalyzerResult, options: PayloadOptions = {}): ReportPayload {
  const project = options.project ?? result.project ?? result.profile ?? {};

  return {
    project: { name: project.name ?? null, root: project.root ?? "" },
    generatedAt: options.generatedAt ?? result.generatedAt ?? new Date().toISOString(),
    // No diff mode and no kit icon geometry in this port; both slots stay at the values the
    // dashboard already treats as "nothing extra to show".
    diff: null,
    iconPreviews: {},
    summary: {
      files: result.summary.files,
      findings:
        result.summary.findings === undefined
          ? countFindings(result.findings)
          : withAllCategories(result.summary.findings),
      positives: result.summary.positives ?? [],
      limitations: result.summary.limitations ?? result.profile?.limitations ?? [],
    },
    findings: result.findings.map(toFinding),
    ruleDescriptions: result.ruleDescriptions ?? {},
  };
}
