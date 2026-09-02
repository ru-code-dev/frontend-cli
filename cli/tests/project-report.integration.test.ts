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
/**
 * The kit project: X2's `kit-api` parity fixture, copied verbatim (`diff -r` clean).
 *
 * Copied rather than reached for across packages, for the reason the header gives about
 * `plain-css`: this suite proves things about the SHIPPED bundle, and depending on another
 * package's test-tree layout would make that proof depend on that tree. It declares
 * `@sds-eng/base` and `@v-uik/base`, so it is both the autodetect subject and the project the
 * adapter's rules were ported against.
 */
const kitFixture = join(packageRoot, "tests", "fixtures", "kit-api");

/**
 * THE SIZE GUARD, RAISED DELIBERATELY IN X3 — and the floor raised with it.
 *
 * B4 measured ~15.3 MiB against design h4's 20 MiB cap (`h4-design.md:87`). X3 wires
 * `@smart-tools/fe-eds-adapter` in as a STATIC import, so that package's `dist` — 5.6 MB, of
 * which 4.1 MB is the design system's extracted artifacts — is inlined into this one file.
 * Measured after the change: **~19.1 MiB**. That is still under the old cap, by ~4 %, which is
 * not headroom — it is a tripwire the next dashboard edit would set off for no reason anyone
 * could act on.
 *
 * So the cap moves to 25 MiB: about 25 % over the measured size, the same proportion h4's 20
 * MiB gave B4's 15.31 MiB. It is raised HERE, once, in the number the test names in its own
 * title, so raising it is a diff a reviewer sees rather than a constant that drifts.
 *
 * E2a RE-MEASURED AND LEFT THE BAND ALONE, which is a decision rather than an omission. That
 * delivery inlines a whole extraction pipeline into the adapter — five ported extractors, their
 * Zod schemas, and a TypeScript-plus-`node:vm` theme loader. The bundle went from ~19.12 MiB to
 * ~19.18 MiB: about 66 KB, or a third of one per cent. It is that small because the expensive
 * dependencies were ALREADY here — `typescript` and `ts-morph` arrived with the analyzer
 * (`cli/tsdown.config.ts:257,260`), and the loader was written against them precisely so that
 * `--parse-ui-kit` would cost the bundle almost nothing. esbuild, the alternative, could not
 * have been inlined at any size: it is a native binary.
 *
 * A 66 KB move does not justify touching a band chosen with 25 % headroom, and moving a cap
 * that was not under pressure would spend the headroom for nothing. The measurement is recorded;
 * the numbers are unchanged.
 *
 * The FLOOR moves from 8 MiB to 18 MiB for the same reason it exists at all: a cap-only check
 * passes a bundle that quietly lost something. 8 MiB could no longer notice the adapter going
 * missing (the analyzer alone is 16 MB); 18 MiB fails the moment it does.
 *
 * NO EXACT BYTE COUNT IS RECORDED HERE, deliberately. An earlier revision of this comment wrote
 * one out to the byte, and it went stale within the same delivery — a dependency bump or a
 * dashboard edit moves it by a few kilobytes while changing nothing anyone needs to know. The
 * band is the thing that is stable and the band is what is asserted; the live number is printed
 * by the assertion message below (`dist/main.mjs is N bytes`), which is where a reader who
 * actually wants today's figure should get it, from today's build rather than from prose.
 */
const SIZE_CAP_BYTES = 25 * 1024 * 1024;
const SIZE_FLOOR_BYTES = 18 * 1024 * 1024;

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

/**
 * The child's environment is BUILT, never inherited — `bundle.integration.test.ts:90-99`.
 *
 * `FE_KITS_DIR` is pinned at a path that does not exist, and that is not tidiness. Without it
 * the adapter consults the real `~/.fe/kits/eds/` (`packages/fe-eds-adapter/src/corpus.ts`), so
 * every assertion below about `eds 1.13.0 (embedded)` and about the fixture's finding counts
 * would quietly measure against whatever corpus the machine happens to hold — passing on CI and
 * failing for the one developer who has run `fe --parse-ui-kit eds`. Pointing it at nothing is
 * how these cases stay about the BUNDLE rather than about the box.
 * `parse-ui-kit.integration.test.ts` is where a populated corpus is exercised, deliberately.
 */
