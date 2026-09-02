/**
 * TIER 1 — THE ENTRY GUARD (V2 audit BLOCKER-1).
 *
 * `isEntry` is the predicate at the bottom of `cli/src/main.ts` that decides whether this
 * module was RUN or merely IMPORTED. It has to be exactly right in both directions, and for a
 * long time it was right in only one: it compared `process.argv[1]` to `import.meta.url`
 * without resolving either, so it answered `false` for every installed copy of this package —
 * `npm install` materialises `bin/fe` as a SYMLINK, Node reports the symlink in `argv[1]` and
 * the target in `import.meta.url`, and the shipped binary exited 0 having done nothing.
 *
 * The end-to-end proof is `installed-bin.integration.test.ts`, which packs, installs and runs
 * the real symlink. This file is the cheap half of the same claim: the predicate itself, over
 * real symlinks on a real filesystem, including the paths where resolution is not possible at
 * all. Disk is used rather than mocked for the reason `dotenv.test.ts` uses it — a symlink is
 * precisely the thing a fake filesystem would get wrong.
 */
import { mkdirSync, symlinkSync, writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { makeTempDir, removeTempDir } from "@smart-tools/fe-testkit";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { isEntry } from "../src/main.ts";

/** Resolved up front: on some systems the temp root is itself a symlink, and a test about
 *  symlink resolution must not accidentally be testing that one. */
let root = "";
/** The "bundle": a real file, standing in for `dist/main.mjs`. */
let target = "";
/** Its `file://` URL — what Node would put in `import.meta.url` when running it either way. */
let targetUrl = "";
/** The "installed bin": a symlink to `target`, which is what `argv[1]` would be. */
let link = "";

beforeAll(() => {
  root = realpathSync(makeTempDir("fe-entry-"));
  target = join(root, "dist", "main.mjs");
  mkdirSync(join(root, "dist"));
  writeFileSync(target, "// stand-in for the bundle\n");
  targetUrl = pathToFileURL(target).href;

  mkdirSync(join(root, "bin"));
  link = join(root, "bin", "fe");
  symlinkSync(target, link);
});

afterAll(() => {
  if (root !== "") removeTempDir(root);
});

describe("isEntry", () => {
  it("true when the module IS the script, reached by its real path", () => {
    // `node dist/main.mjs` — the case that always worked, and every other integration suite's.
    expect(isEntry(target, targetUrl)).toBe(true);
  });

  it("true through a SYMLINK — the installed shape, and the blocker", () => {
    // `npm install` writes `node_modules/.bin/fe -> …/dist/main.mjs`; Node hands the symlink to
    // `argv[1]` and the resolved target to `import.meta.url`. This is the one assertion whose
    // absence let a silent no-op ship.
    expect(link).not.toBe(target);
    expect(isEntry(link, targetUrl)).toBe(true);
  });

  it("false when the module was merely IMPORTED, which is why the guard exists", () => {
    // The original reason for the guard: a test importing this module must not run the CLI
    // against the test runner's argv. The runner's `argv[1]` is some other real file.
    const other = join(root, "dist", "runner.mjs");
    writeFileSync(other, "// some other script\n");
    expect(isEntry(other, targetUrl)).toBe(false);
  });

  it("false, and does not throw, when argv[1] cannot be resolved at all", () => {
    // `realpathSync` throws on a path that is not there. That is not a licence to run: it only
    // means we cannot prove this module is the entry, so the guard stays closed. A throw here
    // would be worse than either answer — it would crash the binary before it started.
    expect(isEntry(join(root, "does", "not", "exist"), targetUrl)).toBe(false);
    expect(isEntry("", targetUrl)).toBe(false);
    // A broken link resolves no better than a missing file.
    const broken = join(root, "bin", "dangling");
    symlinkSync(join(root, "gone.mjs"), broken);
    expect(isEntry(broken, targetUrl)).toBe(false);
  });

  it("still true when argv[1] is unresolvable but textually identical", () => {
    // The fallback keeps the OLD behaviour rather than replacing it: when neither side can be
    // resolved, the plain comparison is all there is, and it must still answer true for a
    // module whose file has been deleted out from under a running process.
    const ghost = join(root, "vanished.mjs");
    expect(isEntry(ghost, pathToFileURL(ghost).href)).toBe(true);
  });
});
