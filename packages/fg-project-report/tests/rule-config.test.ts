/**
 * TIER 1 — `fg.config.json` discovery, its refusals, and `--format`.
 *
 * The loader is driven over REAL files in a scratch tree, because discovery is a statement about
 * the filesystem — "the project's root beats the cwd" cannot be checked against a fake that
 * decides which path exists. Everything expensive stays faked, exactly as `command.test.ts` does
 * it: `resolveSource` hands back a directory this suite created, `analyzeProject` returns
 * {@link ENGINE_RESULT}, and `renderReport` returns a string. What is real is the whole of the
 * decision-making: precedence, validation, the level algebra applied to the findings, the config
 * line, the formatter's text on stdout and the exit code.
 *
 * THE CATALOG ASSERTION LIVES HERE and nowhere else, closing the item A1 carried as UNVERIFIED
 * (`WORKFLOW/features/rule-config/reports/a1-engine-rule-config.md:9.1`): the engine cannot
 * import the EDS adapter without a dependency cycle, and this package depends on both.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AnalyzerResult, RuleCatalogEntry } from "@smart-tools/fg-analyzer-engine";
import { ruleCatalog } from "@smart-tools/fg-analyzer-engine";
import type { ReportPayload } from "@smart-tools/fg-analyzer-report";
import { createEdsAdapter } from "@smart-tools/fg-eds-adapter";
import { formatLint } from "@smart-tools/fg-lint-format";
import type { ResolvedSource } from "@smart-tools/fg-source";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { ReportCounts } from "../src/index.ts";
import {
  configDocumentOf,
  createProjectReportCommands,
  defaultReportPath,
  discoverConfig,
  FILE_LEVELS,
  findingsRow,
  hiddenRow,
  INHERIT_LEVEL,
  parseConfig,
  REPORT_FORMATS,
  rowKeys,
  serialise,
  unknownFormat,
  unknownRuleIds,
} from "../src/index.ts";
import { capture, ENGINE_RESULT, scratch, text } from "./harness.ts";

const HTML = "<!doctype html><html><body>report</body></html>";

/** Two scratch trees: one plays the analysed project, one plays the invocation's cwd. */
let projectDir = "";
let cwdDir = "";
let removeProject: () => Promise<void> = () => Promise.resolve();
let removeCwd: () => Promise<void> = () => Promise.resolve();

beforeEach(async () => {
  ({ dir: projectDir, remove: removeProject } = await scratch());
  ({ dir: cwdDir, remove: removeCwd } = await scratch());
});

afterEach(async () => {
  await removeProject();
  await removeCwd();
});

const write = async (dir: string, name: string, body: unknown): Promise<string> => {
  const path = join(dir, name);
  await writeFile(path, typeof body === "string" ? body : JSON.stringify(body), "utf8");
  return path;
};

const CONFIG = "fg.config.json";

/** The last payload the fake renderer saw — how the embedded config is inspected. */
interface Rendered {
  payloads: ReportPayload[];
}

function commandOver(rendered: Rendered, result: AnalyzerResult = ENGINE_RESULT) {
  const commands = createProjectReportCommands({
    resolveSource: (): Promise<ResolvedSource> =>
      Promise.resolve({ kind: "local", dir: projectDir, cleanup: () => Promise.resolve() }),
    analyzeProject: () => Promise.resolve(result),
    renderReport: (payload) => {
      rendered.payloads.push(payload);
      return HTML;
    },
  });
  return commands[0] as (typeof commands)[number];
}

const fresh = (): Rendered => ({ payloads: [] });

/**
 * What the command puts on stdout for the compact document.
 *
 * The formatter does not end its document with a newline and the command adds one only when it
 * is missing (`src/command.ts`) — so a caller reading the stream never has to guess whether the
 * last line is terminated, and no formatter ever produces a blank line.
 */
const withNewline = (body: string): string => (body.endsWith("\n") ? body : `${body}\n`);

/**
 * The two §2.3 rows a config case is actually about, as the block renders them.
 *
 * `findings` is the tally the config let through and `hidden` is what it removed together with
 * the file that removed it — the pair that replaced the old one-line `configLine`.
 */
