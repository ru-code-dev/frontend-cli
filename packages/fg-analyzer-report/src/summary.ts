/**
 * `--format summary` — the dashboard's own numbers as a small JSON document (G1).
 *
 * PARITY BY CONSTRUCTION. Nothing here re-derives a number the dashboard shows: every figure is
 * computed by the dashboard's OWN modules, imported from `dashboard/src/lib/` — the same code the
 * browser runs on the same payload. They are the DOM-free half of the dashboard (types and pure
 * functions; `lib/kit.ts`, `lib/shares.ts`, `lib/rule-config.ts` say so in their headers), which
 * is why this node-side module may import them, the way this package's tier-1 suites already do.
 *
 * WHAT «THE DASHBOARD SHOWS» MEANS: the Overview screen on first open — the file's rule config
 * applied with no reader overrides (`App.tsx`'s `configuredPayload`), the kit cards
 * (`screens/Overview.tsx`'s `KitMetricCards`), the health ring and the first rows of
 * «С чего начать» (`buildProblems`). A `--preport` payload never carries a diff, so the diff
 * filter that sits between the two in `App.tsx` is inert here.
 */
import type { Payload } from "../dashboard/src/contract.ts";
import { ruleLabel } from "../dashboard/src/data.ts";
import { kitDataOf } from "../dashboard/src/lib/kit.ts";
import { buildProblems } from "../dashboard/src/lib/model.ts";
import {
  EMPTY_OVERRIDES,
  applyRuleConfig,
  mergeConfig,
  recountFindings,
} from "../dashboard/src/lib/rule-config.ts";
import { breakdownShares } from "../dashboard/src/lib/shares.ts";
import type { ReportPayload, Severity } from "./contract.ts";

/** The document's identity, so a reader can refuse a shape it does not know. */
export const SUMMARY_SCHEMA = "fg-report-summary@1";

/** How many of «С чего начать»'s rows the summary carries. */
export const SUMMARY_TOP_PROBLEMS = 5;

export interface SummaryProblem {
  readonly rule: string;
  /** The rule's Russian label, as the dashboard row prints it. */
  readonly label: string;
  readonly severity: Severity;
  readonly category: string;
  readonly actual: string;
  /** `expected.token ?? expected.value`, as the dashboard row prints it; `null` when none. */
  readonly expected: string | null;
  readonly occurrences: number;
  readonly files: number;
  readonly autoFixable: boolean;
}

export interface ReportSummary {
  readonly schema: typeof SUMMARY_SCHEMA;
  readonly generatedAt: string;
  readonly project: { readonly name: string | null; readonly root: string };
  readonly adapter: { readonly name: string; readonly version: string } | null;
  /** The health ring; `null` without a design-system adapter (the dashboard draws none then). */
  readonly health: { readonly score: number; readonly formula: string } | null;
  readonly totals: {
    readonly findings: number;
    readonly errors: number;
    readonly warnings: number;
    readonly info: number;
    readonly candidates: number;
    /** «Решений»: unique problems after grouping repeats. */
    readonly problems: number;
    readonly autoFixable: number;
    readonly a11y: number;
    readonly filesScanned: number;
    readonly filesClean: number;
  };
  /** The four kit cards, in percent; `null` without an adapter. */
  readonly kit: {
    readonly components: number;
    readonly kitShare: number;
    readonly customTokensShare: number;
    readonly customWithoutTokensShare: number;
    readonly tokenCoverage: number;
  } | null;
  readonly topProblems: readonly SummaryProblem[];
}

/**
 * The summary of `report` — the payload `payloadOf` produced, which is exactly the object the
 * dashboard parses back out of the HTML (`dashboard-render.test.ts` reads the same object through
 * the same `Payload` type, which is why the one cast below is a type-level statement only).
 */
export function summaryOf(report: ReportPayload): ReportSummary {
  const payload = report as unknown as Payload;
  const config = mergeConfig(payload.ruleConfig, EMPTY_OVERRIDES);
  const findings = applyRuleConfig(payload.findings, config);
  const counts = recountFindings(findings);
  const problems = buildProblems(findings);
  const kit = kitDataOf(payload);
  const shares = kit === null ? null : breakdownShares(kit.usage.elementBreakdown);

  return {
    schema: SUMMARY_SCHEMA,
    generatedAt: payload.generatedAt,
    project: { name: payload.project.name, root: payload.project.root },
    adapter: payload.adapter,
    health: kit === null ? null : { score: kit.healthScore, formula: kit.healthFormula },
    totals: {
      findings: counts.total,
      errors: counts.bySeverity.error,
      warnings: counts.bySeverity.warning,
      info: counts.bySeverity.info,
      candidates: counts.bySeverity.candidate,
      problems: problems.length,
      autoFixable: counts.autoFixable,
      a11y: counts.byCategory.a11y,
      filesScanned: payload.summary.files.scanned,
      filesClean: payload.summary.files.clean,
    },
    kit:
      kit === null || shares === null
        ? null
        : {
            components: kit.usage.elementBreakdown.total,
            kitShare: shares.kit,
            customTokensShare: shares.customTokens,
            // The third card claims every share the first two don't (`Overview.tsx`).
            customWithoutTokensShare:
              shares.customHardcode + shares.customMixed + shares.customUnstyled + shares.foreign,
            tokenCoverage: Math.round(kit.tokenCoverage * 100),
          },
    topProblems: problems.slice(0, SUMMARY_TOP_PROBLEMS).map((problem) => ({
      rule: problem.rule,
      label: ruleLabel(problem.rule),
      severity: problem.severity,
      category: problem.category,
      actual: problem.actual,
      expected: problem.expected === null ? null : (problem.expected.token ?? problem.expected.value),
      occurrences: problem.occurrences,
      files: problem.files,
      autoFixable: problem.autoFixable,
    })),
  };
}