function childEnv(extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env["PATH"] ?? "",
    FE_KITS_DIR: join(tmpdir(), "fe-kits-that-do-not-exist"),
    ...extra,
  };
}

/**
 * WHAT `stderr` CARRIES NOW: the terminal UI, and nothing but.
 *
 * These runs are `execFile` children, so neither stream is a TTY — which puts the UI in its
 * plain lane (`packages/cli-kit/src/ui.ts`): one line per phase, then the final card, with NOT
 * ONE escape sequence and no carriage return in the whole of it. That is the property these
 * cases used to state as `stderr === ""`, restated for a CLI that now says what it is doing:
 * the report is still the only artefact, stdout still carries exactly its two lines, and a
 * piped `2>` log is still readable text.
 *
 * `✗` is asserted absent as well, because a card marking a failed phase on a run that exited 0
 * would be a contradiction no other assertion here would catch.
 */
function expectQuietUi(stderr: string): void {
  expect(stderr).not.toContain("\u001b");
  expect(stderr).not.toContain("\r");
  expect(stderr).toContain("  > fe\n");
  expect(stderr).toContain("\u2713 ");
  expect(stderr).not.toContain("\u2717");
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
  readonly adapter: { readonly name: string; readonly version: string } | null;
  readonly summary: {
    readonly files: { readonly scanned: number; readonly clean: number };
    readonly findings: {
      readonly total: number;
      readonly bySeverity: Readonly<Record<string, number>>;
      readonly byRule: Readonly<Record<string, number>>;
      readonly byCategory: Readonly<Record<string, number>>;
    };
    readonly healthScore?: number;
    readonly kitGaps?: readonly unknown[];
  };
  readonly usage?: {
    readonly components: readonly { readonly name: string }[];
    readonly unusedComponents: readonly string[];
    readonly customComponents: readonly { readonly name: string; readonly snippetHtml: string }[];
    readonly elementBreakdown: Readonly<Record<string, number>>;
  };
  readonly findings: readonly { readonly rule: string; readonly file: string }[];
  readonly ruleDescriptions: Readonly<Record<string, string>>;
}

/** The `ds-data` slot's raw text, before `JSON.parse` — the subject of the byte assertions. */
function embeddedText(html: string): string {
  // The slot's exact spelling is the renderer's (`packages/fe-analyzer-report/src/render.ts:26`).
  const match = /<script type="application\/json" id="ds-data">([\S\s]*?)<\/script>/u.exec(html);
  expect(match).not.toBeNull();
  return match?.[1] ?? "{}";
}