const rowsFor = (counts: {
  errors: number;
  warnings: number;
  info?: number;
  candidates?: number;
  suppressed: number;
  path: string | null;
}): { findings: string; hidden: string } => {
  const full: ReportCounts = {
    files: 9,
    cleanFiles: 7,
    errors: counts.errors,
    warnings: counts.warnings,
    info: counts.info ?? 0,
    candidates: counts.candidates ?? 0,
    suppressed: counts.suppressed,
    configPath: counts.path,
  };
  return {
    findings: `${rowKeys.findings.ru}=${findingsRow(full).ru}`,
    hidden: `${rowKeys.hidden.ru}=${hiddenRow(full).ru}`,
  };
};

/* ── discovery: --config > project root > cwd > defaults (D2) ─────────────────────────────── */

describe("discovery precedence (D2)", () => {
  it("prefers --config over both implicit locations", async () => {
    const explicit = await write(cwdDir, "custom.json", {
      analyzer: { rules: { "a11y.name.missing": "off" } },
    });
    await write(projectDir, CONFIG, { analyzer: { rules: { "a11y.name.missing": "info" } } });
    await write(cwdDir, CONFIG, { analyzer: { rules: { "a11y.name.missing": "warning" } } });

    const outcome = await discoverConfig({
      explicit: "custom.json",
      projectRoot: projectDir,
      cwd: cwdDir,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.loaded.path).toBe(explicit);
    expect(outcome.loaded.config.rules).toEqual({ "a11y.name.missing": "off" });
    expect(outcome.loaded.config.source).toEqual({ kind: "file", path: explicit });
  });

  it("prefers the analysed project's root over the cwd", async () => {
    const root = await write(projectDir, CONFIG, {
      analyzer: { rules: { "a11y.name.missing": "info" } },
    });
    await write(cwdDir, CONFIG, { analyzer: { rules: { "a11y.name.missing": "warning" } } });

    const outcome = await discoverConfig({ projectRoot: projectDir, cwd: cwdDir });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.loaded.path).toBe(root);
    expect(outcome.loaded.config.rules).toEqual({ "a11y.name.missing": "info" });
  });

  it("falls back to the cwd when the project has none", async () => {
    const own = await write(cwdDir, CONFIG, { analyzer: { default: "off" } });
    const outcome = await discoverConfig({ projectRoot: projectDir, cwd: cwdDir });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.loaded.path).toBe(own);
    expect(outcome.loaded.config.default).toBe("off");
  });

  it("falls back to the built-in defaults when nowhere has one", async () => {
    const outcome = await discoverConfig({ projectRoot: projectDir, cwd: cwdDir });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.loaded.path).toBeNull();
    expect(outcome.loaded.config).toEqual({
      default: "on",
      categories: {},
      rules: {},
      source: { kind: "defaults" },
    });
  });

  it("a --config that is not there is an error, unlike a missing implicit one", async () => {
    const outcome = await discoverConfig({ explicit: "nope.json", cwd: cwdDir });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // The path is quoted ABSOLUTELY, so a user who typed a relative path is told which one it
    // resolved to rather than being handed their own string back.
    expect(outcome.message.ru).toContain(join(cwdDir, "nope.json"));
    expect(outcome.message.en).toContain(join(cwdDir, "nope.json"));
  });

  it("a config that exists but cannot be read is an error, never a silent fallback", async () => {
    // A DIRECTORY where the file should be: `readFile` fails with EISDIR, not ENOENT.
    await mkdir(join(projectDir, CONFIG));
    const outcome = await discoverConfig({ projectRoot: projectDir, cwd: cwdDir });
    expect(outcome.ok).toBe(false);
  });
});

/* ── validation: malformed is exit 2, unknown ids are a warning (D8) ──────────────────────── */

