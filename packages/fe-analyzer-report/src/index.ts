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
 *
 * X3 brought the kit panels back — health ring, kit metric cards, kit gaps, palette, dimension
 * scale, token usage, the three component tables and the custom-component cards — CONDITIONALLY:
 * they render only when the payload carries adapter-domain data (`usage` plus the kit half of
 * `summary`), and are absent otherwise. The extended CHANGE LEDGER is in
 * `WORKFLOW/features/hackathon-analys/reports/x3-eds-wiring.md`. PrFlow and its webhook stay
 * deleted, and the guard test that says so is unchanged.
 */

export type {
  A11yFacet,
  CustomComponent,
  Expected,
  Finding,
  FindingCategory,
  KitGap,
  Limitation,
  ReportPayload,
  Severity,
  Snippet,
  Summary,
  Usage,
} from "./contract.ts";
export type {
  AnalyzerResult,
  EngineCustomComponent,
  EngineFinding,
  EngineFindingCounts,
  EngineSnippet,
  EngineSummary,
  EngineUsage,
  PayloadOptions,
} from "./payload.ts";
export { payloadOf } from "./payload.ts";
export { renderReport, ReportTemplateError } from "./render.ts";
export { REPORT_TEMPLATE } from "./template.ts";
