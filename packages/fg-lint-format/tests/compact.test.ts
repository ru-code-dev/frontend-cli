/**
 * `compact` — the document a person reads in a terminal, so the central assertions are GOLDEN
 * FILES: `tests/fixtures/golden/compact.*.txt` can be opened and looked at, which is the only
 * honest way to review a layout whose whole content is column alignment.
 *
 * Binding source: `WORKFLOW/features/cli-ux/plans/ux-design.md` §2.4. Five goldens cover the
 * axes that change the layout rather than the words — language, `--verbose`, and the three
 * width cases (100 columns, a narrow 60, and none at all) — and the rest of the suite asserts
 * the properties a golden cannot: that colour adds escapes and NOTHING else, that a value out
 * of the analysed project cannot forge a row, and that the footer's Russian agrees with its
 * number.
 *
 * THE OLD `$eslint-compact` MATCHER TEST IS GONE, deliberately. Until the UX redesign this
 * format existed for VS Code's built-in problem matcher and the suite asserted every line
 * against that regular expression; design §2.4 drops the matcher (IDE integration is SARIF and
 * JSON), so a test still asserting it would be pinning a contract with a consumer we no longer
 * serve — and would block the layout this format now exists for.
 *
 * MUTATION CHECKS ACTUALLY RUN (patch applied, suite run, patch reverted — see the report):
 *  - `INDENT` 3 → 2 spaces (`src/compact.ts`) — 5 fail, every golden.
 *  - per-file `locWidth` → the whole document's widest — 3 fail: both 100-column goldens and
 *    the alignment test, `Home.tsx`'s rows having been indented by `theme.css`'s widest.
 *  - `truncate` limit 60 → 61 — 2 fail, including "truncates `actual` at 60 columns with `…`".
 *  - `sanitize` dropped from `actual` — 2 fail: the forged row appears in the output and the
 *    escape survives.
 *  - the footer's `ru` plural forms collapsed to one — 3 fail, including the plural table.
 *  - the label lookup ignoring `subkind` — 2 fail: the `a11y.lint` row is named after its
 *    parent rule instead of `alt-text`.
 */
import { describe, expect, it } from "vite-plus/test";

import { formatLint, stripAnsi } from "../src/index.ts";
import {
  FIXTURE_CATALOG,
  FIXTURE_FINDINGS,
  LONG_FINDING,
  NASTY_FINDING,
  PROJECT_ROOT,
  UNCATALOGUED_FINDING,
} from "./fixtures/findings.ts";
import { golden } from "./fixtures/golden.ts";

/** A hundred columns is the design's own ceiling for the help table (§2.7) and a real terminal. */
const WIDTH = 100;

/** Spelled out rather than pasted: a raw escape byte in a test file is invisible in review. */
const ESC = "\u001b";

const [FIRST] = FIXTURE_FINDINGS;
if (FIRST === undefined) throw new Error("fixture is empty");

const BASE = {
  findings: FIXTURE_FINDINGS,
  catalog: FIXTURE_CATALOG,
  projectRoot: PROJECT_ROOT,
  tool: { name: "fg", version: "1.0.0" },
  lang: "ru",
  width: WIDTH,
} as const;

const render = (overrides: Partial<Parameters<typeof formatLint>[1]> = {}): string =>
  formatLint("compact", { ...BASE, ...overrides }).text;

/** Everything before the footer: the file headers, the rows and the blank separators. */
const bodyOf = (text: string): readonly string[] => text.split("\n").slice(0, -1);

const glyph = (line: string): number => line.search(/[✖▲●◇]/u);

const footerOf = (text: string): string => {
  const lines = text.split("\n");

  return lines[lines.length - 1] ?? "";
};