function embedded(html: string): Payload {
  // `<` is escaped on the way in so a snippet cannot close the script element.
  return JSON.parse(embeddedText(html).replace(/\\u003C/gu, "<")) as Payload;
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
  // X3: this fixture depends on no design system, so the report says so — and carries nothing
  // else an adapter would have added.
  expect(data.adapter).toBeNull();
  expect(data.usage).toBeUndefined();
  expect(Object.keys(data.summary)).toEqual(["files", "findings", "positives", "limitations"]);
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
    expectQuietUi(result.stderr);
    assertFixtureReport(readFileSync(out, "utf8"), fixture);
  });

  /**
   * CHANGED IN E2b: THREE lines, not two. The path used to be spliced into the counts sentence;
   * it is now a result line of its own, which is the one output shape every command in this
   * repo ends with (`packages/cli-kit/src/out.ts`'s `resultOf`).
   */
  it("prints THREE localized lines — design system, counts, then the absolute path", async () => {
    const dir = scratchWithBundle();
    const out = join(dir, "report.html");
    const result = await fe(dir, ["--project-report", fixture, "-o", out]);

    const lines = result.stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    // X3's notice, first: this project matched no adapter, and the run says so rather than
    // leaving a reader to wonder why the kit panels are missing.
    expect(lines[0]).toContain("--ui-kit");
    expect(lines[0]).toMatch(/[А-Яа-яЁё]/u);
    expect(lines[1]).toMatch(/[А-Яа-яЁё]/u);
    expect(lines[1]).toContain(String(EXPECTED_TOTAL));
    expect(lines[1]).toContain(String(EXPECTED_FILES_SCANNED));
    // The last line is the path and NOTHING else, so `| tail -1` is a usable idiom.
    expect(lines[2]).toBe(out);
  });

  /**
   * THE OWNER'S LAW, end to end and from a bare directory: no `-o`, and the report appears at
   * `./fe-out/report.html` beside the bundle with the card and stdout naming it absolutely.
   * This invocation used to be an exit-2 refusal.
   */
  it("with NO -o it writes ./fe-out/report.html and prints the absolute path", async () => {
    const dir = scratchWithBundle();
    const result = await fe(dir, ["--project-report", fixture]);

    expect(result.code).toBe(0);
    expectQuietUi(result.stderr);

    const written = join(dir, "fe-out", "report.html");
    // The directory did not exist when the run started — `fe-out/` is created on demand.
    assertFixtureReport(readFileSync(written, "utf8"), fixture);
    expect(result.stdout.trimEnd().split("\n").at(-1)).toBe(written);
    // The final card names the same absolute path, on stderr, inside the box.
    expect(result.stderr).toContain(written.slice(0, 40));
    expect(readdirSync(dir).sort()).toEqual(["fe-out", "main.mjs"]);
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
    expectQuietUi(result.stderr);
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
    /**
     * CHANGED IN E2b. This case used to assert `exit 2` and a refusal naming `-o`. The refusal
     * is gone with the owner's law; what replaces it is the same invocation SUCCEEDING into the
     * documented default, in this language, with the path on stdout.
     */
    it(`missing -o writes the default and names it (${lang}), rather than refusing`, async () => {
      const dir = scratchWithBundle();
      const result = await fe(dir, [...args, "--project-report", fixture]);
      expect(result.code).toBe(0);
      const written = join(dir, "fe-out", "report.html");
      expect(result.stdout.trimEnd().split("\n").at(-1)).toBe(written);
      expect(/[А-Яа-яЁё]/u.test(result.stdout)).toBe(cyrillic);
      expect(readdirSync(dir).sort()).toEqual(["fe-out", "main.mjs"]);
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
    // And a floor: a bundle that suddenly lost the analyzer or the adapter would pass a
    // cap-only check.
    expect(bytes, `dist/main.mjs is ${String(bytes)} bytes`).toBeGreaterThan(SIZE_FLOOR_BYTES);
  });
});

// ── (e) THE DESIGN-SYSTEM ADAPTER, through the bundle (brief X3 deliverable 6) ─────────────

/**
 * Kit-rule ids that must appear in a report of `kit-api`.
 *
 * Written literally, like `EXPECTED_BY_RULE` and for the same reason: derived from the adapter,
 * this list could not notice the adapter losing a rule family. One id per family the fixture
 * exercises — imports, the do-not-use marker, prop variants, deprecation, and the kit-gated
 * keyboard rule that is the one a11y check an adapter-less run cannot make.
 */
const EXPECTED_KIT_RULES: readonly string[] = [
  "import.bypass",
  "import.internal",
  "api.dnu",
  "prop.invalid",
  "api.deprecated",
  "a11y.pattern.keyboard",
  "component.custom",
];

