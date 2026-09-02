/**
 * `formatLint` — the dispatcher, the counters, and the two structural laws the design puts on
 * this package (purity, and a types-only engine dependency).
 *
 * The counter assertions are the important ones: `errorCount` is what the CLI turns into the
 * process exit code (design D9), so "every format reports the same counts" is not a tidiness
 * check — it is the guarantee that `--format sarif` and `--format compact` fail the same
 * build.
 *
 * `stylish` was DELETED with the UX redesign (design U1) — it and `compact` were two paragraph
 * layouts of the same findings — so the roster assertions below are the guard against it
 * creeping back as a fourth format nobody chose.
 *
 * MUTATION CHECKS ACTUALLY RUN (patch applied, suite run, patch reverted — see the report):
 *  - `candidate` counted as a warning in `countSeverities` (`src/counts.ts:44`) — 5 fail,
 *    including "counts each severity separately, over the whole run" and "every format agrees
 *    on the counts".
 */
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { countSeverities, formatLint, LINT_FORMATS, type LintFormat } from "../src/index.ts";
import { FIXTURE_CATALOG, FIXTURE_FINDINGS, PROJECT_ROOT } from "./fixtures/findings.ts";

const BASE = {
  findings: FIXTURE_FINDINGS,
  catalog: FIXTURE_CATALOG,
  projectRoot: PROJECT_ROOT,
  tool: { name: "fg", version: "1.0.0" },
  lang: "ru",
} as const;

describe("formatLint", () => {
  it("offers exactly the three formats the UX design leaves (U1), human one first", () => {
    expect(LINT_FORMATS).toEqual(["compact", "json", "sarif"]);
  });

  it("counts each severity separately, over the whole run", () => {
    expect(countSeverities(FIXTURE_FINDINGS)).toEqual({
      errorCount: 2,
      warningCount: 2,
      infoCount: 1,
      candidateCount: 1,
    });
    expect(countSeverities([])).toEqual({
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      candidateCount: 0,
    });
  });

  it("every format agrees on the counts — the exit code cannot depend on `--format`", () => {
    const expected = { errorCount: 2, warningCount: 2, infoCount: 1, candidateCount: 1 };
    for (const format of LINT_FORMATS) {
      const out = formatLint(format, BASE);
      expect({
        errorCount: out.errorCount,
        warningCount: out.warningCount,
        infoCount: out.infoCount,
        candidateCount: out.candidateCount,
      }).toEqual(expected);
    }
  });

  it("reports zero errors — and therefore exit 0 — when nothing error-severity is visible", () => {
    const quiet = FIXTURE_FINDINGS.filter((f) => f.severity !== "error");
    for (const format of LINT_FORMATS) {
      expect(formatLint(format, { ...BASE, findings: quiet }).errorCount).toBe(0);
    }
  });

  it("renders each format through its own writer", () => {
    // `compact` opens with the first file group's path, RELATIVE to the project root.
    expect(formatLint("compact", BASE).text.startsWith("src/components/Button.tsx\n")).toBe(true);
    expect(formatLint("json", BASE).text.startsWith("[{")).toBe(true);
    expect(formatLint("sarif", BASE).text.startsWith('{\n  "$schema"')).toBe(true);
  });

  it("is deterministic — the same input renders byte for byte the same document", () => {
    for (const format of LINT_FORMATS) {
      expect(formatLint(format, BASE).text).toBe(formatLint(format, BASE).text);
    }
  });

  it("does not mutate or reorder the findings it was handed", () => {
    const input = [...FIXTURE_FINDINGS];
    const snapshot = JSON.stringify(input);
    for (const format of LINT_FORMATS) formatLint(format, { ...BASE, findings: input });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("says so in `compact`, and prints the empty JSON documents, when there are no findings", () => {
    const empty = { ...BASE, findings: [] };
    // NOT the empty string any more: a clean run is a result the reader is owed a line about
    // (design §2.4, "`✔ проблем нет` green when 0 visible").
    expect(formatLint("compact", empty).text).toBe("✔ проблем нет");
    expect(formatLint("json", empty).text).toBe("[]");
    expect(JSON.parse(formatLint("sarif", empty).text)).toMatchObject({ version: "2.1.0" });
  });

  it("colours `compact` only — the two machine formats ignore the flag", () => {
    const coloured: Record<LintFormat, boolean> = { compact: false, json: false, sarif: false };
    for (const format of LINT_FORMATS) {
      coloured[format] =
        formatLint(format, { ...BASE, color: true }).text !== formatLint(format, BASE).text;
    }
    // An escape inside a JSON string would make the document unparseable, so `color` may not
    // reach the two machine formats even by accident.
    expect(coloured).toEqual({ compact: true, json: false, sarif: false });
  });

  it("ignores `verbose`, `width` and `hiddenCount` in the machine formats", () => {
    for (const format of ["json", "sarif"] as const) {
      expect(formatLint(format, { ...BASE, verbose: true, width: 60, hiddenCount: 7 }).text).toBe(
        formatLint(format, BASE).text,
      );
    }
  });
});

describe("package laws", () => {
  const sources = readdirSync(new URL("../src", import.meta.url)).filter((f) => f.endsWith(".ts"));

  it("has a source file for each format plus the shared pieces", () => {
    expect(sources.toSorted()).toEqual([
      "ansi.ts",
      "compact.ts",
      "counts.ts",
      "index.ts",
      "json.ts",
      "sarif.ts",
      "text.ts",
      "types.ts",
    ]);
  });

  it("imports the engine for types only — the CLI bundle must not gain a second copy", () => {
    for (const file of sources) {
      const text = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
      for (const line of text.split("\n")) {
        if (!line.includes("@smart-tools/fg-analyzer-engine")) continue;
        // Doc comments name the package; only IMPORT statements are the law's subject.
        if (!line.trimStart().startsWith("import")) continue;
        expect(`${file}: ${line.trim()}`).toContain("import type");
      }
    }
  });

  it("is pure — no `node:` builtin, no environment, no clock anywhere in `src/`", () => {
    for (const file of sources) {
      const text = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
      const code = text.split("\n").filter((line) => !line.trimStart().startsWith("*"));
      for (const forbidden of ['from "node:', "process.env", "Date.now(", "Math.random("]) {
        expect(`${file}: ${code.join("\n")}`).not.toContain(forbidden);
      }
    }
  });
});
