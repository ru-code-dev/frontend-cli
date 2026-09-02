/**
 * `@smart-tools/fg-lint-format` — the three renderings of a finished analysis that are not the
 * HTML report: the console document a person reads, and the two a machine does.
 *
 * ONE function: findings in, a string out, plus the four counters that decide the exit code.
 * Everything the CLI needs to turn an analysis into something an IDE or a CI job can read
 * lives behind {@link formatLint}, and nothing behind it can touch the world.
 *
 * ```ts
 * import { formatLint } from "@smart-tools/fg-lint-format";
 *
 * const out = formatLint(format, {
 *   findings: visibleFindings,      // the config (design D3) has already been applied
 *   catalog: ruleCatalog(adapter),  // `compact` reads the LABELS off it, `sarif` the rules
 *   projectRoot,
 *   tool: { name: "fg", version },
 *   lang,
 *   color: ui.capability.color,     // NO_COLOR/FORCE_COLOR were read by cli-kit, not here
 *   verbose,                        // --verbose: `why` under each compact row
 *   width: process.stdout.columns,  // undefined when stdout is a pipe — and that is fine
 *   hiddenCount,                    // findings the rule config removed, for the footer
 * });
 * process.stdout.write(`${out.text}\n`);
 * process.exitCode = out.errorCount > 0 ? 1 : 0;   // design D9
 * ```
 *
 * WHY A PACKAGE AND NOT A FILE IN `fg-project-report`. Two of the three formats are contracts
 * with software outside this repo — ESLint's `LintResult[]`, SARIF 2.1.0 — and a contract with
 * an outside consumer needs a test suite that fails when the shape changes, not a helper that
 * happens to be called from a command. The third is a document a person reads, which is a
 * layout with goldens for the same reason.
 * Isolating it also makes the purity checkable by inspection: this `src/` imports `node:`
 * nothing and reads no environment, so every byte of output is a function of the arguments.
 *
 * THE ENGINE DEPENDENCY IS TYPES ONLY. Every `@smart-tools/fg-analyzer-engine` import in this
 * package is an `import type` and therefore erased at build time — the shipped
 * `cli/dist/fg.mjs` must not gain a second copy of the engine because a formatter wanted a
 * `Finding`.
 */
import type { Finding } from "@smart-tools/fg-analyzer-engine";

import { formatCompact } from "./compact.ts";
import { countSeverities, type SeverityCounts } from "./counts.ts";
import { formatJson } from "./json.ts";
import { formatSarif } from "./sarif.ts";
import type { LintFormat, LintInput, LintOutput } from "./types.ts";

export { paint, plainWidth, type Style, stripAnsi } from "./ansi.ts";
export { compactFooter, type CompactOptions, formatCompact } from "./compact.ts";
export {
  type CountNoun,
  countPhrase,
  countSeverities,
  type Lang,
  type SeverityCounts,
  totalOf,
  ZERO_COUNTS,
} from "./counts.ts";
export {
  type EslintMessage,
  type EslintResult,
  type EslintSeverity,
  eslintResultsOf,
  eslintSeverityOf,
  formatJson,
  type JsonOptions,
} from "./json.ts";
export {
  formatSarif,
  SARIF_INFORMATION_URI,
  SARIF_SCHEMA_URI,
  SARIF_URI_BASE_ID,
  SARIF_VERSION,
  sarifDefaultLevelOf,
  type SarifLevel,
  type SarifLog,
  sarifLogOf,
  type SarifOptions,
  type SarifResult,
  type SarifRule,
  sarifLevelOf,
} from "./sarif.ts";
export {
  absolutePathOf,
  projectRootUri,
  singleLine,
  stripTrailingPeriod,
  toPosix,
} from "./text.ts";
export {
  type FileGroup,
  groupByFile,
  LINT_FORMATS,
  type LintFormat,
  type LintInput,
  type LintOutput,
} from "./types.ts";

/**
 * Render `input.findings` in `format`.
 *
 * The counters are computed ONCE, here, and handed to whichever formatter runs — so
 * `--format json` and `--format sarif` can never disagree with `--format compact` about how
 * many errors the run found, and therefore never disagree about the exit code.
 */
export function formatLint(format: LintFormat, input: LintInput): LintOutput {
  const counts = countSeverities(input.findings);
  return { text: renderText(format, input, counts), ...counts };
}

function renderText(format: LintFormat, input: LintInput, counts: SeverityCounts): string {
  const findings: readonly Finding[] = input.findings;
  switch (format) {
    case "compact":
      return formatCompact(findings, {
        catalog: input.catalog,
        lang: input.lang,
        color: input.color ?? false,
        verbose: input.verbose ?? false,
        width: input.width,
        hiddenCount: input.hiddenCount ?? 0,
        counts,
      });
    case "json":
      return formatJson(findings, { projectRoot: input.projectRoot });
    case "sarif":
      return formatSarif(findings, {
        projectRoot: input.projectRoot,
        catalog: input.catalog,
        tool: input.tool,
      });
  }
}