/** Every adapter-domain field the restored dashboard panels read out of a payload. */
function assertKitReport(html: string): Payload {
  const data = embedded(html);

  // THE STAMP — the design system's version AND which snapshot produced it. `childEnv` pins
  // `FE_KITS_DIR` at nothing, so these runs are always the embedded one; the `(updated …)` form
  // is asserted in `parse-ui-kit.integration.test.ts`, which writes a corpus first.
  expect(data.adapter).toEqual({ name: "eds", version: "1.13.0 (embedded)" });

  // THE FINDINGS the adapter contributes — the reason the panels have anything to show.
  for (const rule of EXPECTED_KIT_RULES) {
    expect(Object.keys(data.summary.findings.byRule)).toContain(rule);
  }
  // Categories only an adapter rule can emit are non-zero, so the eight-key block is no longer
  // seven zeros and an `a11y` count.
  expect(data.summary.findings.byCategory["api"]).toBeGreaterThan(0);
  expect(data.summary.findings.byCategory["component"]).toBeGreaterThan(0);
  // The registry the report documents is the connected one: 11 generic + 16 adapter rule
  // functions, minus the one the adapter takes over (`component.duplicate`).
  expect(Object.keys(data.ruleDescriptions).length).toBeGreaterThan(11);
  expect(Object.keys(data.ruleDescriptions)).toContain("a11y.pattern.keyboard");

  // WHAT THE RESTORED PANELS READ. Absent any one of these, `kitDataOf` returns null and every
  // one of them stays hidden (`packages/fe-analyzer-report/dashboard/src/lib/kit.ts`).
  expect(typeof data.summary.healthScore).toBe("number");
  expect(data.summary.kitGaps).toBeDefined();
  expect(data.usage).toBeDefined();
  expect(data.usage?.components.length).toBeGreaterThan(0);
  expect(data.usage?.unusedComponents.length).toBeGreaterThan(0);
  expect(data.usage?.elementBreakdown["total"]).toBeGreaterThan(0);
  // The one field the RENDERER owns rather than the engine.
  for (const component of data.usage?.customComponents ?? []) {
    expect(component.snippetHtml).toContain('<pre class="shiki">');
  }
  return data;
}

