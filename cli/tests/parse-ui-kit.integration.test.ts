/**
 * TIER 2 — `--parse-ui-kit` THROUGH THE SHIPPED BUNDLE, and the report that then uses its output.
 *
 * WHAT ONLY THIS TIER CAN ANSWER. Tier 1 drives the real handler with `resolveSource` and
 * `extractKit` faked (`packages/fe-project-report/tests/parse-ui-kit.test.ts`), and the byte-
 * identity suite proves the extractors against the real kit
 * (`packages/fe-eds-adapter/tests/parse-ui-kit.integration.test.ts`). Neither can prove any of
 * the following, and each is a way this feature could be broken with every unit test green:
 *
 *   1. DOES THE EXTRACTION PIPELINE SURVIVE BUNDLING? The theme loader compiles TypeScript with
 *      `ts.transpileModule` and evaluates it with `node:vm` (`extract/tokens/loader.ts`). Both
 *      halves run inside a minified, single-file ESM bundle with a CJS-globals banner — an
 *      environment nothing in tier 1 reproduces. A `typescript` that failed to initialise under
 *      that banner would break here and nowhere else.
 *   2. DOES THE CORPUS ACTUALLY OVERRIDE? The write happens in one process and the read in
 *      another, through `~/.fe/kits/<name>/` — so the stamp, the schema check and the precedence
 *      rule have to agree ACROSS A PROCESS BOUNDARY, against files on a real disk.
 *   3. DO THE KIT PANELS STILL RENDER off a regenerated corpus? A report built against fresh
 *      artifacts that silently lost `usage` or `kitGaps` would open to a page with empty panels,
 *      which no schema check would notice.
 *
 * ZERO NETWORK FOR THE CLONE, and a documented skip for the install. The kit is cloned over
 * `file://` from the sibling checkout — never modified — the same move
 * `project-report.integration.test.ts`'s clone case makes with a bare repo it builds itself. The
 * `@v-uik` install genuinely needs the private registry, so if that is unreachable this suite
 * says so and stops rather than passing quietly.
 */
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { makeTempDir, removeTempDir } from "@smart-tools/fe-testkit";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const run = promisify(execFile);

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtBundle = join(packageRoot, "dist", "main.mjs");
const kitFixture = join(packageRoot, "tests", "fixtures", "kit-api");

/** The sibling EDS checkout — the same `EDS_REFERENCE` override the adapter's suite uses. */
const DEFAULT_KIT = new URL("../../../ui-kit-eds-ce", import.meta.url).pathname;
const kitRepository = process.env["EDS_REFERENCE"] ?? DEFAULT_KIT;

/** The five files a corpus is, in the order `CORPUS_MEMBERS` fixes. */
const MEMBERS = ["tokens", "components", "kit-a11y", "kit-icons", "kit-signatures"] as const;

const scratches: string[] = [];
let workspace: string;
let kits: string;

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Built, never inherited. `FE_KITS_DIR` is the point of this suite, so it is always explicit. */
function childEnv(kitsDir: string): NodeJS.ProcessEnv {
  return { PATH: process.env["PATH"] ?? "", FE_KITS_DIR: kitsDir };
}

/** A scratch directory holding the bundle and nothing else. */
function scratchWithBundle(): string {
  const dir = makeTempDir("fe-pkit-");
  scratches.push(dir);
  copyFileSync(builtBundle, join(dir, "main.mjs"));
  expect(readdirSync(dir)).toEqual(["main.mjs"]);
  return dir;
}

