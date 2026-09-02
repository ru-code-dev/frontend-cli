/**
 * TIER 1 — `fg --init-config`, driven through its REAL handler.
 *
 * Nothing is faked here except the design-system REGISTRY, and only in the cases about
 * autodetect: the two documents are the deliverable, so they are built by the real
 * `configDocumentOf`/`schemaDocumentOf` from the real `ruleCatalog`, written to a real scratch
 * directory and read back. A fake filesystem would have made "refuses to overwrite" a claim
 * about the fake.
 *
 * `FG_KITS_DIR` is pinned at a path that does not exist wherever the REAL `eds` entry is used.
 * Without it `resolveAdapter` consults `~/.fg/kits/eds/` (`packages/fg-eds-adapter/src/corpus.ts`)
 * and the assertions would silently measure whatever corpus this machine happens to hold —
 * passing on CI and failing for the one developer who has run `fg --parse-ui-kit eds`.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { KitAdapter, RuleCatalogEntry } from "@smart-tools/fg-analyzer-engine";
import { ruleCatalog } from "@smart-tools/fg-analyzer-engine";
import { argName, pick } from "@smart-tools/fg-cli-kit";
import { createEdsAdapter } from "@smart-tools/fg-eds-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { AdapterEntry } from "../src/index.ts";
import {
  adapterNames,
  configExists,
  createInitConfigCommands,
  describeKey,
  FILE_LEVELS,
  INHERIT_LEVEL,
  initConfigNoKit,
  initConfigWritten,
  ruleEntriesOf,
  unknownAdapter,
} from "../src/index.ts";
import { capture, scratch, text } from "./harness.ts";

const CONFIG = "fg.config.json";
const SCHEMA = "fg.config.schema.json";

let dir = "";
let remove: () => Promise<void> = () => Promise.resolve();

beforeEach(async () => {
  ({ dir, remove } = await scratch());
});

afterEach(async () => {
  await remove();
});

/** No corpus on this machine's disk may reach these assertions — see the file header. */
const isolated = (): Record<string, string> => ({
  FG_KITS_DIR: join(dir, "kits-that-do-not-exist"),
});

const command = (adapters?: readonly AdapterEntry[]) => {
  const commands =
    adapters === undefined ? createInitConfigCommands() : createInitConfigCommands({ adapters });
  expect(commands).toHaveLength(1);
  return commands[0] as (typeof commands)[number];
};

interface ConfigDocument {
  readonly $schema: string;
  readonly analyzer: {
    readonly uiKit?: string;
    readonly default: string;
    readonly categories: Record<string, string>;
    readonly rules: Record<string, string>;
  };
}

interface SchemaDocument {
  readonly title: string;
  readonly properties: {
    readonly analyzer: {
      readonly description: string;
      readonly properties: {
        readonly uiKit: { readonly description: string; readonly enum: readonly string[] };
        readonly ignore: { readonly description: string };
        readonly default: { readonly description: string; readonly enum: readonly string[] };
        readonly categories: {
          readonly description: string;
          readonly properties: Record<string, { readonly enum: readonly string[] }>;
        };
        readonly rules: {
          readonly description: string;
          readonly properties: Record<
            string,
            { readonly description: string; readonly enum: readonly string[] }
          >;
          readonly additionalProperties: { readonly enum: readonly string[] };
        };
      };
    };
  };
}

const readSchema = async (path: string): Promise<SchemaDocument> =>
  JSON.parse(await readFile(path, "utf8")) as SchemaDocument;

/** Any Cyrillic letter — the whole point of `--lang en` is that the schema's own text has none. */
const CYRILLIC = /[\u0400-\u04FF]/u;

/**
 * The schema's OWN sentences: the title plus every `description` that is not a per-rule one.
 *
 * The per-rule descriptions are handled separately because they EMBED the engine catalog's
 * Russian text, which stays Russian on purpose — only the wrapper around it is localized.
 */
const ownSentencesOf = (schema: SchemaDocument): readonly string[] => {
  const analyzer = schema.properties.analyzer;
  return [
    schema.title,
    analyzer.description,
    analyzer.properties.uiKit.description,
    analyzer.properties.ignore.description,
    analyzer.properties.default.description,
    analyzer.properties.categories.description,
    analyzer.properties.rules.description,
  ];
};