describe("validation (D8)", () => {
  const refusals: readonly { readonly name: string; readonly body: unknown }[] = [
    { name: "not JSON at all", body: "{ oops" },
    { name: "a JSON array rather than an object", body: [] },
    { name: "an analyzer that is not an object", body: { analyzer: 7 } },
    { name: "an unknown key inside analyzer", body: { analyzer: { rulez: {} } } },
    { name: "a default that is not a level", body: { analyzer: { default: "loud" } } },
    { name: "a category that does not exist", body: { analyzer: { categories: { a11y2: "on" } } } },
    {
      name: "a category level that is not a level",
      body: { analyzer: { categories: { a11y: 3 } } },
    },
    { name: "a rule level that is not a level", body: { analyzer: { rules: { "a.b": true } } } },
    { name: "a uiKit that is not a string", body: { analyzer: { uiKit: 1 } } },
    { name: "an ignore that is not a list of strings", body: { analyzer: { ignore: ["a", 2] } } },
  ];

  for (const refusal of refusals) {
    it(`refuses ${refusal.name}, in both languages, naming the file`, () => {
      const outcome = parseConfig(
        typeof refusal.body === "string" ? refusal.body : JSON.stringify(refusal.body),
        "/p/fg.config.json",
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.message.ru).toContain("/p/fg.config.json");
      expect(outcome.message.en).toContain("/p/fg.config.json");
      expect(outcome.message.ru).not.toBe(outcome.message.en);
    });
  }

  it("names the offending key path, so a 60-rule file says WHICH line", () => {
    const outcome = parseConfig(
      JSON.stringify({ analyzer: { rules: { "style.override": "loud" } } }),
      "/p/fg.config.json",
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message.ru).toContain('analyzer.rules["style.override"]');
    // …and the accepted vocabulary, which is the actionable half.
    expect(outcome.message.ru).toContain("candidate");
  });

  it("IGNORES unknown TOP-LEVEL keys — the file is fg.config.json, not analyzer.config.json", () => {
    const outcome = parseConfig(
      JSON.stringify({ $schema: "./x.json", pixso: { token: "t" }, analyzer: { default: "off" } }),
      "/p/fg.config.json",
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.loaded.config.default).toBe("off");
  });

  it("accepts a file with no analyzer section as 'the defaults, from this file'", () => {
    const outcome = parseConfig(JSON.stringify({ $schema: "./x.json" }), "/p/fg.config.json");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.loaded.config.source).toEqual({ kind: "file", path: "/p/fg.config.json" });
    expect(outcome.loaded.config.rules).toEqual({});
  });

  it("keeps uiKit and ignore OUT of the embedded config", () => {
    const outcome = parseConfig(
      JSON.stringify({ analyzer: { uiKit: "eds", ignore: ["src/legacy/**"], default: "on" } }),
      "/p/fg.config.json",
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.loaded.uiKit).toBe("eds");
    expect(outcome.loaded.ignore).toEqual(["src/legacy/**"]);
    expect(Object.keys(outcome.loaded.config).toSorted()).toEqual([
      "categories",
      "default",
      "rules",
      "source",
    ]);
  });
});