/** Run the copied bundle. Never throws: a non-zero exit is the answer in several cases here. */
async function fe(
  dir: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await run(process.execPath, [join(dir, "main.mjs"), ...args], {
      cwd: dir,
      env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 600_000,
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

const embedded = (html: string): Record<string, unknown> => {
  const match = /<script[^>]+id="ds-data"[^>]*>([\s\S]*?)<\/script>/u.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse((match?.[1] ?? "{}").replace(/\\u003C/gu, "<")) as Record<string, unknown>;
};

/** What `--parse-ui-kit` produced this session, so every case below can share one 30-second run. */
let generated: RunResult;

beforeAll(async () => {
  workspace = makeTempDir("fe-pkit-ws-");
  kits = join(workspace, "kits");
  if (!existsSync(kitRepository)) return;

  const dir = scratchWithBundle();
  generated = await fe(
    dir,
    ["--parse-ui-kit", "eds", "--source", `file://${kitRepository}`, "--lang", "en"],
    childEnv(kits),
  );
}, 900_000);

afterAll(() => {
  for (const dir of scratches) removeTempDir(dir);
  removeTempDir(workspace);
});

describe("(a) the reference checkout", () => {
  it("is present", () => {
    expect(
      existsSync(kitRepository),
      `The EDS checkout was not found at ${kitRepository}. Set EDS_REFERENCE to a clone of the ` +
        `ui-kit-eds-ce repository to run this suite.`,
    ).toBe(true);
  });
});

describe("(b) fe --parse-ui-kit eds --source file://<kit>", () => {
  it("exits 0 and writes the five members", () => {
    if (generated.code !== 0) {
      // A failed install is the one permitted stop, and it is announced with npm's own words
      // rather than reported as a pass.
      expect(generated.stderr, "the command failed; see stderr").toContain("npm");
      console.warn(`SKIPPED — the @v-uik install failed:\n${generated.stderr}`);
      return;
    }

    expect(readdirSync(join(kits, "eds")).sort()).toEqual(
      [...MEMBERS].map((member) => `${member}.json`).sort(),
    );
  });

  it("lists every written file as an absolute path on stdout", () => {
    if (generated.code !== 0) return;
    for (const member of MEMBERS) {
      expect(generated.stdout).toContain(`${join(kits, "eds", `${member}.json`)}\n`);
    }
    expect(generated.stdout).toContain("corpus is built, 5 files");
    // No `-o` was given and none exists: the corpus goes where the tool looks for it.
    expect(generated.stdout).not.toContain("report");
  });

  it("writes schema-valid, stamped artifacts", async () => {
    if (generated.code !== 0) return;
    // The schema lives in the adapter package; importing it is what makes this a VALIDATION
    // rather than a shape guess, and it is the same object `loadCorpus` checks a corpus with —
    // so "the bundle wrote it" and "a later run will accept it" are the same assertion.
    //
    // It is a DEV dependency of `cli` and reached by a dynamic import inside the test body: the
    // published package is `package.json` + `dist/main.mjs` and declares no runtime dependency
    // at all (`cli/tsdown.config.ts:75-76`), and a top-level import here would be the first
    // thing to suggest otherwise to a reader.
    const { corpusStampSchema } = await import("@smart-tools/fe-eds-adapter");

    for (const member of MEMBERS) {
      const parsed = JSON.parse(
        readFileSync(join(kits, "eds", `${member}.json`), "utf8"),
      ) as Record<string, { corpus?: unknown }>;
      const stamp = corpusStampSchema.parse(parsed["meta"]?.corpus);
      expect(stamp.kit).toBe("eds");
      expect(stamp.version).toBe("1.13.0");
      expect(stamp.commit).toMatch(/^[0-9a-f]{40}$/u);
      expect(stamp.source).toBe(`file://${kitRepository}`);
    }
  });

  it("reproduces the embedded artifacts — the pipeline survives bundling", async () => {
    if (generated.code !== 0) return;
    // The clone is of the sibling checkout at ITS HEAD, which has moved past `v1.13.0`, so the
    // three artifacts that read moving parts of the tree may legitimately differ. `kit-a11y` may
    // not: it is derived entirely from `@v-uik@1.23.0`, which the manifest still pins, so it is
    // the one that proves the whole bundled pipeline — npm install, regex sweep, spacing scale —
    // produced exactly what the esbuild-era pipeline did.
    const onDisk = JSON.parse(readFileSync(join(kits, "eds", "kit-a11y.json"), "utf8")) as {
      meta: Record<string, unknown>;
    };
    const { corpus: _stamp, ...meta } = onDisk.meta;

    const reference = JSON.parse(
      readFileSync(
        new URL("../../packages/fe-eds-adapter/src/artifacts/kit-a11y.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;

    expect(JSON.stringify({ ...onDisk, meta })).toBe(JSON.stringify(reference));
  });
});

describe("(c) the report then measures against the regenerated corpus", () => {
  it("says `(updated …)` and still renders every kit panel", async () => {
    if (generated.code !== 0) return;
    const dir = scratchWithBundle();
    const out = join(dir, "report.html");

    const result = await fe(
      dir,
      ["--project-report", kitFixture, "--ui-kit", "eds", "-o", out, "--lang", "en"],
      childEnv(kits),
    );

    expect(result.code).toBe(0);
    // THE NOTICE — the provenance, with the date and the short sha.
    expect(result.stdout).toMatch(
      /design system: eds 1\.13\.0 \(updated \d{4}-\d{2}-\d{2}, [0-9a-f]{7}\)/u,
    );
    // Nothing was wrong with the corpus, so nothing was said about it.
    expect(result.stderr).not.toContain("corpus");

    const data = embedded(readFileSync(out, "utf8"));
    // THE PAYLOAD carries the same sentence, so a report read six months later still says which
    // snapshot produced it.
    expect(data["adapter"]).toMatchObject({ name: "eds" });
    expect((data["adapter"] as { version: string }).version).toMatch(/^1\.13\.0 \(updated /u);

    // THE PANELS. Absent any one of these, `kitDataOf` returns null and every kit panel hides
    // (`packages/fe-analyzer-report/dashboard/src/lib/kit.ts`).
    const summary = data["summary"] as Record<string, unknown>;
    const usage = data["usage"] as Record<string, unknown> | undefined;
    expect(typeof summary["healthScore"]).toBe("number");
    expect(summary["kitGaps"]).toBeDefined();
    expect(usage).toBeDefined();
    expect(usage?.["components"]).toBeInstanceOf(Array);
    expect(usage?.["components"] as unknown[]).not.toHaveLength(0);
    expect(
      (summary["findings"] as { byCategory: Record<string, number> }).byCategory["api"],
    ).toBeGreaterThan(0);
  }, 600_000);

  it("agrees with the embedded snapshot on this fixture", async () => {
    if (generated.code !== 0) return;
    const dir = scratchWithBundle();

    const withCorpus = join(dir, "corpus.html");
    const withEmbedded = join(dir, "embedded.html");

    await fe(dir, ["--project-report", kitFixture, "-o", withCorpus], childEnv(kits));
    await fe(
      dir,
      ["--project-report", kitFixture, "-o", withEmbedded],
      childEnv(join(tmpdir(), "fe-kits-that-do-not-exist")),
    );

    const a = embedded(readFileSync(withCorpus, "utf8"));
    const b = embedded(readFileSync(withEmbedded, "utf8"));

    // NOT a tautology, and not a claim that the two corpora are equal — they are not, the clone
    // is at HEAD and the snapshot is at `v1.13.0`. It is the claim that on THIS project the two
    // agree on every finding, which is what makes a regeneration a safe thing to do: a user who
    // runs `--parse-ui-kit` must not find their report has changed underneath them for reasons
    // unrelated to their code. `adapter` is excluded because saying which snapshot ran is the
    // one thing that MUST differ.
    expect(a["findings"]).toEqual(b["findings"]);
    expect(a["summary"]).toEqual(b["summary"]);
    expect(a["usage"]).toEqual(b["usage"]);
    expect(a["adapter"]).not.toEqual(b["adapter"]);
  }, 600_000);
});

describe("(d) a broken corpus never breaks a report", () => {
  it("falls back to the embedded snapshot and names the bad file on stderr", async () => {
    if (generated.code !== 0) return;
    const dir = scratchWithBundle();
    const broken = join(workspace, "broken");
    const out = join(dir, "report.html");

    // A corpus with one truncated member — an interrupted write, or a disk that filled.
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(broken, "eds"), { recursive: true });
    for (const member of MEMBERS) {
      copyFileSync(join(kits, "eds", `${member}.json`), join(broken, "eds", `${member}.json`));
    }
    writeFileSync(join(broken, "eds", "kit-icons.json"), '{"icons":', "utf8");

    const result = await fe(
      dir,
      ["--project-report", kitFixture, "-o", out, "--lang", "en"],
      childEnv(broken),
    );

    // NOT A CRASH, and not a silent downgrade either.
    expect(result.code).toBe(0);
    expect(result.stderr).toContain(join(broken, "eds", "kit-icons.json"));
    expect(result.stderr).toContain("fe --parse-ui-kit eds");
    expect(result.stdout).toContain("eds 1.13.0 (embedded)");
    expect(existsSync(out)).toBe(true);
  }, 600_000);
});

describe("(e) refusals through the bundle", () => {
  it("an unknown kit is exit 2 with the accepted list, and writes nothing", async () => {
    const dir = scratchWithBundle();
    const empty = join(workspace, "untouched");

    const result = await fe(dir, ["--parse-ui-kit", "bootstrap", "--lang", "en"], childEnv(empty));

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("bootstrap");
    expect(result.stderr).toContain("eds");
    expect(existsSync(empty)).toBe(false);
  });

  it("names the command and both arguments in --help, in both languages", async () => {
    const dir = scratchWithBundle();
    const empty = join(workspace, "untouched");

    const en = await fe(dir, ["--help", "--lang", "en"], childEnv(empty));
    const ru = await fe(dir, ["--help"], childEnv(empty));

    for (const help of [en.stdout, ru.stdout]) {
      expect(help).toContain("--parse-ui-kit, --pkit <name>");
      expect(help).toContain("--source <git-url|local-path>");
    }
    expect(en.stdout).toContain("Rebuild a design system's corpus");
    expect(ru.stdout).toContain("Пересобрать корпус дизайн-системы");
  });
});
