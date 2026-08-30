/**
 * `@smart-tools/fe-project-report` — the feature package, and the boundary in front of three
 * engines.
 *
 * `cli` imports `projectReportCommands` and spreads it into the registry; adding a feature to
 * the product is a new package plus one import line (design 2.1:79-81). Everything that knows
 * what `@smart-tools/fe-source`, `@smart-tools/fe-analyzer-engine` and
 * `@smart-tools/fe-analyzer-report` are lives behind this door — `command.ts` is the only
 * module in the repo that imports any of the three.
 *
 * The surface is small on purpose. `projectReportCommands` is what the product consumes;
 * `createProjectReportCommands` exists for the tier-1 suites, which drive the REAL handler and
 * the REAL `payloadOf` against injected stand-ins for the three expensive seams; the strings
 * are exported so a test can assert on the message a code maps to without re-typing it, which
 * is how a test becomes a translation check rather than a copy of the implementation.
 */
export {
  createProjectReportCommands,
  projectReportCommands,
  type ProjectReportDeps,
} from "./command.ts";

export {
  argDescriptions,
  failed,
  missingOut,
  missingSource,
  reportWritten,
  sourceFailure,
  summary,
  type ReportCounts,
} from "./strings.ts";