const readConfig = async (path: string): Promise<ConfigDocument> =>
  JSON.parse(await readFile(path, "utf8")) as ConfigDocument;

const ruRuleCount = (rules: number): string => initConfigWritten({ rules, subrules: 0 }).ru;
const ruSubruleCount = (subrules: number): string =>
  initConfigWritten({ rules: 0, subrules }).ru;

describe("the registry entry itself", () => {
  it("is ONE command spelled --init-config with the alias --iconf", () => {
    expect(command().flag).toBe("--init-config");
    expect(command().alias).toBe("--iconf");
  });

  it("declares two optional arguments, both documented in both languages", () => {
    const args = command().args;
    // Short and ASCII, for the reason `command.ts` states over `sourceArg`: these names ARE the
    // help table's first column and every refusal's usage row, and `--ui-kit` names the same
    // values here as it does under `--preport`, from the same registry.
    // The placeholder is localized (V5 finding #12); the flag's value list is not, because it is
    // the same text in both languages and the parser reads the accepted values back out of it.
    expect(args.map((a) => argName(a, "ru"))).toEqual([
      "-o <файл>",
      `--ui-kit ${adapterNames().join("|")}`,
    ]);
    expect(args.map((a) => argName(a, "en"))).toEqual([
      "-o <file>",
      `--ui-kit ${adapterNames().join("|")}`,
    ]);
    expect(args.map((a) => a.required)).toEqual([false, false]);
    for (const lang of ["ru", "en"] as const) {
      for (const arg of args) expect(pick(arg.description, lang)).not.toBe("");
      expect(pick(command().summary, lang)).toContain(CONFIG);
    }
    expect(command().summary.ru).not.toBe(command().summary.en);
  });
});