describe("compact — the golden documents", () => {
  it("matches the golden (ru, 100 columns, 3 hidden by config)", () => {
    expect(render({ hiddenCount: 3 })).toBe(golden("compact.ru.txt"));
  });

  it("matches the golden (en, 100 columns)", () => {
    expect(render({ lang: "en" })).toBe(golden("compact.en.txt"));
  });

  it("matches the golden (ru, --verbose: `why` under each row)", () => {
    expect(render({ verbose: true })).toBe(golden("compact.verbose.txt"));
  });

  it("matches the golden (ru, a narrow 60-column terminal)", () => {
    expect(render({ width: 60 })).toBe(golden("compact.narrow.txt"));
  });

  it("matches the golden (ru, width unknown — a pipe, a file, a CI log)", () => {
    expect(render({ width: undefined })).toBe(golden("compact.piped.txt"));
  });

  it("puts the rule id where the width says, and two spaces away when there is none", () => {
    const wide = bodyOf(render()).filter((line) => line.includes("token.literal.color"));
    const piped = bodyOf(render({ width: undefined })).filter((line) =>
      line.includes("token.literal.color"),
    );

    // Flushed right to the terminal's last column…
    expect(wide.every((line) => line.length === WIDTH)).toBe(true);
    // …and, with no width to flush to, exactly two spaces after the message.
    expect(piped.every((line) => /\S {2}token\.literal\.color$/u.test(line))).toBe(true);
  });
});

