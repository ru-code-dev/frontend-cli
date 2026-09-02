/**
 * `json` — ESLint's `LintResult[]`.
 *
 * The golden pins the bytes; the rest of the suite pins the CONTRACT a consumer codes
 * against: the key set of a result, the numeric severity scale, the per-file counters, the
 * absence of the fields we cannot honestly fill, and the file ordering. `eslintResultsOf` is
 * asserted directly where the claim is about the object (key order is a property of the
 * object literal, and re-parsing the string would erase the evidence).
 *
 * MUTATION CHECKS ACTUALLY RUN (patch applied, suite run, patch reverted — see the report):
 *  - severity `2` for every message (`src/json.ts:66`) — 3 fail, including "maps severity onto
 *    ESLint's 2/1 scale".
 *  - the `.sort` dropped (`src/json.ts:110`) — 1 fails: "sorts the file entries by path".
 *  - `fix` emitted unconditionally (`src/json.ts:91`) — 3 fail, including "carries `fix.text`
 *    only where the rule offered a replacement".
 *  - `fixableWarningCount: fixable.length` (`src/json.ts:103`) — this mutant SURVIVED the first
 *    round, because every fixable finding in the shared fixture is a warning. "splits the
 *    fixable counters by severity, not by fixability alone" was written for it; it now dies.
 */
import { describe, expect, it } from "vite-plus/test";

import { eslintResultsOf, formatLint } from "../src/index.ts";
import { FIXTURE_CATALOG, FIXTURE_FINDINGS, PROJECT_ROOT } from "./fixtures/findings.ts";
import { golden } from "./fixtures/golden.ts";

const BASE = {
  findings: FIXTURE_FINDINGS,
  catalog: FIXTURE_CATALOG,
  projectRoot: PROJECT_ROOT,
  tool: { name: "fg", version: "1.0.0" },
  lang: "ru",
} as const;

const results = () => eslintResultsOf(FIXTURE_FINDINGS, { projectRoot: PROJECT_ROOT });

describe("json", () => {
  it("matches the golden document", () => {
    expect(formatLint("json", BASE).text).toBe(golden("json.txt"));
  });

  it("is a parseable array with one entry per file that has findings", () => {
    const parsed: unknown = JSON.parse(formatLint("json", BASE).text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
  });

  it("emits ESLint's result keys, in ESLint's order", () => {
    const [first] = results();
    if (first === undefined) throw new Error("no results");
    expect(Object.keys(first)).toEqual([
      "filePath",
      "messages",
      "suppressedMessages",
      "errorCount",
      "fatalErrorCount",
      "warningCount",
      "fixableErrorCount",
      "fixableWarningCount",
      "usedDeprecatedRules",
    ]);
  });

  it("reports absolute file paths", () => {
    expect(results().map((r) => r.filePath)).toEqual([
      `${PROJECT_ROOT}/src/components/Button.tsx`,
      `${PROJECT_ROOT}/src/pages/Home.tsx`,
      `${PROJECT_ROOT}/src/styles/theme.css`,
    ]);
  });

  it("sorts the file entries by path, whatever order the findings arrived in", () => {
    const reversed = [...FIXTURE_FINDINGS].toReversed();
    expect(eslintResultsOf(reversed, { projectRoot: PROJECT_ROOT }).map((r) => r.filePath)).toEqual(
      results().map((r) => r.filePath),
    );
  });

  it("maps severity onto ESLint's 2/1 scale — only `error` is 2", () => {
    const messages = results().flatMap((r) => r.messages);
    expect(messages.map((m) => m.severity)).toEqual([2, 1, 1, 1, 2, 1]);
    expect(messages.map((m) => m.ruleId)).toEqual(FIXTURE_FINDINGS.map((f) => f.rule));
  });

  it("counts errors, warnings and fixables per file", () => {
    expect(
      results().map((r) => ({
        errorCount: r.errorCount,
        warningCount: r.warningCount,
        fixableErrorCount: r.fixableErrorCount,
        fixableWarningCount: r.fixableWarningCount,
        fatalErrorCount: r.fatalErrorCount,
      })),
    ).toEqual([
      // Button.tsx: 1 error + 2 warnings, one of the warnings fixable (`style.override.size`).
      {
        errorCount: 1,
        warningCount: 2,
        fixableErrorCount: 0,
        fixableWarningCount: 1,
        fatalErrorCount: 0,
      },
      // Home.tsx: 1 error + 1 warning, nothing fixable.
      {
        errorCount: 1,
        warningCount: 1,
        fixableErrorCount: 0,
        fixableWarningCount: 0,
        fatalErrorCount: 0,
      },
      // theme.css: 1 fixable warning.
      {
        errorCount: 0,
        warningCount: 1,
        fixableErrorCount: 0,
        fixableWarningCount: 1,
        fatalErrorCount: 0,
      },
    ]);
  });

  it("carries `fix.text` only where the rule offered a replacement", () => {
    const withFix = results()
      .flatMap((r) => r.messages)
      .filter((m) => m.fix !== undefined);
    expect(withFix.map((m) => m.fix?.text)).toEqual(["var(--eds-size-m)", "var(--eds-color-fg)"]);
  });

  it("splits the fixable counters by severity, not by fixability alone", () => {
    // The shared fixture happens to have fixable WARNINGS only, so `fixableWarningCount:
    // fixable.length` would pass every other assertion in this file. A fixable ERROR is what
    // separates the two counters — and ESLint's `--fix` summary reads them separately.
    const [first] = FIXTURE_FINDINGS;
    if (first === undefined) throw new Error("fixture is empty");
    const fixableError = {
      ...first,
      expected: { token: null, cssVar: null, component: null, value: 'aria-label="Отправить"' },
    };
    const [result] = eslintResultsOf([fixableError], { projectRoot: PROJECT_ROOT });
    expect(result?.fixableErrorCount).toBe(1);
    expect(result?.fixableWarningCount).toBe(0);
  });

  it("omits `endLine`/`endColumn` — a Finding carries a point, not a range", () => {
    for (const message of results().flatMap((r) => r.messages)) {
      expect(Object.keys(message)).not.toContain("endLine");
      expect(Object.keys(message)).not.toContain("endColumn");
    }
  });

  it("keeps `suppressedMessages` and `usedDeprecatedRules` present and empty", () => {
    for (const result of results()) {
      expect(result.suppressedMessages).toEqual([]);
      expect(result.usedDeprecatedRules).toEqual([]);
    }
  });

  it("round-trips a message containing `</script>` and a double quote", () => {
    const parsed = JSON.parse(formatLint("json", BASE).text) as {
      messages: { message: string }[];
    }[];
    const nasty = parsed.flatMap((r) => r.messages).find((m) => m.message.includes("</script>"));
    expect(nasty?.message).toBe(FIXTURE_FINDINGS[3]?.why);
  });

  it("is `[]` when there is nothing to report — an empty document would not parse", () => {
    expect(formatLint("json", { ...BASE, findings: [] }).text).toBe("[]");
  });

  it("is never coloured, whatever the caller asks for", () => {
    expect(formatLint("json", { ...BASE, color: true }).text).toBe(formatLint("json", BASE).text);
  });
});