describe("what it writes", () => {
  it("writes BOTH files beside each other and names both, absolutely", async () => {
    const run = capture({ cwd: dir, uiKit: "none", env: isolated() });
    expect(await command().run(run.ctx)).toBe(0);

    const configPath = join(dir, CONFIG);
    const schemaPath = join(dir, SCHEMA);
    const printed = text(run.out).trimEnd().split("\n");
    expect(printed.slice(-2)).toEqual([configPath, schemaPath]);
    // The block carries the same list — one contract, two channels (U3).
    expect(run.ui.at(-1)).toContain(configPath);
    expect(run.ui.at(-1)).toContain(schemaPath);

    const document = await readConfig(configPath);
    // `$schema` is RELATIVE, so the pair travels together into another repository.
    expect(document.$schema).toBe(`./${SCHEMA}`);
    expect(document.analyzer.default).toBe("on");
    // All eight categories, so switching a whole category off is editing a line rather than
    // discovering a name.
    expect(Object.keys(document.analyzer.categories).toSorted()).toEqual([
      "a11y",
      "api",
      "component",
      "font",
      "icon",
      "override",
      "token",
      "typography",
    ]);
    // D13: every category row is present and silent, so `default` decides until one is given an
    // opinion.
    expect(new Set(Object.values(document.analyzer.categories))).toEqual(new Set([INHERIT_LEVEL]));
    // `--ui-kit none` is a decision: the file says nothing about a design system.
    expect(document.analyzer.uiKit).toBeUndefined();
  });

  /**
   * D13. Every row is present and SILENT: the file is the inventory, and `default`/`categories`
   * decide until a row is given an opinion. Before the amendment these rows carried their
   * built-in severity, which made `"categories": { "a11y": "off" }` a no-op on a generated file
   * (D7 puts `rules` above `categories`) — A2's D-5.
   */
  it("lists every generic rule and every a11y.lint sub-rule, each at `inherit`", async () => {
    const run = capture({ cwd: dir, uiKit: "none", env: isolated() });
    expect(await command().run(run.ctx)).toBe(0);

    const document = await readConfig(join(dir, CONFIG));
    const expected = ruleEntriesOf(ruleCatalog());
    expect(Object.keys(document.analyzer.rules)).toEqual(expected.map((entry) => entry.key));
    // 11 engine rules + a11y.lint's 30 sub-rules.
    expect(expected).toHaveLength(41);
    expect(new Set(Object.values(document.analyzer.rules))).toEqual(new Set([INHERIT_LEVEL]));
    expect(new Set(Object.values(document.analyzer.categories))).toEqual(new Set([INHERIT_LEVEL]));
    // `default` is the ONE row that is not `inherit`: it is the last scope, with nothing under it.
    expect(document.analyzer.default).toBe("on");
  });

  /**
   * …and the severity did not disappear — it moved to where an editor shows it. The generated
   * file is unreadable without this: 62 rows all saying `inherit` tell a user nothing about what
   * they would be changing.
   */
  it("moves each rule's built-in level into the schema's hover text", async () => {
    const run = capture({ cwd: dir, uiKit: "none", env: isolated() });
    expect(await command().run(run.ctx)).toBe(0);

    const schema = JSON.parse(await readFile(join(dir, SCHEMA), "utf8")) as SchemaDocument;
    const rules = schema.properties.analyzer.properties.rules;
    for (const entry of ruleEntriesOf(ruleCatalog())) {
      expect(rules.properties[entry.key]?.description).toBe(
        describeKey(entry.builtin, entry.description, "ru"),
      );
    }
    expect(rules.properties["a11y.name.missing"]?.description).toContain(
      "встроенный уровень: error",
    );
    // A rule that grades per finding has no single severity to name, and says so.
    expect(rules.properties["a11y.lint"]?.description).toContain(
      "встроенный уровень: зависит от находки",
    );
    expect(rules.properties["a11y.lint/alt-text"]?.description).toContain(
      "встроенный уровень: error",
    );
  });

  /**
   * V4 AUDIT, FINDING 1 (MAJOR). The schema is the feature's in-editor documentation — it is
   * what an editor shows on hover while somebody edits the 62-row config — and it shipped
   * hardcoded Russian while the console around it obeyed `--lang`. PROTOCOL §4 requires every
   * user-facing string to be `Localized {ru,en}`.
   *
   * The assertion is on the schema's OWN sentences and on the WRAPPER of each per-key
   * description, never on the rule text embedded inside it: that text is the engine catalog's,
   * which has one language, and paraphrasing it here would be a second copy free to drift.
   */
  it("--lang en: not one Cyrillic letter in the schema's own text", async () => {
    const run = capture({ cwd: dir, uiKit: "none", lang: "en", env: isolated() });
    expect(await command().run(run.ctx)).toBe(0);

    const schema = await readSchema(join(dir, SCHEMA));
    expect(schema.title).toBe("fg — rule configuration for the project analysis");
    for (const sentence of ownSentencesOf(schema)) {
      expect(sentence).not.toBe("");
      expect(sentence).not.toMatch(CYRILLIC);
    }

    // Every per-key description = an English wrapper + the catalog's own Russian text. Strip the
    // catalog's half and what remains must be Cyrillic-free.
    const rules = schema.properties.analyzer.properties.rules;
    const entries = ruleEntriesOf(ruleCatalog());
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const description = rules.properties[entry.key]?.description ?? "";
      expect(description).toBe(describeKey(entry.builtin, entry.description, "en"));
      expect(description.endsWith(entry.description)).toBe(true);
      const wrapper = description.slice(0, description.length - entry.description.length);
      expect(wrapper).not.toMatch(CYRILLIC);
      expect(wrapper).toMatch(/^built-in level: .+ — $/u);
    }
    // The rule's own text SURVIVED — an English schema that dropped the descriptions would pass
    // a Cyrillic check and be useless.
    expect(rules.properties["a11y.name.missing"]?.description).toBe(
      `built-in level: error — ${
        ruleCatalog().find((entry) => entry.id === "a11y.name.missing")?.description ?? ""
      }`,
    );
    // `mixed` is a sentence, not a severity name, so it is the one built-in label that changes.
    expect(rules.properties["a11y.lint"]?.description).toContain(
      "built-in level: depends on the finding — ",
    );
  });

  /** …and `ru`, which is the default, is byte-for-byte the text the feature shipped with. */
  it("--lang ru: the schema's own text is unchanged", async () => {
    const run = capture({ cwd: dir, uiKit: "none", env: isolated() });
    expect(await command().run(run.ctx)).toBe(0);

    const schema = await readSchema(join(dir, SCHEMA));
    expect(schema.title).toBe("fg — конфигурация правил анализа проекта");
    const analyzer = schema.properties.analyzer;
    expect(analyzer.description).toBe("Что и как проверяет fg --project-report");
    expect(analyzer.properties.uiKit.description).toBe(
      "Дизайн-система, правила которой учитывать. Флаг --ui-kit важнее этого значения",
    );
    expect(analyzer.properties.ignore.description).toBe(
      "Дополнительные шаблоны игнорирования в синтаксисе .gitignore",
    );
    expect(analyzer.properties.default.description).toBe(
      "Уровень для всего, что не названо явно. Последняя ступень: inherit здесь означает on",
    );
    expect(analyzer.properties.categories.description).toBe(
      "Уровень для целой категории находок. Важнее default, но слабее строки в rules, если та не inherit",
    );
    expect(analyzer.properties.rules.description).toBe(
      "Уровень для правила, для группы правил по префиксу (style.override) или для подправила (a11y.lint/alt-text). Важнее категории и default; inherit означает «нет мнения» — тогда решает категория",
    );
    expect(analyzer.properties.rules.properties["a11y.lint"]?.description).toContain(
      "встроенный уровень: зависит от находки — ",
    );
  });

  /** The config file itself is language-free: keys and levels, identical under either `--lang`. */
  it("the config document is the same under either language", async () => {
    const ru = capture({ cwd: dir, uiKit: "none", env: isolated() });
    expect(await command().run(ru.ctx)).toBe(0);
    const russian = await readFile(join(dir, CONFIG), "utf8");

    const other = await scratch();
    try {
      const en = capture({
        cwd: other.dir,
        uiKit: "none",
        lang: "en",
        env: { FG_KITS_DIR: join(other.dir, "kits-that-do-not-exist") },
      });
      expect(await command().run(en.ctx)).toBe(0);
      expect(await readFile(join(other.dir, CONFIG), "utf8")).toBe(russian);
    } finally {
      await other.remove();
    }
  });

  it("--ui-kit eds: 32 rule ids and 30 sub-rule keys, and the kit is named in the file", async () => {
    const run = capture({ cwd: dir, uiKit: "eds", env: isolated() });
    expect(await command().run(run.ctx)).toBe(0);

    const document = await readConfig(join(dir, CONFIG));
    expect(document.analyzer.uiKit).toBe("eds");

    const catalog: readonly RuleCatalogEntry[] = ruleCatalog(createEdsAdapter());
    const keys = Object.keys(document.analyzer.rules);
    expect(catalog).toHaveLength(32);
    expect(keys.filter((key) => !key.includes("/"))).toHaveLength(32);
    expect(keys.filter((key) => key.startsWith("a11y.lint/"))).toHaveLength(30);
    expect(keys).toHaveLength(62);
    // Every one of them silent (D13); their built-in severities are in the schema's hover text.
    expect(document.analyzer.rules["token.tier.violation"]).toBe(INHERIT_LEVEL);
    expect(document.analyzer.rules["style.override.size"]).toBe(INHERIT_LEVEL);
    // …and the summary block's headline counts the two groups separately (design 2.5).
    expect(run.ui.at(-1)).toContain("32");
    expect(run.ui.at(-1)).toContain("30");
  });

  it("the schema documents every key the config holds, and stays open for prefixes", async () => {
    const run = capture({ cwd: dir, uiKit: "eds", env: isolated() });
    expect(await command().run(run.ctx)).toBe(0);

    const schema = JSON.parse(await readFile(join(dir, SCHEMA), "utf8")) as SchemaDocument;
    const rules = schema.properties.analyzer.properties.rules;
    const expected = ruleEntriesOf(ruleCatalog(createEdsAdapter()));
    expect(Object.keys(rules.properties)).toEqual(expected.map((entry) => entry.key));
    // Each key carries the rule's own description — that is what an editor shows on hover, and
    // without it the file is 62 strings nobody can verify.
    for (const entry of expected) {
      expect(rules.properties[entry.key]?.description).toBe(
        describeKey(entry.builtin, entry.description, "ru"),
      );
      expect(entry.description).not.toBe("");
    }
    // OPEN: `style.override` (a dot-prefix) and a kit rule from another project are legal keys.
    expect(rules.additionalProperties).not.toBe(false);
    // D13: `inherit` is one of the seven levels an editor offers, at EVERY scope — a rule row,
    // a category row and `default` alike, so the file can say "no opinion" wherever it has none.
    const analyzer = schema.properties.analyzer.properties;
    for (const scope of [
      rules.properties["a11y.lint"]?.enum,
      analyzer.categories.properties["a11y"]?.enum,
      analyzer.default.enum,
      rules.additionalProperties.enum,
    ]) {
      expect(scope).toEqual([...FILE_LEVELS]);
      expect(scope).toContain(INHERIT_LEVEL);
    }
    // The kit enum is the registry's list, `none` included.
    expect(schema.properties.analyzer.properties.uiKit.enum).toEqual([...adapterNames()]);
    expect(Object.keys(schema.properties.analyzer.properties.categories.properties)).toHaveLength(
      8,
    );
  });

  it("-o names the config, and the schema follows it into the same directory", async () => {
    const run = capture({
      cwd: dir,
      out: "nested/deeper/rules.json",
      uiKit: "none",
      env: isolated(),
    });
    expect(await command().run(run.ctx)).toBe(0);
    const document = await readConfig(join(dir, "nested", "deeper", "rules.json"));
    expect(document.$schema).toBe(`./${SCHEMA}`);
    expect(text(run.out).trimEnd().split("\n").at(-1)).toBe(join(dir, "nested", "deeper", SCHEMA));
  });
});

