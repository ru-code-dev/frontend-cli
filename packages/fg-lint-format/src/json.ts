/**
 * `json` — ESLint's `LintResult[]`, the shape every CI dashboard, GitHub annotation action
 * and `eslint-formatter-*` package already knows how to read.
 *
 * Transcribed from ESLint's own reporter, which is three lines long —
 * `node_modules/.pnpm/eslint@9.39.5_jiti@2.7.0/node_modules/eslint/lib/cli-engine/formatters/json.js:11-13`,
 * `JSON.stringify(results)` — so the interesting part is entirely the shape of `results`, not
 * the serialisation. Two properties are held on purpose:
 *
 *   NO INDENTATION, because that is what ESLint emits and a consumer that diffs our output
 *   against `eslint -f json` should see no difference in whitespace either. (`sarif`, whose
 *   documents a human does sometimes open, is pretty-printed instead — design §6 asks for
 *   2-space JSON there and says nothing here.)
 *
 *   FIXED KEY ORDER, given by the literal object below rather than by iteration over the
 *   findings, so two runs over the same findings produce byte-identical documents.
 *
 * Fields ESLint has that we cannot honestly fill are still present with their empty value —
 * `suppressedMessages`, `fatalErrorCount`, `usedDeprecatedRules` — because a consumer that
 * reads `result.fatalErrorCount` must not get `undefined`. Fields we cannot fill AT ALL are
 * omitted instead of faked: a `Finding` carries one position, not a range
 * (`packages/fg-analyzer-engine/src/domain/findings.ts:128-130` — `line` and `column`, no
 * end), so `endLine`/`endColumn` never appear. They are optional in ESLint's own shape.
 */
import type { Finding } from "@smart-tools/fg-analyzer-engine";

import { absolutePathOf } from "./text.ts";
import { groupByFile } from "./types.ts";

/** ESLint's numeric severities: 2 is an error, 1 is everything else that is reported. */
export type EslintSeverity = 1 | 2;

export interface EslintMessage {
  readonly ruleId: string;
  readonly severity: EslintSeverity;
  readonly message: string;
  readonly line: number;
  readonly column: number;
  /**
   * ESLint's `fix` is `{ range, text }`; ours has no range because a `Finding` does not carry
   * one, and a fabricated range would let `--fix`-style tooling corrupt a file. Design §6
   * specifies `{ text }` and that is exactly what is emitted: the replacement is offered for
   * a human to paste, not for a machine to apply.
   */
  readonly fix?: { readonly text: string };
}

export interface EslintResult {
  readonly filePath: string;
  readonly messages: readonly EslintMessage[];
  readonly suppressedMessages: readonly never[];
  readonly errorCount: number;
  readonly fatalErrorCount: 0;
  readonly warningCount: number;
  readonly fixableErrorCount: number;
  readonly fixableWarningCount: number;
  readonly usedDeprecatedRules: readonly never[];
}

export interface JsonOptions {
  readonly projectRoot: string;
}

/** Design §6: `2` for `error`, `1` for the other three. */
export function eslintSeverityOf(finding: Finding): EslintSeverity {
  return finding.severity === "error" ? 2 : 1;
}

/**
 * The `LintResult[]` itself, exported so a test can assert the SHAPE without re-parsing the
 * string this module serialises (a test that parses its own subject proves nothing about the
 * key order the subject was built with).
 */
export function eslintResultsOf(
  findings: readonly Finding[],
  options: JsonOptions,
): readonly EslintResult[] {
  return (
    groupByFile(findings)
      .map((group): EslintResult => {
        const messages = group.findings.map((finding): EslintMessage => {
          const severity = eslintSeverityOf(finding);
          const value = finding.expected?.value;
          const base = {
            ruleId: finding.rule,
            severity,
            message: finding.why,
            line: finding.line,
            column: finding.column,
          } as const;
          return value === undefined || value === "" ? base : { ...base, fix: { text: value } };
        });
        const errorCount = messages.filter((m) => m.severity === 2).length;
        const fixable = messages.filter((m) => m.fix !== undefined);
        return {
          filePath: absolutePathOf(options.projectRoot, group.file),
          messages,
          suppressedMessages: [],
          errorCount,
          fatalErrorCount: 0,
          warningCount: messages.length - errorCount,
          fixableErrorCount: fixable.filter((m) => m.severity === 2).length,
          fixableWarningCount: fixable.filter((m) => m.severity === 1).length,
          usedDeprecatedRules: [],
        };
      })
      // Design §6: "one entry per file with findings, SORTED BY FILE". A no-op on the engine's
      // already-sorted output, and the guarantee a caller can rely on when it is not the engine
      // that produced the list. Sorted on the absolute path, which is the key a consumer sees.
      .toSorted((a, b) => (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0))
  );
}

export function formatJson(findings: readonly Finding[], options: JsonOptions): string {
  // Zero findings is `[]`, not `""`: unlike the two text formats, an empty JSON document
  // would be a parse error for the tool reading it.
  return JSON.stringify(eslintResultsOf(findings, options));
}