describe("(e) a project that uses a design system", () => {
  it("--ui-kit eds: the adapter's rules run and the kit panels' data is in the payload", async () => {
    const dir = scratchWithBundle();
    const out = join(dir, "report.html");

    const result = await fe(dir, ["--project-report", kitFixture, "--ui-kit", "eds", "-o", out]);

    expect(result.code).toBe(0);
    expectQuietUi(result.stderr);
    assertKitReport(readFileSync(out, "utf8"));
  });

  it("AUTODETECT: the same report, with nobody typing --ui-kit", async () => {
    const dir = scratchWithBundle();
    const flagged = join(dir, "flagged.html");
    const detected = join(dir, "detected.html");

    await fe(dir, ["--project-report", kitFixture, "--ui-kit", "eds", "-o", flagged]);
    const auto = await fe(dir, ["--project-report", kitFixture, "-o", detected]);

    expect(auto.code).toBe(0);
    const data = assertKitReport(readFileSync(detected, "utf8"));

    // Not merely "also worked": the two payloads must agree on everything but the timestamp,
    // because detecting the design system and being told it must select the SAME adapter.
    const flaggedData = embedded(readFileSync(flagged, "utf8"));
    expect(data.summary).toEqual(flaggedData.summary);
    expect(data.usage).toEqual(flaggedData.usage);
    expect(data.findings).toEqual(flaggedData.findings);
    expect(data.adapter).toEqual(flaggedData.adapter);
  });

  it("says WHICH design system it used, and how it decided, in both languages", async () => {
    const dir = scratchWithBundle();

    const ru = await fe(dir, ["--project-report", kitFixture, "-o", join(dir, "ru.html")]);
    const en = await fe(dir, [
      "--lang",
      "en",
      "--project-report",
      kitFixture,
      "--ui-kit",
      "eds",
      "-o",
      join(dir, "en.html"),
    ]);

    const [ruNotice] = ru.stdout.trimEnd().split("\n");
    const [enNotice] = en.stdout.trimEnd().split("\n");
    expect(ruNotice).toContain("eds");
    expect(ruNotice).toMatch(/[А-Яа-яЁё]/u);
    expect(enNotice).toContain("eds");
    expect(enNotice).not.toMatch(/[А-Яа-яЁё]/u);
    // "detected" and "selected with the flag" are different sentences, not one sentence twice.
    expect(enNotice).toContain("--ui-kit");
    expect(ruNotice).not.toBe(enNotice);
  });

  it("--ui-kit none on the SAME project falls back to exactly the generic run", async () => {
    const dir = scratchWithBundle();
    const out = join(dir, "report.html");

    const result = await fe(dir, ["--project-report", kitFixture, "--ui-kit", "none", "-o", out]);

    expect(result.code).toBe(0);
    const data = embedded(readFileSync(out, "utf8"));
    // The manifest WOULD have matched: `none` is what stopped it, and the result is the
    // adapter-less shape down to the last key.
    expect(data.adapter).toBeNull();
    expect(data.usage).toBeUndefined();
    expect(Object.keys(data.summary)).toEqual(["files", "findings", "positives", "limitations"]);
    expect(Object.keys(data.ruleDescriptions)).toHaveLength(11);
    for (const rule of EXPECTED_KIT_RULES) {
      expect(Object.keys(data.summary.findings.byRule)).not.toContain(rule);
    }
  });

  it("an unknown --ui-kit is a usage error: exit 2, localized, nothing written", async () => {
    for (const lang of ["ru", "en"] as const) {
      const dir = scratchWithBundle();
      const result = await fe(dir, [
        "--lang",
        lang,
        "--project-report",
        kitFixture,
        "--ui-kit",
        "bogus",
        "-o",
        join(dir, "r.html"),
      ]);

      expect(result.code).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("bogus");
      // The refusal teaches the surface: every accepted spelling is in it.
      expect(result.stderr).toContain("eds");
      expect(result.stderr).toContain("none");
      expect(/[А-Яа-яЁё]/u.test(result.stderr)).toBe(lang === "ru");
      // Nothing was resolved, scanned or written.
      expect(readdirSync(dir)).toEqual(["main.mjs"]);
    }
  });
});

// ── (f) the no-adapter payload is what it always was, plus one field ───────────────────────

describe("(f) an unmatched project gets today's behaviour, byte for byte", () => {
  it('the embedded payload differs from the pre-X3 one by `"adapter":null,` and nothing else', async () => {
    const dir = scratchWithBundle();
    const out = join(dir, "report.html");

    await fe(dir, ["--project-report", fixture, "-o", out]);
    const raw = embeddedText(readFileSync(out, "utf8"));

    // The one addition, spelled exactly as the renderer's compact `JSON.stringify` writes it.
    expect(raw).toContain('"adapter":null,');

    // Remove those bytes and what is left must contain no trace of X3: not the stamp, not the
    // `usage` block, not one of the five kit summary fields. This is the assertion the brief
    // asks for stated as bytes rather than as a deep-equal, because "and nothing else" is a
    // claim about the text and two objects built by the same code would agree either way.
    const preX3 = raw.replace('"adapter":null,', "");
    expect(preX3).not.toContain("adapter");
    for (const key of [
      "usage",
      "healthScore",
      "healthFormula",
      "adoption",
      "tokenCoverage",
      "kitGaps",
    ]) {
      expect(preX3).not.toContain(`"${key}"`);
    }

    // And the key ORDER — a byte-level property `JSON.parse` preserves — is the pre-X3 one
    // with `adapter` inserted after `generatedAt`, which is where the contract declares it.
    const data = JSON.parse(preX3.replace(/\\u003C/gu, "<")) as Payload;
    expect(Object.keys(data)).toEqual([
      "project",
      "generatedAt",
      "diff",
      "iconPreviews",
      "summary",
      "findings",
      "ruleDescriptions",
    ]);
    // Everything B4 pinned about this fixture still holds, unchanged.
    assertFixtureReport(readFileSync(out, "utf8"), fixture);
  });
});