/**
 * THE HEADLINE — design §2.5, verbatim: `✔ конфигурация создана    32 правила · 30 подправил`.
 *
 * Two V5 findings in one line. #11: the counts were `32 правил`, a hardcoded genitive plural
 * used for every number, while the README wrote «32 правила» and the pluraliser for that noun
 * already existed sixty lines above. #22: the headline joined them with a COLON, which makes the
 * counts part of the sentence; §2.5 joins them with a column of spaces, which makes them a value
 * beside it.
 */
describe("the summary headline (§2.5)", () => {
  it("pluralises the counts in Russian and joins them without a colon", () => {
    expect(initConfigWritten({ rules: 32, subrules: 30 }).ru).toBe(
      "конфигурация создана    32 правила · 30 подправил",
    );
    expect(initConfigWritten({ rules: 32, subrules: 30 }).en).toBe(
      "configuration written    32 rules · 30 sub-rules",
    );
    // The whole CLDR one/few/many table, not just the number this build happens to produce.
    expect(ruRuleCount(1)).toContain("1 правило");
    expect(ruRuleCount(2)).toContain("2 правила");
    expect(ruRuleCount(4)).toContain("4 правила");
    expect(ruRuleCount(5)).toContain("5 правил");
    expect(ruRuleCount(11)).toContain("11 правил");
    expect(ruRuleCount(21)).toContain("21 правило");
    expect(ruRuleCount(32)).toContain("32 правила");
    expect(ruSubruleCount(1)).toContain("1 подправило");
    expect(ruSubruleCount(3)).toContain("3 подправила");
    expect(ruSubruleCount(30)).toContain("30 подправил");
    // NO COLON anywhere in it (#22).
    expect(initConfigWritten({ rules: 32, subrules: 30 }).ru).not.toContain(":");
    expect(initConfigWritten({ rules: 1, subrules: 1 }).en).toBe(
      "configuration written    1 rule · 1 sub-rule",
    );
  });

  it("is what the run actually prints", async () => {
    const run = capture({ cwd: dir, uiKit: "none", env: isolated() });
    expect(await command().run(run.ctx)).toBe(0);
    const block = run.ui.at(-1) ?? "";
    expect(block.startsWith("summary:конфигурация создана    ")).toBe(true);
    expect(block).not.toContain("конфигурация создана:");
    expect(block).toMatch(/\d+ (правило|правила|правил) · \d+ (подправило|подправила|подправил)/u);
    // …and the paths land on stdout AFTER the phase they belong to is sealed (V5 finding #2).
    expect(run.ui.indexOf("end")).toBeGreaterThan(-1);
    expect(run.ui.indexOf("end")).toBeLessThan(run.ui.length - 1);
  });
});