describe("unknown rule ids are a warning, never a refusal (D8)", () => {
  const catalog = ruleCatalog();

  it("says nothing about an id, a dot-prefix of one, or a declared sub-rule", () => {
    const unknown = unknownRuleIds(
      ["a11y.name.missing", "a11y.aria", "a11y.lint/alt-text"],
      catalog,
    );
    expect(unknown).toEqual([]);
  });

  it("lists a kit rule this run cannot act on, and a typo, and nothing else", () => {
    const unknown = unknownRuleIds(
      ["token.literal.color", "a11y.name.mising", "a11y.lint/alt-txt", "a11y.lint"],
      catalog,
    );
    expect(unknown).toEqual(["token.literal.color", "a11y.name.mising", "a11y.lint/alt-txt"]);
  });

  /**
   * V4 AUDIT, FINDING 6. `--init-config` writes EVERY rule row `"inherit"`, and D13 drops those
   * rows before the resolved config exists — so checking `config.rules` meant a typo in the file
   * the tool itself generates was silently inert. The check reads the FILE's keys now.
   */
  it("names a typo'd id even at `inherit`, which is the level --init-config writes", async () => {
    const outcome = parseConfig(
      JSON.stringify({ analyzer: { rules: { "a11y.typo": INHERIT_LEVEL } } }),
      "/p/fg.config.json",
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // The LEVEL is gone from the resolved config — that is D13, and it must stay true…
    expect(outcome.loaded.config.rules).toEqual({});
    // …while the KEY the file wrote survives, and is what the warning reads.
    expect(outcome.loaded.ruleKeys).toEqual(["a11y.typo"]);
    expect(unknownRuleIds(outcome.loaded.ruleKeys, catalog)).toEqual(["a11y.typo"]);
    // Proof this is a real fix and not a tautology: the old source of keys still says nothing.
    expect(unknownRuleIds(Object.keys(outcome.loaded.config.rules), catalog)).toEqual([]);
  });

  /** …and it reaches the user, from a real run over a real generated-shaped file. */
  it("a typo at `inherit` reaches the user as a warning, and the run still produces its report", async () => {
    await write(projectDir, CONFIG, {
      analyzer: { rules: { "a11y.typo": INHERIT_LEVEL, "a11y.name.missing": INHERIT_LEVEL } },
    });
    const rendered = fresh();
    const run = capture({ cwd: cwdDir, source: "x", out: join(cwdDir, "r.html") });

    // Exit 1 is U2 over the fixture's visible error — the unknown id did not fail anything.
    expect(await commandOver(rendered).run(run.ctx)).toBe(1);
    const notes = run.ui.filter((line) => line.startsWith("warn:") && line.includes("a11y.typo"));
    expect(notes).toHaveLength(1);
    // The correctly spelled row beside it is NOT named.
    expect(notes[0]).not.toContain("a11y.name.missing");
  });

  it("reaches the user as a UI warning and lets the run continue", async () => {
    await write(projectDir, CONFIG, { analyzer: { rules: { "token.nope": "off" } } });
    const rendered = fresh();
    const run = capture({ cwd: cwdDir, source: "x", out: join(cwdDir, "r.html") });

    expect(await commandOver(rendered).run(run.ctx)).toBe(1);
    expect(
      run.ui.filter((line) => line.startsWith("warn:") && line.includes("token.nope")),
    ).toHaveLength(1);
    expect(text(run.err)).toBe("");
  });
});

/* ── `inherit`: the file's seventh level, dropped before the engine sees it (D13) ─────────── */

describe("`inherit` (D13)", () => {
  it("is an ACCEPTED level at all three scopes, not a refusal", () => {
    const outcome = parseConfig(
      JSON.stringify({
        analyzer: {
          default: INHERIT_LEVEL,
          categories: { a11y: INHERIT_LEVEL },
          rules: { "a11y.lint": INHERIT_LEVEL },
        },
      }),
      "/p/fg.config.json",
    );
    expect(outcome.ok).toBe(true);
  });

  /**
   * THE WHOLE OF D13, at each of the three scopes. `inherit` never reaches the resolved config —
   * "absent" is already how that shape spells "no opinion", which is what let the engine, the
   * payload and the dashboard stay untouched by this amendment.
   */
  it("is DROPPED from rules and categories, and means `on` at `default`", () => {
    const outcome = parseConfig(
      JSON.stringify({
        analyzer: {
          default: INHERIT_LEVEL,
          categories: { a11y: INHERIT_LEVEL, icon: "off" },
          rules: { "a11y.lint": INHERIT_LEVEL, "a11y.name.missing": "warning" },
        },
      }),
      "/p/fg.config.json",
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // `default` is the LAST scope: nothing to fall through to, so it is the built-in `on`.
    expect(outcome.loaded.config.default).toBe("on");
    // The two `inherit` rows are gone; the two opinions are kept, verbatim.
    expect(outcome.loaded.config.categories).toEqual({ icon: "off" });
    expect(outcome.loaded.config.rules).toEqual({ "a11y.name.missing": "warning" });
    // Belt and braces: the word cannot appear anywhere in what the engine and the report embed.
    expect(JSON.stringify(outcome.loaded.config)).not.toContain(INHERIT_LEVEL);
  });

  it("names `inherit` among the accepted levels when a level is misspelled", () => {
    const outcome = parseConfig(
      JSON.stringify({ analyzer: { default: "inherited" } }),
      "/p/fg.config.json",
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message.ru).toContain(INHERIT_LEVEL);
    expect(outcome.message.en).toContain(INHERIT_LEVEL);
    expect([...FILE_LEVELS]).toHaveLength(7);
  });

  /**
   * THE REGRESSION D13 EXISTS FOR, stated end to end over the file `--init-config` actually
   * writes: switch ONE category off, change nothing else, and that category's findings are gone.
   *
   * Before the amendment this test failed: the generated file named all 41 rows at their built-in
   * severity, and a `rules` row beats a category (D7), so the category line did nothing. It is
   * therefore also the mutation check for the drop — removing `if (!isInherit(level))` from
   * `src/config/load.ts` makes it fail (verified; see the report).
   */
  it("a GENERATED file with one category switched off really hides that category", async () => {
    const generated = configDocumentOf({ catalog: ruleCatalog(), uiKit: null }) as {
      analyzer: { categories: Record<string, string>; rules: Record<string, string> };
    };
    // Every row still `inherit` except the ONE the user came to change.
    generated.analyzer.categories["a11y"] = "off";
    const path = join(projectDir, CONFIG);
    await writeFile(path, serialise(generated), "utf8");

    const rendered = fresh();
    const run = capture({ cwd: cwdDir, source: "x", out: join(cwdDir, "r.html") });
    // The ONLY error was the a11y one, so hiding it opens U2's gate as well.
    expect(await commandOver(rendered).run(run.ctx)).toBe(0);

    // ENGINE_RESULT holds one a11y error and one icon warning: the a11y one is hidden, the icon
    // one survives, and the rule rows the file still names had no say in either.
    const rows = rowsFor({ errors: 0, warnings: 1, suppressed: 1, path });
    expect(run.ui.at(-1)).toContain(rows.findings);
    expect(run.ui.at(-1)).toContain(rows.hidden);
    // …and the payload still carries BOTH raw findings, so the reader can switch it back on.
    expect(rendered.payloads[0]?.findings).toHaveLength(2);
    expect(rendered.payloads[0]?.ruleConfig.categories).toEqual({ a11y: "off" });
    expect(rendered.payloads[0]?.ruleConfig.rules).toEqual({});
  });

  it("…and the same file under --format compact prints only the surviving category, exit 0", async () => {
    const generated = configDocumentOf({ catalog: ruleCatalog(), uiKit: null }) as {
      analyzer: { categories: Record<string, string> };
    };
    generated.analyzer.categories["a11y"] = "off";
    await writeFile(join(projectDir, CONFIG), serialise(generated), "utf8");

    const run = capture({
      cwd: cwdDir,
      source: "x",
      formats: ["compact"],
    });
    // The only error was the a11y one, so the gate opens too.
    expect(await commandOver(fresh()).run(run.ctx)).toBe(0);
    expect(text(run.out)).toContain("icon.foreign-pack");
    expect(text(run.out)).not.toContain("a11y.name.missing");
  });
});

/* ── the wiring: uiKit fallback, the config line, the payload ─────────────────────────────── */

describe("the file reaches the run", () => {
  it("--ui-kit beats analyzer.uiKit, which beats autodetect", async () => {
    await write(projectDir, CONFIG, { analyzer: { uiKit: "nope-not-a-kit" } });
    const rendered = fresh();
    // The FLAG names a real kit, so the file's nonsense is never consulted: flag > file.
    const withFlag = capture({
      cwd: cwdDir,
      source: "x",
      out: join(cwdDir, "r.html"),
      uiKit: "none",
    });
    expect(await commandOver(rendered).run(withFlag.ctx)).toBe(1);

    // Without the flag the file's value IS consulted — and being unknown, it is refused with the
    // same message an unknown `--ui-kit` gets, rather than silently analysing against nothing.
    const noFlag = capture({ cwd: cwdDir, source: "x", out: join(cwdDir, "r2.html") });
    expect(await commandOver(fresh()).run(noFlag.ctx)).toBe(2);
    expect(text(noFlag.err)).toContain("nope-not-a-kit");
  });

  it("forwards analyzer.ignore to the engine and the config to the payload", async () => {
    const path = await write(projectDir, CONFIG, {
      analyzer: { ignore: ["src/legacy/**"], rules: { "icon.foreign-pack": "off" } },
    });
    const rendered = fresh();
    const seen: (readonly string[] | undefined)[] = [];
    const commands = createProjectReportCommands({
      resolveSource: (): Promise<ResolvedSource> =>
        Promise.resolve({ kind: "local", dir: projectDir, cleanup: () => Promise.resolve() }),
      analyzeProject: (options) => {
        seen.push(options.ignore);
        expect(options.ruleConfig?.source).toEqual({ kind: "file", path });
        return Promise.resolve(ENGINE_RESULT);
      },
      renderReport: (payload) => {
        rendered.payloads.push(payload);
        return HTML;
      },
    });
    const run = capture({ cwd: cwdDir, source: "x", out: join(cwdDir, "r.html") });

    expect(await (commands[0] as (typeof commands)[number]).run(run.ctx)).toBe(1);
    expect(seen).toEqual([["src/legacy/**"]]);

    const payload = rendered.payloads[0];
    // D11: the RAW findings travel into the report untouched, so the dashboard's reader can
    // switch the rule back on — the config rides beside them as the default view.
    expect(payload?.findings).toHaveLength(2);
    expect(payload?.ruleConfig).toEqual({
      default: "on",
      categories: {},
      rules: { "icon.foreign-pack": "off" },
      source: { kind: "file", path },
    });
    expect(payload?.ruleCatalog.map((entry) => entry.id)).toEqual(
      ruleCatalog().map((entry) => entry.id),
    );
  });

  it("the summary block carries the counts under the config, and names the file (§2.3)", async () => {
    const path = await write(projectDir, CONFIG, {
      analyzer: { rules: { "icon.foreign-pack": "off" } },
    });
    const rendered = fresh();
    const run = capture({ cwd: cwdDir, source: "x", out: join(cwdDir, "r.html") });

    expect(await commandOver(rendered).run(run.ctx)).toBe(1);

    const rows = rowsFor({ errors: 1, warnings: 0, suppressed: 1, path });
    // The counts moved off stdout and into the block (U3: stdout is data).
    expect(text(run.out)).not.toContain(rows.findings);
    expect(run.ui.at(-1)).toContain(rows.findings);
    expect(run.ui.at(-1)).toContain(rows.hidden);
    // …and the file that hid the finding is named ONCE, in the value of the `скрыто` row.
    expect(run.ui.at(-1)).toContain(`${rowKeys.hidden.ru}=1   конфиг: ${path}`);
    // The config source is also said while the run happens, as a note (§2.6).
    expect(run.ui.filter((line) => line === `note:конфиг: ${path}`)).toHaveLength(1);
    // The path is still the LAST line on stdout, so `| tail -1` keeps working.
    expect(text(run.out).trimEnd().split("\n").at(-1)).toBe(join(cwdDir, "r.html"));
  });

  /**
   * NO `скрыто` ROW when there is nothing to say about a config (design §5): no file was in
   * force and nothing was hidden. The row used to be printed on every run, saying
   * «конфиг: по умолчанию — … скрыто 0», which is a line that never carries news.
   */
  it("prints no `скрыто` row when no file was found and nothing was hidden", async () => {
    const run = capture({ cwd: cwdDir, source: "x", out: join(cwdDir, "r.html") });
    expect(await commandOver(fresh()).run(run.ctx)).toBe(1);
    const block = run.ui.at(-1) ?? "";
    expect(block).toContain(
      rowsFor({ errors: 1, warnings: 1, suppressed: 0, path: null }).findings,
    );
    expect(block).not.toContain(`${rowKeys.hidden.ru}=`);
    // …and no note claims a config that does not exist.
    expect(run.ui.filter((line) => line.startsWith("note:конфиг"))).toEqual([]);
  });

  /** …and «по умолчанию» IS said when a run hid something with no file in force. */
  it("says «по умолчанию» when the built-in defaults hid something", () => {
    expect(rowsFor({ errors: 0, warnings: 0, suppressed: 2, path: null }).hidden).toBe(
      `${rowKeys.hidden.ru}=2   конфиг: по умолчанию`,
    );
  });

  it("a malformed file is exit 2 and nothing is written", async () => {
    await write(projectDir, CONFIG, "{ nope");
    const run = capture({ cwd: cwdDir, source: "x", out: join(cwdDir, "r.html") });
    expect(await commandOver(fresh()).run(run.ctx)).toBe(2);
    expect(text(run.err)).toContain(join(projectDir, CONFIG));
  });
});

/* ── --format: what each value produces, and the gate (U1, U2) ───────────────────────────── */

describe("--format (U1) and the exit code (U2)", () => {
  it("an unknown --format is a usage error naming every accepted value", async () => {
    const run = capture({
      cwd: cwdDir,
      source: "x",
      out: join(cwdDir, "r.html"),
      formats: ["checkstyle"],
    });
    expect(await commandOver(fresh()).run(run.ctx)).toBe(2);
    expect(text(run.err)).toBe(`${unknownFormat("checkstyle", REPORT_FORMATS).ru}\n`);
  });

  it("compact: stdout is EXACTLY the formatter's text — no notice, no path, no file", async () => {
    const rendered = fresh();
    const run = capture({ cwd: cwdDir, source: "x", formats: ["compact"] });

    // One visible error in ENGINE_RESULT, so the gate closes: exit 1 (U2).
    expect(await commandOver(rendered).run(run.ctx)).toBe(1);

    const expected = formatLint("compact", {
      findings: ENGINE_RESULT.findings,
      catalog: ruleCatalog(),
      projectRoot: projectDir,
      tool: { name: "fg", version: "0.0.0-dev" },
      lang: "ru",
      color: false,
      hiddenCount: 0,
    });
    expect(text(run.out)).toBe(withNewline(expected.text));
    // Nothing was rendered and nothing was written: `compact` is not a file (U9).
    expect(rendered.payloads).toEqual([]);
  });

  it("compact,html: the document on stdout, the report on disk, both from ONE analysis", async () => {
    const rendered = fresh();
    const run = capture({
      cwd: cwdDir,
      source: "x",
      out: join(cwdDir, "r.html"),
      formats: ["compact", "html"],
    });
    expect(await commandOver(rendered).run(run.ctx)).toBe(1);
    expect(text(run.out)).toContain("a11y.name.missing");
    expect(text(run.out).trimEnd().split("\n").at(-1)).toBe(join(cwdDir, "r.html"));
    expect(rendered.payloads).toHaveLength(1);
  });

  it("the default is html: nothing on stdout but the path, and no findings text", async () => {
    const rendered = fresh();
    const run = capture({ cwd: cwdDir, source: "x" });
    expect(await commandOver(rendered).run(run.ctx)).toBe(1);
    expect(text(run.out)).toBe(`${join(cwdDir, defaultReportPath("html"))}\n`);
    expect(rendered.payloads).toHaveLength(1);
  });

  it("exits 0 when the config hides every error, and compact still says so in one line", async () => {
    await write(projectDir, CONFIG, { analyzer: { default: "off" } });
    const run = capture({ cwd: cwdDir, source: "x", formats: ["compact"] });
    // CHANGED BY THE UX REDESIGN, §2.4: a clean run used to print nothing at all, which read as
    // a run that had not happened. It now prints the one green line and nothing else. The gate
    // is the assertion that still matters here — every finding hidden means exit 0.
    expect(await commandOver(fresh()).run(run.ctx)).toBe(0);
    expect(
      text(run.out)
        .split("\n")
        .filter((line) => line !== ""),
    ).toHaveLength(1);
    // …and the hidden count reaches the formatter's footer (design §2.4).
    expect(text(run.out)).toContain("скрыто конфигом: 2");
  });

  it("re-grading the only error down to a warning opens the gate", async () => {
    await write(projectDir, CONFIG, { analyzer: { rules: { "a11y.name.missing": "warning" } } });
    const run = capture({ cwd: cwdDir, source: "x", formats: ["compact"] });
    expect(await commandOver(fresh()).run(run.ctx)).toBe(0);
    // The finding is still REPORTED — it is graded, not hidden — so the text is not empty.
    expect(text(run.out)).toContain("a11y.name.missing");
    expect(text(run.out)).not.toContain("error");
  });

  /**
   * U2's own sentence: the gate is the same for EVERY format, "incl. html-only". Before the
   * redesign this run exited 0 with an error inside the file, and only `--lint` could fail.
   */
  it("html alone fails on a visible error, exactly as compact does", async () => {
    const html = capture({ cwd: cwdDir, source: "x", formats: ["html"] });
    expect(await commandOver(fresh()).run(html.ctx)).toBe(1);
    const compact = capture({ cwd: cwdDir, source: "x", formats: ["compact"] });
    expect(await commandOver(fresh()).run(compact.ctx)).toBe(1);
  });

  it("--format json writes a parseable document to a FILE, not to stdout", async () => {
    const run = capture({ cwd: cwdDir, source: "x", formats: ["json"] });
    expect(await commandOver(fresh()).run(run.ctx)).toBe(1);
    const path = join(cwdDir, defaultReportPath("json"));
    expect(text(run.out)).toBe(`${path}\n`);
    const parsed = JSON.parse(await readFile(path, "utf8")) as { filePath: string }[];
    expect(parsed.map((file) => file.filePath).toSorted()).toEqual([
      join(projectDir, "src/App.tsx"),
      join(projectDir, "src/Icons.tsx"),
    ]);
  });
});

/* ── the catalog, over the REAL adapter (design §9/§10) ───────────────────────────────────── */

describe("ruleCatalog over the EDS adapter", () => {
  const catalog: readonly RuleCatalogEntry[] = ruleCatalog(createEdsAdapter());

  it("has exactly 32 finding-level ids, once each", () => {
    expect(catalog).toHaveLength(32);
    expect(new Set(catalog.map((entry) => entry.id)).size).toBe(32);
  });

  it("lists the eleven engine rules without an adapter", () => {
    expect(ruleCatalog()).toHaveLength(11);
  });

  /**
   * The four ids `style.override` EMITS and the three `component.custom` does — the reason the
   * number is 32 and not the design's original 30 (`rc-design.md:96` vs its §9 amendment). A
   * catalog that listed the RULE ids instead would still have the right length by accident, so
   * the ids themselves are named.
   */
  it("lists emitted ids rather than the rules that emit them", () => {
    const ids = new Set(catalog.map((entry) => entry.id));
    for (const id of [
      "style.override.important",
      "style.override.inner",
      "style.override.repaint",
      "style.override.size",
      "component.fork",
      "component.custom",
      "component.ambiguous",
      "component.novel",
      "component.duplicate",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
    expect(ids.has("style.override")).toBe(false);
  });

  it("carries a11y.lint's 30 sub-rules, each with a severity and a description", () => {
    const lint = catalog.find((entry) => entry.id === "a11y.lint");
    expect(lint?.subrules).toHaveLength(30);
    for (const sub of lint?.subrules ?? []) {
      expect(sub.id).not.toBe("");
      expect(sub.description).not.toBe("");
      expect(["error", "warning", "info", "candidate"]).toContain(sub.severity);
    }
  });

  it("marks 11 ids as the engine's own and the rest as the adapter's", () => {
    const engine = catalog.filter((entry) => entry.origin === "engine");
    // Ten of the engine's eleven survive: `component.duplicate` is REPLACED by the adapter's.
    expect(engine).toHaveLength(10);
    expect(catalog.filter((entry) => entry.origin === "eds")).toHaveLength(22);
  });
});
