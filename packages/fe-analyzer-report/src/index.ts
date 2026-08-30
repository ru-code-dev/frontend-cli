/**
 * `@smart-tools/fe-analyzer-report` — the analysis, as one HTML file.
 *
 * Two exports do the work: `payloadOf` turns the engine's result into the JSON the
 * dashboard reads, and `renderReport` substitutes that JSON into the dashboard build this
 * package carries. `REPORT_TEMPLATE` is exposed for the cli bundle, which inlines it.
 *
 * The dashboard itself is the hackathon's, ported under a 0-visual-regression rule: the
 * surviving panels are byte-identical to their source and every change is listed in
 * `WORKFLOW/features/hackathon-analys/reports/b3-analyzer-report.md`. What is NOT here is as
 * deliberate: the PR-flow component and its hardcoded Jenkins webhook token (h3 §5) are
 * deleted, not disabled, and a tier-1 guard test greps this package and its build for them.
 */

export type {
  A11yFacet,
  Expected,
  Finding,
  FindingCategory,
  Limitation,
  ReportPayload,
  Severity,
  Snippet,
  Summary,
} from "./contract.ts";
export type {
  AnalyzerResult,
  EngineFinding,
  EngineFindingCounts,
  EngineSnippet,
  EngineSummary,
  PayloadOptions,
} from "./payload.ts";
export { payloadOf } from "./payload.ts";
export { renderReport, ReportTemplateError } from "./render.ts";
export { REPORT_TEMPLATE } from "./template.ts";
