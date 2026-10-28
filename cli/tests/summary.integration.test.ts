/**
 * TIER 2 — `--preport --format html,summary` on the REAL bundle (G1).
 *
 * The parity claim, end to end: the summary file a run writes equals `summaryOf` applied to the
 * very payload the same run embedded in `report.html` (read back out of its `ds-data` slot, the
 * way the dashboard reads it). That `summaryOf` equals what the dashboard SHOWS for a payload is
 * the dashboard-render suite's subject (`packages/fg-analyzer-report/tests/dashboard-render.test.ts`).
 *
 * `summaryOf` is imported from the package SOURCE by relative path: this package does not depend
 * on `fg-analyzer-report`, and the comparison wants the code, not a second build of it.
 */
import { execFile } from "node:child_process";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { makeTempDir, removeTempDir } from "@smart-tools/fg-testkit";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { summaryOf } from "../../packages/fg-analyzer-report/src/summary.ts";

const run = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(packageRoot, "dist", "fg.mjs");
const fixtures = join(packageRoot, "tests", "fixtures");
/** A real React project on disk — this repo's own dashboard (read-only, copied before analysis). */
const realProject = resolve(packageRoot, "..", "packages", "fg-analyzer-report", "dashboard");

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) removeTempDir(dir);
});

/** Copy `project` into scratch, analyse it with html,summary into `<scratch>/out`, return both. */
async function analyse(project: string, args: readonly string[] = []) {
  const dir = makeTempDir("fg-summary-");
  dirs.push(dir);
  const copy = join(dir, "project");
  cpSync(project, copy, { recursive: true, filter: (src) => !src.includes("node_modules") && !src.endsWith("/dist") });
  const out = join(dir, "out");
  const result = await run(process.execPath, [bundle, "--preport", copy, "--format", "html,summary", "-o", out, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  }).catch((error: { code: number; stdout: string; stderr: string }) => error);
  const html = readFileSync(join(out, "report.html"), "utf8");
  const slot = /<script type="application\/json" id="ds-data">([\s\S]*?)<\/script>/u.exec(html)?.[1] ?? "";
  const summaryText = readFileSync(join(out, "report.summary.json"), "utf8");
  return {
    out,
    stdout: "stdout" in result ? result.stdout : "",
    payload: JSON.parse(slot) as Parameters<typeof summaryOf>[0],
    summaryText,
    summary: JSON.parse(summaryText) as ReturnType<typeof summaryOf> & { artifacts: Record<string, string> },
  };
}

describe("G1 — the summary file is summaryOf(the payload the dashboard embeds)", () => {
  it("kit project (--ui-kit eds): health, kit shares and coverage are present and equal", async () => {
    const r = await analyse(join(fixtures, "kit-api"), ["--ui-kit", "eds"]);
    const { artifacts, ...rest } = r.summary;
    expect(rest).toEqual(summaryOf(r.payload));
    expect(r.summary.health).not.toBeNull();
    expect(r.summary.kit).not.toBeNull();
    expect(artifacts).toEqual({ html: join(r.out, "report.html"), summary: join(r.out, "report.summary.json") });
  });

  it("no design system: the same equality, with health and kit null", async () => {
    const r = await analyse(join(fixtures, "plain-css"), ["--ui-kit", "none"]);
    const { artifacts: _artifacts, ...rest } = r.summary;
    expect(rest).toEqual(summaryOf(r.payload));
    expect(r.summary.health).toBeNull();
    expect(r.summary.totals.findings).toBeGreaterThan(0);
  });

  it("summary alone is a file format with -o FILE semantics", async () => {
    const dir = makeTempDir("fg-summary-only-");
    dirs.push(dir);
    const file = join(dir, "s.json");
    await run(process.execPath, [bundle, "--preport", join(fixtures, "plain-css"), "--format", "summary", "-o", file], {
      cwd: dir,
      encoding: "utf8",
    }).catch(() => undefined);
    expect(existsSync(file)).toBe(true);
    expect((JSON.parse(readFileSync(file, "utf8")) as { artifacts: unknown }).artifacts).toEqual({ summary: file });
  });

  it("measured on a real project: far below qwen's 30 000-char shell output cap", async () => {
    const r = await analyse(realProject);
    expect(r.summary.totals.filesScanned).toBeGreaterThan(10);
    expect(r.summaryText.length).toBeLessThan(5000);
    // Recorded for the evidence file.
    console.log(`summary size on ${realProject}: ${String(r.summaryText.length)} chars, ${String(r.summary.totals.filesScanned)} files, ${String(r.summary.totals.findings)} findings`);
  });
});