describe("what it refuses", () => {
  it("never overwrites an existing config — exit 2, nothing written", async () => {
    const configPath = join(dir, CONFIG);
    await writeFile(configPath, "{ /* mine */ }", "utf8");

    const run = capture({ cwd: dir, uiKit: "none", env: isolated() });
    expect(await command().run(run.ctx)).toBe(2);
    expect(text(run.err)).toBe(`${configExists(configPath).ru}\n`);
    // The hand-edited file is untouched, and the schema was never created either: both paths are
    // checked before either is written.
    expect(await readFile(configPath, "utf8")).toBe("{ /* mine */ }");
    await expect(readFile(join(dir, SCHEMA), "utf8")).rejects.toThrow();
  });

  it("refuses when only the SCHEMA is in the way, and leaves the config absent", async () => {
    const schemaPath = join(dir, SCHEMA);
    await writeFile(schemaPath, "{}", "utf8");

    const run = capture({ cwd: dir, uiKit: "none", env: isolated() });
    expect(await command().run(run.ctx)).toBe(2);
    expect(text(run.err)).toContain(schemaPath);
    await expect(readFile(join(dir, CONFIG), "utf8")).rejects.toThrow();
  });

  it("an unknown --ui-kit is a usage error before anything is written", async () => {
    const run = capture({ cwd: dir, uiKit: "material", env: isolated() });
    expect(await command().run(run.ctx)).toBe(2);
    expect(text(run.err)).toBe(`${unknownAdapter("material", adapterNames()).ru}\n`);
    await expect(readFile(join(dir, CONFIG), "utf8")).rejects.toThrow();
  });
});

