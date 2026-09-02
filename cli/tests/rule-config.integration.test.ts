/**
 * TIER 2 — `fg.config.json`, `--format` and `--init-config` THROUGH THE SHIPPED BUNDLE.
 *
 * NEVER part of `pnpm test`; run on demand with `pnpm test:integration`. The filename suffix is
 * the whole mechanism (`cli/vite.config.ts:42,62`).
 *
 * WHAT ONLY THIS TIER CAN ANSWER. The tier-1 suites
 * (`packages/fg-project-report/tests/rule-config.test.ts`, `tests/init-config.test.ts`) drive the
 * real handlers with the three expensive seams faked, so they prove the precedence, the refusals
 * and the level algebra. They cannot prove any of the following, and each is a way this feature
 * could be broken while every unit test stayed green:
 *
 *   1. Does the CONFIG REACH A REAL SCAN? Tier 1 hands the engine a canned result, so "the
 *      summary is computed over the visible set" is asserted against a constant. Here the real
 *      analyzer runs over a real fixture and the numbers come back changed by the file.
 *   2. Does `--format` SURVIVE BUNDLING with a clean stdout? `@smart-tools/fg-lint-format` is
 *      inlined into the single `dist/fg.mjs`, and the card, the notice, the progress bar and
 *      the warnings all share the process. A pipe is the only place to see whether stdout really
 *      carries the formatter document and nothing else.
 *   3. Does `--init-config` produce a file the SAME BUNDLE then accepts? The generator and the
 *      loader are two modules that could drift; a round trip through the disk is the only proof
 *      that what one writes the other reads.
 *
 * The two fixtures are the ones `project-report.integration.test.ts` already uses, for the reason
 * its header gives: they are verbatim copies, so this suite depends on no other package's test
 * tree. `plain-css` finds six a11y findings (five errors, one warning) and `kit-api` is the
 * design-system project, whose findings include the `component.*` family this suite filters on.
 */
import { execFile } from "node:child_process";
import { copyFileSync, cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { makeTempDir, nodeModulesAbove, removeTempDir } from "@smart-tools/fg-testkit";
import { afterEach, describe, expect, it } from "vite-plus/test";

const run = promisify(execFile);

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtBundle = join(packageRoot, "dist", "fg.mjs");
const plainCss = join(packageRoot, "tests", "fixtures", "plain-css");
const kitApi = join(packageRoot, "tests", "fixtures", "kit-api");

const CONFIG = "fg.config.json";
const SCHEMA = "fg.config.schema.json";

/** `plain-css`, unfiltered: six findings, five of them errors — `project-report`'s own numbers. */
const UNFILTERED_TOTAL = 6;
const UNFILTERED_ERRORS = 5;

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The child's environment is BUILT, never inherited — `project-report.integration.test.ts:136`. */
function childEnv(extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env["PATH"] ?? "",
    FG_KITS_DIR: join(tmpdir(), "fg-kits-that-do-not-exist"),
    ...extra,
  };
}

const scratches: string[] = [];

afterEach(() => {
  for (const dir of scratches.splice(0)) removeTempDir(dir);
});

/** A scratch directory holding the bundle and NOTHING else. Both halves are asserted. */
function scratchWithBundle(): string {
  const dir = makeTempDir("fg-ruleconfig-");
  scratches.push(dir);
  copyFileSync(builtBundle, join(dir, "fg.mjs"));
  expect(readdirSync(dir)).toEqual(["fg.mjs"]);
  expect(nodeModulesAbove(dir)).toEqual([]);
  return dir;
}

