/**
 * THE OUTPUT CONTRACT'S TWO PRIMITIVES — the sanitizer and the result builder.
 *
 * They are three dozen lines between them and they decide two things every command in the repo
 * depends on: what a generated filename may contain, and what the last thing a run says looks
 * like. Both are pure, so this suite is a table and nothing else.
 *
 * The per-command defaults built ON these live with their commands
 * (`packages/fe-pixso/tests/out.test.ts`), because a default path is a product decision and this
 * package holds none.
 */
import { describe, expect, it } from "vite-plus/test";

import { FE_OUT_DIR, resultOf, safeSegment } from "../src/index.ts";

describe("FE_OUT_DIR", () => {
  it("is one plain, visible, relative segment", () => {
    expect(FE_OUT_DIR).toBe("fe-out");
    // Not hidden (a user must find it), not absolute, not nested.
    expect(FE_OUT_DIR.startsWith(".")).toBe(false);
    expect(FE_OUT_DIR).not.toContain("/");
  });
});

describe("safeSegment — the documented rule, step by step", () => {
  it.each([
    // 1. runs of unsafe characters collapse to one `-`
    ["11:10", "11-10"],
    ["a///b", "a-b"],
    ["one two   three", "one-two-three"],
    ["🙂name", "name"],
    // 2. leading and trailing `-` and `.` are stripped
    ["-lead", "lead"],
    ["trail-", "trail"],
    [".hidden", "hidden"],
    ["dotted.", "dotted"],
    // …which is also what makes traversal and hiding impossible to produce
    ["..", "FB"],
    [".", "FB"],
    ["../../etc/passwd", "etc-passwd"],
    ["/absolute/path", "absolute-path"],
    // 4. nothing survives ⇒ the fallback
    ["", "FB"],
    ["///", "FB"],
    ["...", "FB"],
    // what is already safe passes through untouched
    ["Frame_1.2-3", "Frame_1.2-3"],
  ])("%j → %j", (raw, expected) => {
    expect(safeSegment(raw, "FB")).toBe(expected);
  });

  it("cuts to 64 characters, and the cut cannot leave a trailing separator", () => {
    expect(safeSegment("x".repeat(200), "FB")).toHaveLength(64);
    // 63 safe characters, then the 64th position lands on what became a `-`. Step 3 re-strips.
    const cut = safeSegment(`${"x".repeat(63)} tail`, "FB");
    expect(cut).toBe("x".repeat(63));
    expect(cut.endsWith("-")).toBe(false);
  });

  it("is TOTAL — every input yields a non-empty segment that is one path component", () => {
    for (const raw of ["", " ", "\n", "..", "/", "\\", "a".repeat(500), "🙂", "?*<>|"]) {
      const out = safeSegment(raw, "FB");
      expect(out.length).toBeGreaterThan(0);
      expect(out).not.toContain("/");
      expect(out).not.toContain("\\");
      expect(out.startsWith(".")).toBe(false);
    }
  });
});

describe("resultOf — headline, then one absolute path per line", () => {
  const HEAD = { ru: "готово, записано 2 файла", en: "done, 2 files written" };

  it("puts each path on its own line, in the order given, in both languages", () => {
    const paths = ["/a/one.svg", "/a/two.html"];
    const result = resultOf(HEAD, paths);
    expect(result.ru.split("\n")).toEqual([HEAD.ru, ...paths]);
    expect(result.en.split("\n")).toEqual([HEAD.en, ...paths]);
  });

  it("builds both languages from the SAME list — they can never disagree about what was written", () => {
    const result = resultOf(HEAD, ["/a/one.svg", "/a/two.html"]);
    expect(result.ru.split("\n").slice(1)).toEqual(result.en.split("\n").slice(1));
  });

  it("an empty list is just the headline — a command that wrote nothing still ends", () => {
    expect(resultOf(HEAD, [])).toEqual(HEAD);
  });

  it("never folds a path into the sentence: line 1 is the headline, unchanged", () => {
    expect(resultOf(HEAD, ["/a/one.svg"]).ru.split("\n")[0]).toBe(HEAD.ru);
  });
});