describe("choosing the design system", () => {
  /** A registry of one, so autodetect can be driven without a second design system existing. */
  const fakeAdapter: KitAdapter = {
    id: "fake",
    kitPackages: ["@fake/ui"],
    rules: [
      {
        id: "fake.rule",
        domain: "components",
        description: "правило тестовой дизайн-системы",
        severity: "warning",
        run: () => [],
      },
    ],
  } as unknown as KitAdapter;
  const fakeEntry: AdapterEntry = { name: "fake", version: "1.0.0", adapter: fakeAdapter };

  it("autodetects from the CURRENT directory's manifest", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "app", dependencies: { "@fake/ui": "^1" } }),
      "utf8",
    );
    const run = capture({ cwd: dir, env: isolated() });
    expect(await command([fakeEntry]).run(run.ctx)).toBe(0);

    const document = await readConfig(join(dir, CONFIG));
    expect(document.analyzer.uiKit).toBe("fake");
    expect(Object.keys(document.analyzer.rules)).toContain("fake.rule");
  });

  it("nothing matched: the generic rules, and a NOTE rather than a refusal", async () => {
    const run = capture({ cwd: dir, env: isolated() });
    expect(await command([fakeEntry]).run(run.ctx)).toBe(0);

    const document = await readConfig(join(dir, CONFIG));
    expect(document.analyzer.uiKit).toBeUndefined();
    expect(Object.keys(document.analyzer.rules)).not.toContain("fake.rule");
    // A WARNING since the UX redesign (§2.6's `!` gutter): the file is written, and the fact
    // that it lists only the generic rules is what a user may want to act on.
    expect(run.ui).toContain(`warn:${initConfigNoKit(adapterNames([fakeEntry])).ru}`);
  });

  it("--ui-kit none says nothing about a missing kit — it is a decision, not an absence", async () => {
    const run = capture({ cwd: dir, uiKit: "none", env: isolated() });
    expect(await command([fakeEntry]).run(run.ctx)).toBe(0);
    expect(run.ui.filter((line) => line.startsWith("note:"))).toEqual([]);
  });
});
