/**
 * TIER 2 — `--project-report` THROUGH THE SHIPPED BUNDLE (brief B4 deliverable 4).
 *
 * NEVER part of `pnpm test`; run on demand with `pnpm test:integration`. The filename suffix is
 * the whole mechanism (`cli/vite.config.ts:42,62`).
 *
 * WHAT ONLY THIS TIER CAN ANSWER. Tier 1 drives the real handler with the three seams faked
 * (`packages/fe-project-report/tests/command.test.ts`), so it proves the flow and the strings.
 * It cannot prove any of the following, and each is a way the feature could be broken while
 * every unit test stayed green:
 *
 *   1. Does the ANALYZER survive bundling? ts-morph, typescript, eslint, jsx-a11y and postcss
 *      are CJS packages that `require()` builtins and read `__filename` at module init. The
 *      recipe that makes that work is two lines of `cli/tsdown.config.ts` (external `jiti` +
 *      the CJS-globals banner), and a bundle missing either dies at import — from a bare
 *      directory, where there is no `node_modules` to fall back on.
 *   2. Does the TEMPLATE survive it? The report is a 990 KB string inlined at build time
 *      (`packages/fe-analyzer-report/scripts/embed-template.mjs`). A minifier that mangled the
 *      `ds-data` slot would produce a file that opens to a blank page.
 *   3. Does the CLONE PATH work? `fe-source` shells out to the system `git`
 *      (`packages/fe-source/src/resolve.ts:189`). A subprocess has no injection seam for that;
 *      substituting the URL with a `file://` bare repo the test builds itself is the only way
 *      in, and it is zero-network by construction.
 *
 * THE EXPECTED FINDINGS ARE B2's, NOT MINE. `tests/fixtures/plain-css` is a verbatim copy of
 * `packages/fe-analyzer-engine/tests/fixtures/plain-css`, and the counts asserted below are the
 * ones that package's own suite asserts and its report tabulates
 * (`WORKFLOW/features/hackathon-analys/reports/b2-analyzer-engine.md:152`). Copied rather than
 * imported by path: this suite must keep working against the SHIPPED bundle, and reaching into
 * another package's test tree would make the cli's proof depend on that tree's layout.
 */
