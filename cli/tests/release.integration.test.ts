/**
 * TIER 2 — `pnpm release` (brief r1, deliverable 2).
 *
 * THE CLAIM UNDER TEST: `pnpm release` rebuilds everything and leaves the shippable artifact at
 * `<repo root>/fg.mjs`. That is the whole delivery mechanism for this product — the owner takes
 * that one file to the release thread — so the thing worth proving is that the file is really
 * there, really the bundle, and really of a plausible size.
 *
 * IT RUNS THE REAL SCRIPT, from the repo root, exactly as the owner does. Reading
 * `scripts/release.mjs` and asserting it contains a `copyFileSync` would prove a fact about a
 * source file; what matters is that the root `release` script wires `pnpm -r run build` to that
 * script and that the pair produces the file. Everything below is measured from the filesystem
 * after the run.
 *
 * THE DESTINATION IS A SCRATCH PATH, via `FG_RELEASE_OUT` — f1-fixes item 5 (V6 audit finding
 * #8). Before this fix the suite ran the REAL `pnpm release` unparameterised, which meant the
 * gate itself rewrote the repo-root `fg.mjs` as a side effect: an owner's own release artifact
 * was silently replaced by merely running `pnpm test:integration`. `scripts/release.mjs` now
 * reads `FG_RELEASE_OUT` (or `--out <path>`) and falls back to the repo root only when neither
 * is given — so `pnpm release`, typed plain by the owner, is exactly as before, while this
 * suite exercises the identical script and copy logic against a directory nobody else owns.
 * The repo-root file is asserted UNTOUCHED below, which is the fix's whole point.
 *
 * THE SIZE BAND IS THE SAME ONE the bundle is already held to by
 * `cli/tests/project-report.integration.test.ts:97-98` and by `scripts/release.mjs` itself —
 * 18 MiB to 25 MiB. Repeated here rather than imported because this suite's subject is the
 * COPY at the scratch destination, and a copy that silently differed in size from the bundle is
 * exactly the failure a shared constant would hide behind one number.
 *
 * Tier 2, and slow on purpose: it rebuilds every package. `cli/vite.config.ts:63` runs the
 * integration lane with `fileParallelism: false`, so the rebuild cannot land under another
 * suite that is reading `dist/`.
 *
 * `NODE_ENV` IS STRIPPED FROM THE CHILD, and that is not tidiness — it is the difference
 * between measuring the product and measuring an artifact nobody ships. The runner sets
 * `NODE_ENV=test`; `packages/fg-analyzer-report`'s build step is a real `vite build` of the
 * dashboard, which hands `process.env.NODE_ENV` to React, so an inherited `test` keeps React's
 * development branches and the bundle comes out 22 780 335 B instead of 22 430 880 B (measured
 * both ways). Both numbers sit inside the guard band, so the assertions below would have passed
 * while proving nothing about the owner's run — and the inflated bundle would have been left in
 * `cli/dist/` for the rest of the lane. Deleting the variable makes the child identical to
 * `pnpm release` typed at a shell (aside from `FG_RELEASE_OUT`), which is the only thing worth
 * asserting about.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const run = promisify(execFile);

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "..");
/** The owner's real destination — asserted UNTOUCHED by this suite, never written to. */
const repoRootReleased = join(repoRoot, "fg.mjs");
const builtBundle = join(packageRoot, "dist", "fg.mjs");

/** Same band as `scripts/release.mjs` and the bundle's own size guard. */
const MIN_BYTES = 18 * 1024 * 1024;
const MAX_BYTES = 25 * 1024 * 1024;

let scratchDir = "";
let released = "";
let stdout = "";

/** Whether the repo root already had a release artifact, and its content, before this suite ran. */
let repoRootPreexisting = false;
let repoRootBytesBefore: Buffer | null = null;

beforeAll(async () => {
  repoRootPreexisting = existsSync(repoRootReleased);
  repoRootBytesBefore = repoRootPreexisting ? readFileSync(repoRootReleased) : null;

  scratchDir = mkdtempSync(join(tmpdir(), "fg-release-out-"));
  released = join(scratchDir, "fg.mjs");

  const { NODE_ENV: _discarded, ...env } = process.env;
  const result = await run("pnpm", ["release"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...env, FG_RELEASE_OUT: released },
    maxBuffer: 64 * 1024 * 1024,
  });
  stdout = result.stdout;
}, 600_000);

afterAll(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

describe("pnpm release", () => {
  it("writes fg.mjs at the requested destination, never the repo root", () => {
    expect(existsSync(released)).toBe(true);
    expect(statSync(released).isFile()).toBe(true);
  });

  it("and the artifact is inside the size guard band", () => {
    const bytes = statSync(released).size;
    expect(bytes, `fg.mjs is ${String(bytes)} bytes`).toBeGreaterThanOrEqual(MIN_BYTES);
    expect(bytes, `fg.mjs is ${String(bytes)} bytes`).toBeLessThanOrEqual(MAX_BYTES);
  });

  it("is BYTE-IDENTICAL to the bundle the rebuild just emitted", () => {
    // The point of the copy is that the destination IS `cli/dist/fg.mjs`. A copy step that
    // re-encoded, truncated or picked up a stale artifact would show here and nowhere else.
    expect(readFileSync(released).equals(readFileSync(builtBundle))).toBe(true);
  });

  it("prints the absolute destination and the byte size", () => {
    // The script's only output, and the owner's receipt for the run.
    expect(stdout).toContain(released);
    expect(stdout).toContain(String(statSync(released).size));
  });

  it("and the artifact stays out of git — `.gitignore` carries `/fg.mjs`", () => {
    // The half of the contract the filesystem cannot show: `pnpm release` produces the file,
    // and an ordinary commit must never pick it up.
    const ignored = readFileSync(join(repoRoot, ".gitignore"), "utf8").split("\n");
    expect(ignored.map((line) => line.trim())).toContain("/fg.mjs");
  });

  it("never touches the repo-root fg.mjs — the whole point of `FG_RELEASE_OUT` (V6 finding #8)", () => {
    // Before the fix, running this suite silently replaced an owner's own release artifact.
    // Now the repo root is exactly as it was when the suite started: absent stays absent,
    // present stays byte-for-byte the same.
    if (repoRootPreexisting) {
      expect(existsSync(repoRootReleased)).toBe(true);
      expect(readFileSync(repoRootReleased).equals(repoRootBytesBefore as Buffer)).toBe(true);
    } else {
      expect(existsSync(repoRootReleased)).toBe(false);
    }
  });
});