describe("compact — the row", () => {
  it("groups by file, in the engine's order, with the path relative and whole", () => {
    const lines = bodyOf(render());
    const files = lines.filter((line) => line.endsWith(".tsx") || line.endsWith(".css"));

    expect(files).toEqual([
      "src/components/Button.tsx",
      "src/pages/Home.tsx",
      "src/styles/theme.css",
    ]);
    // U6: never absolute, never truncated, never wrapped — not even a 300-character one.
    const long = `src/${"deeply/".repeat(40)}Component.tsx`;
    const deep = render({ findings: [{ ...FIRST, file: long }] });

    expect(deep.split("\n")[0]).toBe(long);
    expect(deep).not.toContain(PROJECT_ROOT);
  });

  it("right-aligns `line:col` to the widest in the FILE group, not the document", () => {
    const rows = bodyOf(render()).filter((line) => /^\s+\d+:\d+ {2}[✖▲●◇]/u.test(line));

    // `Button.tsx` holds 12:5, 12:40 and 48:3 — five columns wide; `Home.tsx` holds 7:1 and
    // 130:22 — six. Each group lines its own rows up, and the wider group does NOT indent the
    // narrower one, which is what a per-document alignment would do.
    expect(rows).toHaveLength(6);
    expect(new Set(rows.slice(0, 3).map(glyph)).size).toBe(1);
    expect(new Set(rows.slice(3, 5).map(glyph)).size).toBe(1);
    expect(glyph(rows[3] ?? "")).toBe(glyph(rows[0] ?? "") + 1);
    // Button.tsx `12:40` → 3 + 5, Home.tsx `130:22` → 3 + 6, theme.css `3:9` → 3 + 3.
    expect(rows.map((line) => /^\s+\d+:\d+/u.exec(line)?.[0].length)).toEqual([8, 8, 8, 9, 9, 6]);
  });

  it("names the problem with the rule's label, and a sub-rule with its own", () => {
    const lines = bodyOf(render());
    const lint = lines.find((line) => line.includes("a11y.lint"));
    const name = lines.find((line) => line.includes("a11y.name.missing"));

    // `a11y.lint`'s own label would be «Базовое правило доступности» — true of all thirty
    // sub-rules and useful for none, so the row is named after `alt-text` instead.
    expect(lint).toContain("Изображение без alt");
    expect(lint).not.toContain("Базовое правило доступности");
    expect(name).toContain("Контрол без доступного имени");
  });

  it("switches the labels with `lang`, and leaves the severity words alone", () => {
    const en = render({ lang: "en" });

    expect(en).toContain("Image without alt");
    expect(en).not.toContain("Изображение без alt");
    // Format tokens in both languages — design §2.4 draws the Russian document with them.
    expect(render()).toContain("✖ error");
    expect(en).toContain("✖ error");
  });

  it("prints `actual` alone for a rule the catalog never heard of", () => {
    const row = bodyOf(render({ findings: [UNCATALOGUED_FINDING], width: undefined }))[1] ?? "";

    // No invented name and no double gap where a label would have gone — just the value, then
    // the rule id, which is the only name anyone can honestly give this finding.
    expect(row).toContain("<Whatever />  future.rule.nobody.declared");
    expect(row.trimEnd().endsWith("future.rule.nobody.declared")).toBe(true);
  });

  it("truncates `actual` at 60 columns with `…`, and never the fix line", () => {
    const text = render({ findings: [LONG_FINDING] });
    const row = bodyOf(text)[1] ?? "";
    const actual = /[●▲✖◇] \w+ +(.+?) {2}/u.exec(row)?.[1] ?? "";

    expect([...actual]).toHaveLength(60);
    expect(actual.endsWith("…")).toBe(true);
    expect(actual).toBe("linear-gradient(90deg, rgba(0, 0, 0, 0.16) 0%, rgba(255, 25…");
    expect(text).not.toContain("100%)");
  });

  it("prints the fix under the row, indented to the message column", () => {
    const lines = bodyOf(render());
    const row = lines.findIndex((line) => line.includes("token.literal.color"));
    const fix = lines[row + 1] ?? "";

    expect(fix.trim()).toBe("→ var(--eds-color-fg)");
    const message = lines[row]?.search(/#1a1a1a/u) ?? -1;
    expect(fix.search(/→/u)).toBe(message);
  });

  it("prints `why` only under `--verbose`, wrapped inside the terminal", () => {
    const quiet = render({ findings: [LONG_FINDING] });
    const loud = render({ findings: [LONG_FINDING], verbose: true });
    // [file, row, why…, blank, footer] — everything between the row and the blank is the
    // explanation this flag exists for.
    const explanation = loud.split("\n").slice(2, -2);

    expect(quiet).not.toContain("тема его не переопределит");
    expect(explanation.length).toBeGreaterThan(1);
    expect(explanation.map((line) => line.trim()).join(" ")).toBe(LONG_FINDING.why);
    for (const line of explanation) {
      // Wrapped inside the terminal and indented to the message column, so the explanation
      // reads as a continuation of its row rather than as a new one.
      expect(line.length).toBeLessThanOrEqual(WIDTH);
      expect(line.startsWith(" ".repeat(20))).toBe(true);
      expect(line.trimStart()).toBe(line.trim());
    }
  });

  it("cannot be broken by a newline or an escape in a value from the project", () => {
    const text = render({ findings: [NASTY_FINDING], verbose: true });
    const lines = text.split("\n");

    // ONE row, not two: the newline the value carried was flattened into a space, so the
    // fragment that looks like a row (`999:1  ✖ error  подделка`) stays inside the first row's
    // message instead of becoming a second finding in a file nobody analysed.
    expect(lines.filter((line) => /^\s+\d+:\d+ {2}[✖▲●◇]/u.test(line))).toHaveLength(1);
    expect(lines.filter((line) => line.trimStart().startsWith("999:1"))).toEqual([]);
    expect(lines[1]).toContain("import 'lucide' 999:1");
    // The escape is gone rather than passed through to repaint the reader's terminal.
    expect(text).not.toContain(ESC);
    expect(text).toContain("Первая строка. Вторая строка.");
  });
});

describe("compact — colour", () => {
  it("is the plain document plus escapes, and nothing else (NO_COLOR / pipe parity)", () => {
    for (const options of [{}, { verbose: true }, { width: undefined }, { hiddenCount: 4 }]) {
      const plain = render(options);
      const coloured = render({ ...options, color: true });

      expect(coloured).not.toBe(plain);
      expect(stripAnsi(coloured)).toBe(plain);
    }
  });

  it("paints the file bold, the severities by rank, the id dim and the fix dim green", () => {
    const text = render({ color: true, hiddenCount: 3 });

    expect(text).toContain(`${ESC}[1msrc/components/Button.tsx${ESC}[0m`);
    expect(text).toContain(`${ESC}[0;31m✖ error${ESC}[0m`);
    expect(text).toContain(`${ESC}[0;33m▲ warning${ESC}[0m`);
    expect(text).toContain(`${ESC}[0;34m● info${ESC}[0m`);
    expect(text).toContain(`${ESC}[0;35m◇ candidate${ESC}[0m`);
    expect(text).toContain(`${ESC}[2ma11y.name.missing${ESC}[0m`);
    expect(text).toContain(`${ESC}[2m${ESC}[0;32m→ var(--eds-size-m)${ESC}[0m`);
    expect(text).toContain(`${ESC}[2mскрыто конфигом: 3${ESC}[0m`);
    expect(text).toContain(`${ESC}[0;31m✖ 6 проблем`);
  });

  it("never colours what a golden shows plain", () => {
    for (const options of [{}, { verbose: true }, { hiddenCount: 3 }, { findings: [] }]) {
      expect(render(options)).not.toContain(ESC);
    }
  });
});

describe("compact — the footer", () => {
  const counts = (severities: readonly string[]): string =>
    footerOf(
      render({
        findings: severities.map((severity, index) => ({
          ...FIRST,
          id: `f${index}`,
          severity: severity as "error",
        })),
      }),
    );

  it("leads with the worst severity present", () => {
    expect(counts(["error", "warning"]).startsWith("✖ ")).toBe(true);
    expect(counts(["warning", "warning"]).startsWith("▲ ")).toBe(true);
    expect(counts(["info"]).startsWith("● ")).toBe(true);
    expect(counts(["candidate"]).startsWith("◇ ")).toBe(true);
  });

  it("breaks the total down over the severities that are actually there", () => {
    expect(counts(["error", "error", "warning"])).toBe(
      "✖ 3 проблемы   2 ошибки · 1 предупреждение",
    );
    expect(counts(["warning"])).toBe("▲ 1 проблема   1 предупреждение");
    expect(footerOf(render())).toBe(
      "✖ 6 проблем   2 ошибки · 2 предупреждения · 1 инфо · 1 кандидат",
    );
  });

  it("says how many the config hid, and only when it hid something", () => {
    expect(footerOf(render({ hiddenCount: 3 })).endsWith("скрыто конфигом: 3")).toBe(true);
    expect(footerOf(render({ hiddenCount: 0 }))).not.toContain("скрыто");
    expect(footerOf(render({ hiddenCount: 3, lang: "en" })).endsWith("hidden by config: 3")).toBe(
      true,
    );
  });

  it("is the only line printed for a clean run", () => {
    expect(render({ findings: [] })).toBe("✔ проблем нет");
    expect(render({ findings: [], lang: "en" })).toBe("✔ no problems");
    // Nothing visible but something hidden is NOT the same run, and says so.
    expect(render({ findings: [], hiddenCount: 3 })).toBe("✔ проблем нет   скрыто конфигом: 3");
    expect(render({ findings: [], hiddenCount: 3, lang: "en" })).toBe(
      "✔ no problems   hidden by config: 3",
    );
  });

  it("agrees with the count in Russian: 1 / 2 / 5 / 11 / 21 / 101", () => {
    const problems = (total: number): string =>
      counts(Array.from({ length: total }, () => "info")).split("   ")[0] ?? "";

    expect(problems(1)).toBe("● 1 проблема");
    expect(problems(2)).toBe("● 2 проблемы");
    expect(problems(5)).toBe("● 5 проблем");
    expect(problems(11)).toBe("● 11 проблем");
    expect(problems(21)).toBe("● 21 проблема");
    expect(problems(101)).toBe("● 101 проблема");
  });

  it("agrees with the count in English, `info` included", () => {
    const en = (severities: readonly string[]): string =>
      footerOf(
        render({
          lang: "en",
          findings: severities.map((severity, index) => ({
            ...FIRST,
            id: `f${index}`,
            severity: severity as "error",
          })),
        }),
      );

    expect(en(["error"])).toBe("✖ 1 problem   1 error");
    expect(en(["error", "error"])).toBe("✖ 2 problems   2 errors");
    // `info` is invariable in both languages — "1 infos" is the bug this row exists for.
    expect(en(["info"])).toBe("● 1 problem   1 info");
    expect(en(["info", "info"])).toBe("● 2 problems   2 info");
    expect(en(["candidate", "candidate"])).toBe("◇ 2 problems   2 candidates");
  });
});
