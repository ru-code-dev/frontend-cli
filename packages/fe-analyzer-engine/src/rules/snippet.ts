import type { Snippet } from "../domain/findings.ts";
import type { RawFinding } from "./types.ts";

/**
 * Source context attached to a finding. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/rules/snippet.ts:1-54`.
 *
 * A finding without its surroundings is a coordinate, and a coordinate is not something
 * anyone can judge. Four lines either side is enough to see which rule or which element the
 * value belongs to and short enough to read at a glance; the report widens this on demand
 * from the same source.
 *
 * The `after` variant is produced by substituting on the affected line only. Rewriting more
 * than the one line would mean re-emitting code the developer wrote, and a diff that touches
 * lines nobody asked about does not get applied.
 */

/** Lines of context kept on either side of the finding. */
const CONTEXT_LINES = 4;

export const buildSnippet = (
  finding: RawFinding,
  lines: readonly string[] | undefined,
): Snippet => {
  if (lines === undefined || lines.length === 0) {
    return { before: "", after: null, highlightLine: 1, startLine: finding.line };
  }

  const index = Math.min(Math.max(finding.line - 1, 0), lines.length - 1);
  const start = Math.max(0, index - CONTEXT_LINES);
  const end = Math.min(lines.length, index + CONTEXT_LINES + 1);

  const window = lines.slice(start, end);
  const highlightLine = index - start + 1;
  const target = window[highlightLine - 1] ?? "";

  const replacement = finding.replaceWith;
  // The `actual`-in-line guard serves both scopes: for `line` it is what proves the statement
  // lives on this one line — a multi-line import puts the specifier elsewhere, and replacing
  // only the first line of it would corrupt the file. No diff beats a wrong diff.
  const replaced =
    replacement === null || !target.includes(finding.actual)
      ? null
      : (finding.replaceScope ?? "value") === "line"
        ? `${/^\s*/.exec(target)?.[0] ?? ""}${replacement}${target.trimEnd().endsWith(";") ? ";" : ""}`
        : target.replace(finding.actual, replacement);

  const after =
    replaced === null
      ? null
      : window.map((line, offset) => (offset === highlightLine - 1 ? replaced : line)).join("\n");

  return {
    before: window.join("\n"),
    after,
    highlightLine,
    startLine: start + 1,
  };
};
