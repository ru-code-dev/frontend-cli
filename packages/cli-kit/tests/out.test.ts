/**
 * THE OUTPUT CONTRACT'S TWO PRIMITIVES — the sanitizer and the stdout writer.
 *
 * They decide two things every command in the repo depends on: what a generated filename may
 * contain, and what reaches STDOUT when a run is over. The first is pure and is tested as a
 * table; the second is design U3's whole enforcement and is tested against both lanes.
 *
 * The per-command defaults built ON these live with their commands
 * (`packages/fg-pixso/tests/out.test.ts`), because a default path is a product decision and this
 * package holds none.
 */
import { describe, expect, it } from "vite-plus/test";

import type { CommandContext } from "../src/index.ts";
import { FG_OUT_DIR, emitPaths, safeSegment, silentUi } from "../src/index.ts";

describe("FG_OUT_DIR", () => {
  it("is one plain, visible, relative segment", () => {
    expect(FG_OUT_DIR).toBe("fg-out");
    // Not hidden (a user must find it), not absolute, not nested.
    expect(FG_OUT_DIR.startsWith(".")).toBe(false);
    expect(FG_OUT_DIR).not.toContain("/");
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

/**
 * U3, THE PREDICATE. `emitPaths` writes the absolute paths on stdout — but only into a PIPE.
 *
 * Getting this backwards is invisible in a test that only checks the piped lane, and it is the
 * exact duplication the redesign removes: on a terminal the paths are already in the summary
 * block on stderr, so a second copy on stdout is the "everything printed twice" the owner
 * rejected (`WORKFLOW/features/cli-ux/plans/current-output.txt`).
 */
function ctxWith(stdoutIsTTY: boolean): { ctx: CommandContext; out: string[] } {
  const out: string[] = [];
  const ctx = {
    cwd: "/tmp",
    lang: "ru",
    env: {},
    flags: {},
    stdout: (s: string) => void out.push(s),
    stderr: () => {},
    stdoutIsTTY,
    verbose: false,
    ui: silentUi,
  } satisfies CommandContext;
  return { ctx, out };
}

describe("emitPaths — stdout carries the paths only when stdout is NOT a terminal (U3)", () => {
  it("piped: one absolute path per line, in order, each newline-terminated", () => {
    const { ctx, out } = ctxWith(false);
    emitPaths(ctx, ["/abs/one.svg", "/abs/two.html"]);
    expect(out).toEqual(["/abs/one.svg\n", "/abs/two.html\n"]);
  });

  it("a terminal gets NOTHING on stdout — the summary block already showed the paths", () => {
    const { ctx, out } = ctxWith(true);
    emitPaths(ctx, ["/abs/one.svg"]);
    expect(out).toEqual([]);
  });

  it("an empty list writes nothing in either lane", () => {
    const piped = ctxWith(false);
    emitPaths(piped.ctx, []);
    expect(piped.out).toEqual([]);
  });

  /** U6 reaches stdout too: a 300-character path is one line, unbroken. */
  it("never wraps: a 300-character path arrives as ONE line", () => {
    const long = `/${"segment/".repeat(37)}report.html`;
    expect(long.length).toBeGreaterThan(300);
    const { ctx, out } = ctxWith(false);
    emitPaths(ctx, [long]);
    expect(out).toEqual([`${long}\n`]);
    expect(out[0]?.split("\n").filter((l) => l !== "")).toHaveLength(1);
  });
});
