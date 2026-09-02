/**
 * TIER 2 — THE INSTALLED BINARY, RUN THROUGH ITS SYMLINK.
 *
 * THE CLAIM UNDER TEST is the one every other suite in this package assumes and none of them
 * checks: that `npm i @smart-tools/frontend-cli` produces a `fe` that WORKS. Not that the
 * tarball has the right shape — `publish.integration.test.ts` proves that exhaustively, down to
 * byte-identity of the packed `dist` — but that the executable npm materialises actually runs a
 * command and prints its output.
 *
 * WHY THAT NEEDED ITS OWN FILE. `npm install` does not copy the bin; it writes a SYMLINK
 * (`node_modules/.bin/fe` -> `../@smart-tools/frontend-cli/dist/main.mjs`). Node then sets
 * `process.argv[1]` to the symlink it was invoked through, while `import.meta.url` is the
 * RESOLVED target. The entry guard at the bottom of `cli/src/main.ts` compares the two, and for
 * as long as it compared them unresolved, that comparison was false for every installed copy of
 * this package: `run()` was never called, and `fe --version` exited 0 having printed nothing at
 * all. A silent no-op, shipped, with a green suite behind it.
 *
 * The suite was green because every other integration test spawns `node <path>/dist/main.mjs`,
 * where `argv[1]` IS the real path and the guard is true by accident. The single code path a
 * user takes was the single code path nothing executed. So this file takes it: `pnpm pack`,
 * `npm install` of that tarball into a throwaway `--prefix`, and then the SYMLINK is the thing
 * spawned — never the file behind it.
 *
 * THREE THINGS KEEP IT HONEST.
 *
 * 1. It asserts the bin really is a symlink whose target differs from its own path
 *    (`the installed layout` below). If npm ever starts copying instead of linking, this test
 *    would still pass while testing nothing; the assertion turns that into a loud failure
 *    telling the next reader the apparatus, not the CLI, is what changed.
 * 2. It runs the symlink and the real path with the same argv and compares the bytes. That is
 *    the regression stated as an equation: before the fix the two differed by the whole of the
 *    output.
 * 3. `--project-report` is a REAL run over a real fixture writing a real file, not `--version`
 *    twice. A guard could in principle be wrong only for the paths that do work.
 *
 * NO NETWORK. The tarball is local and the package declares no dependencies, so `npm install`
 * is handed `--offline` — which makes "no network" an enforced property of this test rather
 * than a hope. `--ignore-scripts` for the same reason: nothing in the tarball may run here.
 * It is also NOT a global install: everything lands under one temp prefix that `afterAll`
 * removes.
 */
import { execFile } from "node:child_process";
import { cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { makeTempDir, removeTempDir } from "@smart-tools/fe-testkit";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const execFileAsync = promisify(execFile);

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtBundle = join(packageRoot, "dist", "main.mjs");
const fixtureSource = join(packageRoot, "tests", "fixtures", "plain-css");

/** The version the manifest declares — what `--version` must print, from the installed copy. */
const { version: declaredVersion } = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
) as { version: string };

/** A finished run, with the exit code as a value rather than as a thrown object. */
interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run a program and hand back its code and streams.
 *
 * `execFile` rejects on a non-zero exit, which would turn "asserts exit 2" into a `try`/`catch`
 * at every call site. The rejection carries `code`, `stdout` and `stderr`, so it is unwrapped
 * here once and every test below reads the same shape whatever the program decided.
 */