/** Run the copied bundle. Never throws: a non-zero exit is the ANSWER in most cases here. */
async function fg(dir: string, args: readonly string[], env = childEnv()): Promise<RunResult> {
  try {
    const { stdout, stderr } = await run(process.execPath, [join(dir, "fg.mjs"), ...args], {
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

interface ConfigDocument {
  $schema: string;
  analyzer: {
    uiKit?: string;
    default: string;
    categories: Record<string, string>;
    rules: Record<string, string>;
  };
}

const readConfig = (path: string): ConfigDocument =>
  JSON.parse(readFileSync(path, "utf8")) as ConfigDocument;

const writeConfig = (path: string, document: ConfigDocument): void => {
  writeFileSync(path, JSON.stringify(document, null, 2), "utf8");
};

/** The `ds-data` slot's payload, lifted back out of a written report. */
interface Payload {
  readonly summary: { readonly findings: { readonly total: number } };
  readonly findings: readonly { readonly rule: string }[];
  readonly ruleConfig: {
    readonly default: string;
    readonly rules: Readonly<Record<string, string>>;
    readonly source: { readonly kind: string; readonly path?: string };
  };
  readonly ruleCatalog: readonly { readonly id: string; readonly subrules: readonly unknown[] }[];
}

function embedded(html: string): Payload {
  const match = /<script type="application\/json" id="ds-data">([\S\s]*?)<\/script>/u.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse((match?.[1] ?? "{}").replace(/\\u003C/gu, "<")) as Payload;
}

/**
 * Every rule id a compact document names, in order.
 *
 * The grammar is `ux-design.md` §2.4's, not the old `file, line N, col M` one: a finding row
 * opens with `line:col` and CLOSES with the rule id, which is the one field on the row a test
 * can key on without restating the formatter's column arithmetic.
 */
const compactRules = (stdout: string): readonly string[] =>
  stdout
    .split("\n")
    .filter((line) => /^\s*\d+:\d+\s/u.test(line))
    .map((line) => line.trimEnd().split(/\s+/u).at(-1) ?? "");

// ── (a) --init-config, then the file it wrote driving a real scan ──────────────────────────

describe("(a) --init-config writes a file this same bundle then obeys", () => {
  it("writes both documents, refuses to overwrite, and names both absolutely", async () => {
    const dir = scratchWithBundle();

    const first = await fg(dir, ["--init-config"]);
    expect(first.code).toBe(0);
    const configPath = join(dir, CONFIG);
    const schemaPath = join(dir, SCHEMA);
    expect(first.stdout.trimEnd().split("\n").slice(-2)).toEqual([configPath, schemaPath]);
    expect(readdirSync(dir).toSorted()).toEqual([CONFIG, SCHEMA, "fg.mjs"]);

    // The generated file lists the engine's eleven rules and `a11y.lint`'s thirty sub-rules —
    // this directory declares no design system, so the kit rules are correctly absent.
    const document = readConfig(configPath);
    const keys = Object.keys(document.analyzer.rules);
    expect(keys.filter((key) => !key.includes("/"))).toHaveLength(11);
    expect(keys.filter((key) => key.startsWith("a11y.lint/"))).toHaveLength(30);
    expect(document.$schema).toBe(`./${SCHEMA}`);
    expect(Object.keys(document.analyzer.categories)).toHaveLength(8);

    // A SECOND run must not destroy the hand-edited work the first one made possible.
    const stamp = readFileSync(configPath, "utf8");
    const again = await fg(dir, ["--iconf"]);
    expect(again.code).toBe(2);
    expect(again.stderr).toContain(configPath);
    expect(readFileSync(configPath, "utf8")).toBe(stamp);
  });

  it("--ui-kit eds lists the 32 kit ids and the 30 sub-rules", async () => {
    const dir = scratchWithBundle();
    expect((await fg(dir, ["--init-config", "--ui-kit", "eds"])).code).toBe(0);

    const document = readConfig(join(dir, CONFIG));
    expect(document.analyzer.uiKit).toBe("eds");
    const keys = Object.keys(document.analyzer.rules);
    expect(keys.filter((key) => !key.includes("/"))).toHaveLength(32);
    expect(keys.filter((key) => key.startsWith("a11y.lint/"))).toHaveLength(30);
    expect(keys).toHaveLength(62);

    // The schema documents every one of them, and stays open for dot-prefixes.
    const schema = JSON.parse(readFileSync(join(dir, SCHEMA), "utf8")) as {
      properties: {
        analyzer: {
          properties: {
            rules: { properties: Record<string, unknown>; additionalProperties: unknown };
          };
        };
      };
    };
    expect(Object.keys(schema.properties.analyzer.properties.rules.properties)).toEqual(keys);
    expect(schema.properties.analyzer.properties.rules.additionalProperties).not.toBe(false);
  });

  /**
   * THE OWNER'S SENTENCE, end to end: "leave only <one category> and see 0 other crap in the
   * dashboard AND the console" (`rc-design.md:8-10`).
   *
   * TWO DEVIATIONS FROM THE DESIGN'S ILLUSTRATION, both forced and both real:
   *
   *  1. `component` rather than `icon`: neither shipped fixture produces an icon finding.
   *     `kit-api` is the project with a design system, and what it produces beside the a11y and
   *     api families is `component.*`. The mechanism under test is identical.
   *  2. `rules` is EMPTIED. `--init-config` writes the full inventory — every rule id at its
   *     built-in level (design §7.3) — and a rule row beats a category, which beats `default`
   *     (design D7). So on a generated file, changing `default` and one category alone changes
   *     nothing: every rule is still named explicitly. Clearing `rules` is what makes the
   *     category layer the one in force, and it is exactly the recipe the README documents.
   *     This case is therefore the proof that the two halves of the file compose the way D7
   *     says, not just that a filter exists.
   */
  it("default: off + one category on leaves ONLY that category's findings, and exit 0", async () => {
    const dir = scratchWithBundle();
    const project = join(dir, "project");
    cpSync(kitApi, project, { recursive: true });

    expect((await fg(dir, ["--init-config", "--ui-kit", "eds"])).code).toBe(0);
    const configPath = join(dir, CONFIG);
    const document = readConfig(configPath);
    document.analyzer.default = "off";
    // REPLACED, not spread: the generated file lists all eight categories at `on`, so keeping
    // them would leave everything visible and the case would pass vacuously.
    document.analyzer.categories = { component: "on" };
    document.analyzer.rules = {};
    writeConfig(configPath, document);

    const before = await fg(dir, ["--preport", project, "--format", "compact"]);
    // Every rule the document names belongs to the category left on — and there IS output, so
    // this is a filter rather than an empty run passing vacuously.
    const rules = compactRules(before.stdout);
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule.startsWith("component.")).toBe(true);
    // `component.*` carries no error severity, so U2's gate is open.
    expect(before.code).toBe(0);
    expect(before.stdout).not.toContain("error");

    // THE OTHER HALF of the owner's sentence: the same file drives the DASHBOARD's default view.
    const report = await fg(dir, ["--preport", project, "-o", join(dir, "r.html")]);
    expect(report.code).toBe(0);
    const payload = embedded(readFileSync(join(dir, "r.html"), "utf8"));
    expect(payload.ruleConfig.default).toBe("off");
    expect(payload.summary.findings.total).toBe(rules.length);
    // …over a payload that still carries every raw finding, so the reader can switch a category
    // back on without re-running anything (D11).
    expect(payload.findings.length).toBeGreaterThan(rules.length);
  });
});

// ── (b) --lint: the exit code, and a stdout nothing else writes to ─────────────────────────

describe("(b) --format over a real scan", () => {
  it("compact,html: the document on stdout, the report on disk, exit 1 on a visible error", async () => {
    const dir = scratchWithBundle();
    const result = await fg(dir, ["--preport", plainCss, "--format", "compact,html"]);

    expect(result.code).toBe(1);
    const lines = result.stdout.trimEnd().split("\n");
    expect(compactRules(result.stdout)).toHaveLength(UNFILTERED_TOTAL);
    expect(lines.filter((line) => line.includes(", col , ")).length).toBe(0);
    // The footer (§2.4) ends the document; the ONE line after it is the written report's
    // absolute path, which is the only other thing U3 allows on stdout.
    expect(lines.at(-1)).toBe(join(dir, "fg-out", "report.html"));
    expect(lines.at(-2)).toMatch(/^[✖▲✔]/u);
    expect(result.stdout).not.toContain("отчёт готов");
    expect(result.stdout).not.toContain("дизайн-система");
    expect(result.stdout).not.toContain("");
    // …while the block and the design-system sentence are both still SAID, on the UI's stream.
    expect(result.stderr).toContain("отчёт готов");
    expect(result.stderr).toContain("дизайн-система");
    // Both documents came out of ONE analysis, and the html is the whole report.
    expect(readFileSync(join(dir, "fg-out", "report.html"), "utf8").length).toBeGreaterThan(
      500_000,
    );
    expect(result.stderr).toContain("запись");
  });

  it("a config that hides everything turns the same run into exit 0 with no output", async () => {
    const dir = scratchWithBundle();
    writeFileSync(
      join(dir, CONFIG),
      JSON.stringify({ analyzer: { default: "off" } }, null, 2),
      "utf8",
    );

    const result = await fg(dir, ["--preport", plainCss, "--format", "compact"]);
    // CHANGED BY §2.4: a clean run prints the ONE green line rather than nothing at all.
    expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(result.stdout).toMatch(/^✔/u);
    expect(result.code).toBe(0);
    // The config that did it is named while the run happens (§2.6's note), and the count it
    // hid is in the compact footer (§2.4).
    expect(result.stderr).toContain(join(dir, CONFIG));
    expect(result.stdout).toContain(`скрыто конфигом: ${String(UNFILTERED_TOTAL)}`);
  });

  it("re-grading every error to a warning opens the gate without hiding anything", async () => {
    const dir = scratchWithBundle();
    writeFileSync(
      join(dir, CONFIG),
      JSON.stringify({ analyzer: { categories: { a11y: "warning" } } }, null, 2),
      "utf8",
    );

    const result = await fg(dir, ["--preport", plainCss, "--format", "compact"]);
    expect(result.code).toBe(0);
    expect(compactRules(result.stdout)).toHaveLength(UNFILTERED_TOTAL);
    expect(result.stdout).not.toContain("error");
  });

  it("--format sarif is a parseable SARIF 2.1.0 log naming this tool and its rules", async () => {
    const dir = scratchWithBundle();
    const result = await fg(dir, ["--preport", plainCss, "--format", "sarif"]);

    expect(result.code).toBe(1);
    // A FILE now (U9): sarif is a document for an IDE or a CI job, and stdout carries its
    // absolute path so a script names the file rather than holding its bytes.
    expect(result.stdout).toBe(`${join(dir, "fg-out", "report.sarif")}\n`);
    const log = JSON.parse(readFileSync(join(dir, "fg-out", "report.sarif"), "utf8")) as {
      version: string;
      runs: {
        tool: { driver: { name: string; version: string; rules: { id: string }[] } };
        results: { ruleId: string; level: string }[];
      }[];
    };
    expect(log.version).toBe("2.1.0");
    const driver = log.runs[0]?.tool.driver;
    expect(driver?.name).toBe("fg");
    // The build-time version substitution reached the bundle: `0.0.0-dev` would mean the
    // `define` was lost (`packages/fg-project-report/src/version.ts`).
    expect(driver?.version).not.toBe("0.0.0-dev");
    // The whole CATALOG is published, not just the rules that fired.
    expect(driver?.rules).toHaveLength(11);
    expect(log.runs[0]?.results).toHaveLength(UNFILTERED_TOTAL);
    expect(log.runs[0]?.results.filter((r) => r.level === "error")).toHaveLength(UNFILTERED_ERRORS);
  });

  it("--format json is a parseable ESLint result array", async () => {
    const dir = scratchWithBundle();
    const result = await fg(dir, ["--preport", plainCss, "--format", "json"]);
    expect(result.stdout).toBe(`${join(dir, "fg-out", "report.json")}\n`);
    const files = JSON.parse(readFileSync(join(dir, "fg-out", "report.json"), "utf8")) as {
      filePath: string;
      messages: unknown[];
    }[];
    expect(files.map((file) => file.filePath.split("/").at(-1)).toSorted()).toEqual([
      "App.tsx",
      "app.css",
    ]);
    expect(files.flatMap((file) => file.messages)).toHaveLength(UNFILTERED_TOTAL);
  });
});

// ── (c) the report the same run writes ─────────────────────────────────────────────────────

describe("(c) the html carries the config as the dashboard's default view", () => {
  it("embeds the file's config and catalog, counts the summary over the visible set", async () => {
    const dir = scratchWithBundle();
    const configPath = join(dir, CONFIG);
    writeFileSync(
      configPath,
      JSON.stringify({ analyzer: { rules: { "a11y.contrast.text": "off" } } }, null, 2),
      "utf8",
    );

    const result = await fg(dir, ["--preport", plainCss, "-o", join(dir, "r.html")]);
    // The errors survive this config, so U2 still closes the gate on an html-only run.
    expect(result.code).toBe(1);

    const payload = embedded(readFileSync(join(dir, "r.html"), "utf8"));
    expect(payload.ruleConfig.source).toEqual({ kind: "file", path: configPath });
    expect(payload.ruleConfig.rules).toEqual({ "a11y.contrast.text": "off" });
    // D10: the summary is the VISIBLE set…
    expect(payload.summary.findings.total).toBe(UNFILTERED_TOTAL - 1);
    // …and D11: every RAW finding still travels, so the reader can switch the rule back on.
    expect(payload.findings).toHaveLength(UNFILTERED_TOTAL);
    expect(payload.findings.filter((f) => f.rule === "a11y.contrast.text")).toHaveLength(1);
    // The catalog the panel draws from: eleven rules, one of them with thirty sub-rules.
    expect(payload.ruleCatalog).toHaveLength(11);
    expect(payload.ruleCatalog.find((entry) => entry.id === "a11y.lint")?.subrules).toHaveLength(
      30,
    );
  });

  it("embeds the defaults, and says nothing about a config, when there is no file", async () => {
    const dir = scratchWithBundle();
    const result = await fg(dir, ["--preport", plainCss, "-o", join(dir, "r.html")]);
    expect(result.code).toBe(1);
    // Design §5: the `скрыто` row exists only when a file was in force or something was
    // hidden. Neither is true here, so the block does not carry the word at all — the line
    // «конфиг: по умолчанию — … скрыто 0» printed on every run was news to nobody.
    expect(result.stderr).not.toContain("конфиг");
    expect(result.stderr).not.toContain("скрыто");
    const payload = embedded(readFileSync(join(dir, "r.html"), "utf8"));
    expect(payload.ruleConfig.source).toEqual({ kind: "defaults" });
    expect(payload.summary.findings.total).toBe(UNFILTERED_TOTAL);
  });

  it("--config beats a file in the project and one in the cwd", async () => {
    const dir = scratchWithBundle();
    const project = join(dir, "project");
    cpSync(plainCss, project, { recursive: true });
    const explicit = join(dir, "chosen.json");

    writeFileSync(explicit, JSON.stringify({ analyzer: { default: "off" } }), "utf8");
    writeFileSync(join(project, CONFIG), JSON.stringify({ analyzer: { default: "info" } }), "utf8");
    writeFileSync(join(dir, CONFIG), JSON.stringify({ analyzer: { default: "warning" } }), "utf8");

    const result = await fg(dir, [
      "--preport",
      project,
      "--config",
      "chosen.json",
      "--format",
      "compact",
    ]);
    expect(result.code).toBe(0);
    // §2.4: everything hidden ⇒ the ONE green line, not silence.
    expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(result.stderr).toContain(explicit);
  });

  it("without --config the analysed project's own file beats the cwd's", async () => {
    const dir = scratchWithBundle();
    const project = join(dir, "project");
    cpSync(plainCss, project, { recursive: true });
    writeFileSync(join(project, CONFIG), JSON.stringify({ analyzer: { default: "off" } }), "utf8");
    writeFileSync(join(dir, CONFIG), JSON.stringify({ analyzer: { default: "on" } }), "utf8");

    const result = await fg(dir, ["--preport", project, "--format", "compact"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(result.stderr).toContain(join(project, CONFIG));
  });
});

// ── (d) the refusals, in both languages ────────────────────────────────────────────────────

describe("(d) usage errors are exit 2, localized, and cost no scan", () => {
  it("--lint is not a flag anywhere any more (U1)", async () => {
    const dir = scratchWithBundle();
    const result = await fg(dir, ["--preport", plainCss, "--lint"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--lint");
    expect(readdirSync(dir)).toEqual(["fg.mjs"]);
  });

  it("an unknown --format names every accepted value, before any scan", async () => {
    const dir = scratchWithBundle();
    const result = await fg(dir, ["--preport", plainCss, "--format", "checkstyle"]);
    expect(result.code).toBe(2);
    // `stylish` is GONE and `html` has joined (U1) — the four the command declares.
    for (const value of ["html", "compact", "json", "sarif"]) {
      expect(result.stderr).toContain(value);
    }
    expect(result.stderr).not.toContain("stylish");
    // The refusal quotes the command's own usage line (§2.6), and nothing was scanned.
    expect(result.stderr).toContain("fg --preport");
    expect(readdirSync(dir)).toEqual(["fg.mjs"]);
  });

  it("--format is refused on a command that does not take it", async () => {
    const dir = scratchWithBundle();
    const result = await fg(dir, ["--iconf", "--format", "json"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--format");
    expect(readdirSync(dir)).toEqual(["fg.mjs"]);
  });

  it("-o with compact alone is refused: there is nothing to write (U9)", async () => {
    const dir = scratchWithBundle();
    const result = await fg(dir, [
      "--preport",
      plainCss,
      "--format",
      "compact",
      "-o",
      join(dir, "x.txt"),
    ]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("compact");
    expect(readdirSync(dir)).toEqual(["fg.mjs"]);
  });

  it("a --config that is not there, in English too", async () => {
    const dir = scratchWithBundle();
    const ru = await fg(dir, ["--preport", plainCss, "--config", "missing.json"]);
    expect(ru.code).toBe(2);
    expect(ru.stderr).toContain(join(dir, "missing.json"));
    expect(ru.stderr).toMatch(/[А-Яа-яЁё]/u);

    const en = await fg(dir, ["--lang", "en", "--preport", plainCss, "--config", "missing.json"]);
    expect(en.code).toBe(2);
    expect(en.stderr).not.toMatch(/[А-Яа-яЁё]/u);
  });

  it("a malformed config in the cwd, before anything is scanned", async () => {
    const dir = scratchWithBundle();
    writeFileSync(join(dir, CONFIG), '{ "analyzer": { "default": "loud" } }', "utf8");
    const result = await fg(dir, ["--preport", plainCss]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("analyzer.default");
    expect(result.stderr).toContain("candidate");
    expect(readdirSync(dir).toSorted()).toEqual([CONFIG, "fg.mjs"]);
  });

  it("an unknown rule id is a WARNING: the run finishes and the report is written", async () => {
    const dir = scratchWithBundle();
    writeFileSync(
      join(dir, CONFIG),
      JSON.stringify({ analyzer: { rules: { "token.literal.color": "off", "a11y.nope": "off" } } }),
      "utf8",
    );
    const result = await fg(dir, ["--preport", plainCss]);
    expect(result.code).toBe(1);
    // Both unknown keys are listed, on the UI's stream, in one line.
    expect(result.stderr).toContain("token.literal.color");
    expect(result.stderr).toContain("a11y.nope");
    expect(readFileSync(join(dir, "fg-out", "report.html"), "utf8").length).toBeGreaterThan(
      500_000,
    );
  });
});

// ── (e) the surface, in both languages ─────────────────────────────────────────────────────

/**
 * REWRITTEN FOR THE UX REDESIGN. The main page is a TABLE now (design 2.7): the short alias, a
 * one-line summary and the `без -o →` column. The long spelling and every argument's full
 * signature moved to `fg --help --<command>` (design 2.8), so each is asserted on the page that
 * owns it.
 */
describe("(e) --help documents the new command and the new arguments", () => {
  for (const lang of ["ru", "en"] as const) {
    it(`lists --iconf in the table and its full signature on its own page (${lang})`, async () => {
      const dir = scratchWithBundle();
      const result = await fg(dir, ["--lang", lang, "--help"]);
      expect(result.code).toBe(0);
      expect(result.stdout.split("\n").some((l) => l.trimStart().startsWith("--iconf"))).toBe(true);

      const page = await fg(dir, ["--lang", lang, "--help", "--iconf"]);
      expect(page.code).toBe(0);
      // §2.8: ONE elided usage line under 100 columns, the long spelling on the line below it,
      // and the placeholder in the page's own language (V5 findings #5, #8 and #12).
      expect(page.stdout.split("\n")[0]).toBe(
        lang === "ru"
          ? "fg --iconf [-o <файл>] [--ui-kit …]"
          : "fg --iconf [-o <file>] [--ui-kit …]",
      );
      expect(page.stdout.split("\n")[1]).toBe(
        `  ${lang === "ru" ? "также:" : "also:"} --init-config`,
      );

      const report = await fg(dir, ["--lang", lang, "--help", "--preport"]);
      expect(report.code).toBe(0);
      const usage = report.stdout.split("\n")[0] ?? "";
      expect(usage).toContain(lang === "ru" ? "[--config …]" : "[--config …]");
      // U1: `--lint` is off the surface. `--format`'s four values are NOT in the usage line any
      // more — §2.8 elides them there and the help TABLE is where they are spelled out, which is
      // the same `ArgSpec.name` the parser reads them from (V5 finding #5).
      expect(usage).not.toContain("--lint");
      expect(usage).toContain("[--format …]");
      expect(usage).not.toContain("html|compact|json|sarif");
      expect([...usage].length).toBeLessThanOrEqual(100);
      const table = await fg(dir, ["--lang", lang, "--help"]);
      expect(table.stdout).toContain("--format html|compact|json|sarif");
    });
  }
});