import { execFile } from "node:child_process";
import { copyFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { makeTempDir, nodeModulesAbove, removeTempDir } from "@smart-tools/fe-testkit";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

const run = promisify(execFile);

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtBundle = join(packageRoot, "dist", "main.mjs");
const fixture = join(packageRoot, "tests", "fixtures", "plain-css");

/** 20 MB, the cap design h4 agreed for the guard (`h4-design.md:87`). */
const SIZE_CAP_BYTES = 20 * 1024 * 1024;

/**
 * What a run of `--project-report` over `tests/fixtures/plain-css` must find.
 *
 * Written literally, for the reason `bundle.integration.test.ts:72-76` gives about the command
 * surface: a test that derived the expectation from the engine could not notice the engine
 * losing a rule. Six findings across the two files, five errors and one warning.
 */
const EXPECTED_BY_RULE: Readonly<Record<string, number>> = {
  "a11y.lint": 1,
  "a11y.name.missing": 2,
  "a11y.aria.invalid": 1,
  "a11y.focus.suppressed": 1,
  "a11y.contrast.text": 1,
};
const EXPECTED_TOTAL = 6;
const EXPECTED_ERRORS = 5;
const EXPECTED_WARNINGS = 1;
const EXPECTED_FILES_SCANNED = 2;

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The child's environment is BUILT, never inherited — `bundle.integration.test.ts:90-99`. */
function childEnv(extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  return { PATH: process.env["PATH"] ?? "", ...extra };
}

const scratches: string[] = [];

/** A scratch directory holding the bundle and NOTHING else. Both halves are asserted. */
function scratchWithBundle(): string {
  const dir = makeTempDir("fe-preport-");
  scratches.push(dir);
  copyFileSync(builtBundle, join(dir, "main.mjs"));
  expect(readdirSync(dir)).toEqual(["main.mjs"]);
  // Nothing to resolve an un-inlined import against, anywhere above it.
  expect(nodeModulesAbove(dir)).toEqual([]);
  return dir;
}

/** Run the copied bundle. Never throws: a non-zero exit is the ANSWER in several cases here. */
async function fe(dir: string, args: readonly string[], env = childEnv()): Promise<RunResult> {
  try {
    const { stdout, stderr } = await run(process.execPath, [join(dir, "main.mjs"), ...args], {
      cwd: dir,
      env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === "number" ? failure.code : -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

/** The JSON the dashboard boots from, lifted back out of a written report. */
interface Payload {
  readonly project: { readonly name: string | null; readonly root: string };
  readonly summary: {
    readonly files: { readonly scanned: number; readonly clean: number };
    readonly findings: {
      readonly total: number;
      readonly bySeverity: Readonly<Record<string, number>>;
      readonly byRule: Readonly<Record<string, number>>;
      readonly byCategory: Readonly<Record<string, number>>;
    };
  };
  readonly findings: readonly { readonly rule: string; readonly file: string }[];
  readonly ruleDescriptions: Readonly<Record<string, string>>;
}

function embedded(html: string): Payload {
  // The slot's exact spelling is the renderer's (`packages/fe-analyzer-report/src/render.ts:26`).
  const match = /<script type="application\/json" id="ds-data">([\S\s]*?)<\/script>/u.exec(html);
  expect(match).not.toBeNull();
  // `<` is escaped as `<` on the way in so a snippet cannot close the script element.
  return JSON.parse((match?.[1] ?? "{}").replace(/\\u003C/gu, "<")) as Payload;
}

/**
 * Assert a written report is the one this fixture must produce.
 *
 * Shared by the local-path case and the clone case ON PURPOSE: the two paths differ only in
 * how the directory was acquired, so anything the clone changes about the ANALYSIS is a bug,
 * and one function used twice is how that is stated.
 */
function assertFixtureReport(html: string, expectedName: string): Payload {
  expect(html.startsWith("<!doctype html>")).toBe(true);

  // SELF-CONTAINED: opening the file must fetch nothing. The check is on the ATTRIBUTES that
  // would cause a request rather than on the substring `http`, because the build legitimately
  // carries inert `http(s)` text — W3C namespaces, a React error link, library credits
  // (`WORKFLOW/features/hackathon-analys/reports/b3-analyzer-report.md:223-226`).
  expect(html).not.toMatch(/<(?:script|link|img|iframe)[^>]+(?:src|href)="https?:\/\//iu);
  expect(html).not.toMatch(/@import\s+(?:url\()?["']https?:\/\//iu);

  const data = embedded(html);
  expect(data.summary.findings.byRule).toEqual(EXPECTED_BY_RULE);
  expect(data.summary.findings.total).toBe(EXPECTED_TOTAL);
  expect(data.summary.findings.bySeverity["error"]).toBe(EXPECTED_ERRORS);
  expect(data.summary.findings.bySeverity["warning"]).toBe(EXPECTED_WARNINGS);
  expect(data.summary.files.scanned).toBe(EXPECTED_FILES_SCANNED);
  expect(data.findings).toHaveLength(EXPECTED_TOTAL);
  // Both fixture files are represented, with POSIX project-relative paths on every platform.
  expect([...new Set(data.findings.map((f) => f.file))].sort()).toEqual([
    "src/App.tsx",
    "src/app.css",
  ]);
  // The eight-key category block — the B2/B3 reconciliation, seen from the far end of the
  // pipeline (`packages/fe-analyzer-report/src/payload.ts`, `EngineFindingCounts`).
  expect(Object.keys(data.summary.findings.byCategory).sort()).toEqual([
    "a11y",
    "api",
    "component",
    "font",
    "icon",
    "override",
    "token",
    "typography",
  ]);
  expect(data.summary.findings.byCategory["a11y"]).toBe(EXPECTED_TOTAL);
  // All eleven ported rules are described, not just the five that fired: the report's
  // "what was checked" panel is about coverage, and coverage includes the silent rules.
  expect(Object.keys(data.ruleDescriptions)).toHaveLength(11);
  expect(data.project.name).toBe(expectedName);
  return data;
}

/** Everything `fe-source` could have left behind, by its own default temp prefix. */
const cloneLeftovers = (): readonly string[] =>
  readdirSync(tmpdir()).filter((name) => name.startsWith("fe-source-"));

beforeAll(() => {
  // A stale or missing build would produce failures that look like product defects.
  expect(readdirSync(join(packageRoot, "dist"))).toEqual(["main.mjs"]);
});

afterEach(() => {
  while (scratches.length > 0) removeTempDir(scratches.pop() as string);
});

// ── (a) a local fixture path, through the bundle ──────────────────────────────────────────

describe("(a) --project-report <local fixture> -o report.html", () => {
  it("exits 0, writes a self-contained report, and the payload holds B2's counts", async () => {
    const dir = scratchWithBundle();
    const out = join(dir, "report.html");

    const result = await fe(dir, ["--project-report", fixture, "-o", out]);

    // Findings are the PRODUCT: a project full of violations is a successful run.
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    assertFixtureReport(readFileSync(out, "utf8"), fixture);
  });

  it("prints ONE localized summary line carrying the counts, ru by default", async () => {
    const dir = scratchWithBundle();
    const out = join(dir, "report.html");
    const result = await fe(dir, ["--project-report", fixture, "-o", out]);

    expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(result.stdout).toMatch(/[А-Яа-яЁё]/u);
    expect(result.stdout).toContain(String(EXPECTED_TOTAL));
    expect(result.stdout).toContain(String(EXPECTED_FILES_SCANNED));
    expect(result.stdout).toContain(out);
  });

  it("--lang en says the same thing in English, and the report is identical", async () => {
    const dir = scratchWithBundle();
    const ruOut = join(dir, "ru.html");
    const enOut = join(dir, "en.html");

    const ru = await fe(dir, ["--project-report", fixture, "-o", ruOut]);
    const en = await fe(dir, ["--lang", "en", "--project-report", fixture, "-o", enOut]);

    expect(en.code).toBe(0);
    expect(en.stdout).not.toMatch(/[А-Яа-яЁё]/u);
    expect(en.stdout).not.toBe(ru.stdout);
    // The REPORT is not localized in v1 (h4-design.md:73-76) — only the CLI surface is. The
    // two payloads must therefore agree on everything but the generation timestamp.
    const a = embedded(readFileSync(ruOut, "utf8"));
    const b = embedded(readFileSync(enOut, "utf8"));
    expect(b.summary).toEqual(a.summary);
    expect(b.findings).toEqual(a.findings);
  });

  it("the alias --preport runs the same command", async () => {
    const dir = scratchWithBundle();
    const out = join(dir, "report.html");
    const result = await fe(dir, ["--preport", fixture, "-o", out]);
    expect(result.code).toBe(0);
    assertFixtureReport(readFileSync(out, "utf8"), fixture);
  });

  it("creates missing parent directories for -o", async () => {
    const dir = scratchWithBundle();
    const out = join(dir, "deep", "deeper", "report.html");
    expect((await fe(dir, ["--project-report", fixture, "-o", out])).code).toBe(0);
    expect(readFileSync(out, "utf8").length).toBeGreaterThan(500_000);
  });
});

// ── (b) the same, acquired by cloning a local bare repo over file:// ───────────────────────

describe("(b) --project-report file://<bare repo> — the fe-source clone path", () => {
  /**
   * A REAL repository, built here, served over `file://`. Zero network.
   *
   * Identity and signing are pinned per-invocation with `-c` so a developer's own
   * `~/.gitconfig` — no `user.email`, or `commit.gpgsign` on — cannot turn this suite red for
   * a reason that has nothing to do with the product. B1's own fixture does the same
   * (`packages/fe-source/tests/fixtures/scratch.ts:38-48`).
   */
  async function bareRepoOf(source: string): Promise<{ url: string; dir: string }> {
    const dir = makeTempDir("fe-preport-origin-");
    scratches.push(dir);
    const bare = join(dir, "origin.git");
    const work = join(dir, "work");
    const git = (args: readonly string[], cwd: string) =>
      run(
        "git",
        [
          "-c",
          "user.name=fe test",
          "-c",
          "user.email=fe@test.invalid",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        { cwd, encoding: "utf8" },
      );

    await git(["init", "--bare", "--initial-branch=main", bare], dir);
    await git(["clone", bare, work], dir);
    await run("cp", ["-R", `${source}/.`, work], { encoding: "utf8" });
    await git(["add", "-A"], work);
    await git(["commit", "-m", "fixture"], work);
    await git(["push", "origin", "HEAD:refs/heads/main"], work);
    return { url: pathToFileURL(bare).href, dir: bare };
  }

  it("clones, analyses the clone, and produces the SAME report as the local path", async () => {
    const dir = scratchWithBundle();
    const origin = await bareRepoOf(fixture);
    const out = join(dir, "report.html");
    const before = cloneLeftovers();

    const result = await fe(dir, ["--project-report", origin.url, "-o", out]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    // The report NAMES the repository, not the temp directory it briefly lived in — the
    // sidebar prints `name ?? root` (`dashboard/src/App.tsx:142-143`).
    const data = assertFixtureReport(readFileSync(out, "utf8"), origin.url);
    // …and the root it records IS the temp clone, which is how we know a clone happened.
    expect(data.project.root).not.toBe(fixture);
    expect(data.project.root).toContain("fe-source-");

    // THE CLEANUP, VERIFIED RATHER THAN ASSUMED. `fe-source` removes its clone in a `finally`;
    // a leaked directory would be sitting in the temp root under its own prefix, so the set of
    // such directories cannot have grown across this run.
    expect(cloneLeftovers().filter((name) => !before.includes(name))).toEqual([]);
  });

  it("a repository URL that does not resolve fails localized, exit 1, and leaves nothing", async () => {
    const dir = scratchWithBundle();
    const missing = pathToFileURL(join(dir, "no-such-repo.git")).href;
    const before = cloneLeftovers();

    const result = await fe(dir, ["--project-report", missing, "-o", join(dir, "r.html")]);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/[А-Яа-яЁё]/u);
    // The clone directory is removed on the failure path too
    // (`packages/fe-source/src/resolve.ts:190-198`).
    expect(cloneLeftovers().filter((name) => !before.includes(name))).toEqual([]);
  });
});

// ── (c) the CLI surface: help, usage refusal, runtime refusal ──────────────────────────────

describe("(c) the surface, in both languages", () => {
  it("--help lists --project-report and --preport, in ru", async () => {
    const dir = scratchWithBundle();
    const result = await fe(dir, ["--help"]);
    expect(result.code).toBe(0);
    const line = result.stdout.split("\n").find((l) => l.includes("--project-report"));
    expect(line).toBeDefined();
    expect(line).toContain("--preport");
    expect(result.stdout).toContain("команды:");
  });

  it("--help --lang en lists them too, on an English page", async () => {
    const dir = scratchWithBundle();
    const result = await fe(dir, ["--lang", "en", "--help"]);
    expect(result.code).toBe(0);
    const line = result.stdout.split("\n").find((l) => l.includes("--project-report"));
    expect(line).toBeDefined();
    expect(line).toContain("--preport");
    expect(result.stdout).toContain("commands:");
    expect(result.stdout).not.toMatch(/[А-Яа-яЁё]/u);
  });

  for (const [lang, args, cyrillic] of [
    ["ru", [] as string[], true],
    ["en", ["--lang", "en"], false],
  ] as const) {
    it(`missing -o is exit 2 with a localized refusal (${lang}), and nothing is analysed`, async () => {
      const dir = scratchWithBundle();
      const result = await fe(dir, [...args, "--project-report", fixture]);
      expect(result.code).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toBe("");
      expect(/[А-Яа-яЁё]/u.test(result.stderr)).toBe(cyrillic);
      // It names the fix, not just the absence.
      expect(result.stderr).toContain("-o");
      expect(readdirSync(dir)).toEqual(["main.mjs"]);
    });

    it(`a nonexistent path is exit 1 with a localized message (${lang})`, async () => {
      const dir = scratchWithBundle();
      const result = await fe(dir, [
        ...args,
        "--project-report",
        join(dir, "not-a-project"),
        "-o",
        join(dir, "r.html"),
      ]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(/[А-Яа-яЁё]/u.test(result.stderr)).toBe(cyrillic);
      // The offending path is quoted back, so the user can see the typo.
      expect(result.stderr).toContain("not-a-project");
      expect(readdirSync(dir)).toEqual(["main.mjs"]);
    });
  }

  it("a file instead of a directory is refused before any analysis", async () => {
    const dir = scratchWithBundle();
    const result = await fe(dir, [
      "--project-report",
      join(dir, "main.mjs"),
      "-o",
      join(dir, "r.html"),
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/[А-Яа-яЁё]/u);
  });
});

// ── (d) the size guard ────────────────────────────────────────────────────────────────────

describe("(d) the bundle's size", () => {
  it(`dist/main.mjs is at most ${String(SIZE_CAP_BYTES / 1024 / 1024)} MB`, () => {
    const bytes = readFileSync(builtBundle).length;
    // A regression here means something large was inlined that should not have been — the
    // failure names the number so the next reader can judge it (h4-design.md:85-87).
    expect(bytes, `dist/main.mjs is ${String(bytes)} bytes`).toBeLessThanOrEqual(SIZE_CAP_BYTES);
    // And a floor: a bundle that suddenly lost the analyzer would pass a cap-only check.
    expect(bytes).toBeGreaterThan(8 * 1024 * 1024);
  });
});