async function ran(file: string, args: readonly string[], cwd: string): Promise<Ran> {
  const options = { cwd, encoding: "utf8" as const, maxBuffer: 64 * 1024 * 1024 };
  try {
    const { stdout, stderr } = await execFileAsync(file, [...args], options);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

/** The throwaway prefix and everything under it. */
let scratch = "";
/** `<prefix>/node_modules/.bin/fe` — the symlink, and the only thing this file spawns. */
let installedBin = "";
/** Where that symlink points, i.e. the installed `dist/main.mjs`. */
let installedReal = "";
/** A private copy of the `plain-css` fixture, so a written report never lands in the worktree. */
let project = "";

beforeAll(async () => {
  scratch = makeTempDir("fe-installed-");
  const prefix = join(scratch, "prefix");
  mkdirSync(prefix);

  // Packed into the scratch directory, never into `cli/`: a failed run must not leave a tarball
  // in the working tree (`publish.integration.test.ts` makes the same call for the same reason).
  await execFileAsync("pnpm", ["pack", "--pack-destination", scratch], {
    cwd: packageRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const tarballs = readdirSync(scratch).filter((name) => name.endsWith(".tgz"));
  expect(tarballs).toHaveLength(1);
  const tarball = join(scratch, tarballs[0] as string);

  // A LOCAL install into `prefix`, exactly as a project consuming this package would do it —
  // and the shape that produces the symlink. `--offline` is what makes "no network" checked:
  // the package declares no dependencies, so there is nothing npm could legitimately fetch, and
  // if that ever changes this line fails rather than quietly reaching for a registry.
  // `cwd` is the prefix itself, so no `.npmrc` from this repo is on npm's config path.
  const install = await ran(
    "npm",
    [
      "install",
      "--prefix",
      prefix,
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarball,
    ],
    prefix,
  );
  expect(install.code, `npm install failed:\n${install.stderr}`).toBe(0);

  installedBin = join(prefix, "node_modules", ".bin", "fe");
  installedReal = join(prefix, "node_modules", "@smart-tools", "frontend-cli", "dist", "main.mjs");

  project = join(scratch, "project");
  cpSync(fixtureSource, project, { recursive: true });
}, 300_000);

afterAll(() => {
  if (scratch !== "") removeTempDir(scratch);
});

describe("the installed layout", () => {
  it("materialises `fe` as a SYMLINK, which is the whole reason this file exists", () => {
    // If this ever fails, the apparatus changed, not the CLI: npm started copying the bin and
    // every assertion below would pass while proving nothing about the symlinked case. Better a
    // failure that says so than a suite that quietly stops testing the thing it is named for.
    expect(lstatSync(installedBin).isSymbolicLink()).toBe(true);
    // ...and the two paths genuinely differ, which is the precondition the old guard tripped
    // over. `argv[1]` will be the first, `import.meta.url` the second.
    expect(installedBin).not.toBe(installedReal);
    expect(statSync(installedBin).isFile()).toBe(true);
  });

  it("installs exactly one package and one bundle — the zero-dep publish, materialised", () => {
    // The tarball's shape is `publish.integration.test.ts`'s subject; what is checked here is
    // the shape npm actually laid down on disk from it, which is the thing a user gets.
    expect(readdirSync(join(scratch, "prefix", "node_modules", "@smart-tools"))).toEqual([
      "frontend-cli",
    ]);
    expect(statSync(installedReal).size).toBe(statSync(builtBundle).size);
  });
});

describe("running the symlinked bin", () => {
  it("`--version` prints the version and exits 0", async () => {
    const result = await ran(installedBin, ["--version"], project);
    expect(result.code).toBe(0);
    // The assertion that would have caught the blocker on its own: the old guard made this an
    // empty string, and an empty string with exit 0 is what shipped.
    expect(result.stdout).toBe(`${declaredVersion}\n`);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it("`--help` prints the whole help text and exits 0", async () => {
    const result = await ran(installedBin, ["--help"], project);
    expect(result.code).toBe(0);
    // Real output, not merely non-empty: the usage line, a command the registry contributes,
    // and the version the help renders into its own title.
    expect(result.stdout).toContain("fe <");
    expect(result.stdout).toContain("--project-report");
    expect(result.stdout).toContain(declaredVersion);
    expect(result.stdout.length).toBeGreaterThan(1000);
    // Help is an answer, not an error, so it goes to stdout and stderr stays untouched — the
    // UI draws nothing at all until a command asks it to.
    expect(result.stderr).toBe("");
  });

  it("`--project-report` does the real work and writes a real report", async () => {
    const out = join(scratch, "report.html");
    const result = await ran(installedBin, ["--project-report", ".", "-o", out], project);
    expect(result.code, `stderr:\n${result.stderr}`).toBe(0);

    // The file exists and is the single self-contained page, not a stub.
    const html = readFileSync(out, "utf8");
    expect(html.startsWith("<!doctype html")).toBe(true);
    expect(html.length).toBeGreaterThan(100_000);
    // It carries this fixture's OWN findings, so the run analysed the project rather than
    // rendering an empty shell: `plain-css` is the suite's six-finding fixture, and the
    // contrast rule is one of the five errors `project-report.integration.test.ts` pins.
    expect(html).toContain("ds-data");
    expect(html).toContain("a11y.contrast.text");
    // stdout ends with the absolute path of the file it wrote — the one output shape every
    // command shares (`packages/cli-kit/src/out.ts`'s `resultOf`: a headline, then one path per
    // line). Asserted as CONTAINS here rather than as an exact last line, because what this
    // suite is about is the INSTALLED symlink working at all; the exact shape is pinned in
    // `cli/tests/project-report.integration.test.ts`.
    expect(result.stdout).toContain(out);
    // ...and the terminal UI drew its card on the other stream, where it belongs.
    expect(result.stderr).toContain("╔");
  });

  it("is byte-for-byte the same program when reached through its real path", async () => {
    // The regression, stated as an equation. Before the entry-guard fix these two differed by
    // the ENTIRE output: the real path printed the version, the symlink printed nothing.
    const viaLink = await ran(installedBin, ["--version"], project);
    const viaReal = await ran("node", [installedReal, "--version"], project);
    expect(viaLink.code).toBe(viaReal.code);
    expect(viaLink.stdout).toBe(viaReal.stdout);
  });
});
