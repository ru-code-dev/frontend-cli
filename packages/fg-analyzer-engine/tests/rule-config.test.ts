import { describe, expect, it } from "vite-plus/test";

import {
  analyzeProject,
  applyRuleConfig,
  DEFAULT_RULE_CONFIG,
  isVisible,
  RULE_LEVELS,
  ruleCatalog,
  ruleConfigSchema,
  ruleLevelSchema,
  resolveLevel,
  type Finding,
  type FindingCategory,
  type KitAdapter,
  type RuleConfig,
  type RuleLevel,
  type Severity,
} from "../src/index.ts";
import { fixturePath } from "./fixtures.ts";

/**
 * The config layer: precedence, the view it applies, and the catalog it is written against.
 *
 * Two of these suites are contracts with code that is NOT in this package. `resolveLevel` and
 * `applyRuleConfig` are transcribed into the dashboard (which re-applies the config in the
 * browser when the reader flips a rule), and the catalog feeds `--init-config` and the
 * generated JSON Schema. So the assertions here are about SEMANTICS at the edges — key order,
 * prefix boundaries, prototype keys, identity — rather than about a happy path that any
 * implementation would pass.
 */

/** A finding with only the three fields the config addresses; the rest is inert filler. */
const findingOf = (
  rule: string,
  subkind: string | null,
  category: FindingCategory,
  severity: Severity = "warning",
): Finding => ({
  id: "f_0001",
  rule,
  subkind,
  category,
  severity,
  confidence: 1,
  file: "src/App.tsx",
  line: 1,
  column: 1,
  snippet: { before: "x", after: null, highlightLine: 1, startLine: 1 },
  actual: "x",
  expected: null,
  why: "почему",
  note: null,
  rootCause: null,
  appliedTo: null,
  a11y: null,
  autoFixable: false,
  needsAgent: false,
  candidates: [],
  impact: { occurrences: 1, files: 1 },
  impactKey: `${rule}:x`,
});

const configOf = (input: {
  default?: RuleLevel;
  categories?: Partial<Record<FindingCategory, RuleLevel>>;
  rules?: Record<string, RuleLevel>;
}): RuleConfig => ({
  default: input.default ?? "on",
  categories: input.categories ?? {},
  rules: input.rules ?? {},
  source: { kind: "defaults" },
});

describe("resolveLevel — the D7 precedence ladder", () => {
  const finding = findingOf("a11y.lint", "alt-text", "a11y");

  it("puts the four layers in order: subkind > rule > category > default", () => {
    const all = configOf({
      default: "candidate",
      categories: { a11y: "info" },
      rules: { "a11y.lint": "warning", "a11y.lint/alt-text": "error" },
    });

    // Each step removes the winner and the next layer down must take over — one assertion per
    // rung, so a broken ladder names the rung it broke on.
    expect(resolveLevel(finding, all)).toBe("error");
    expect(
      resolveLevel(
        finding,
        configOf({
          default: "candidate",
          categories: { a11y: "info" },
          rules: { "a11y.lint": "warning" },
        }),
      ),
    ).toBe("warning");
    expect(
      resolveLevel(finding, configOf({ default: "candidate", categories: { a11y: "info" } })),
    ).toBe("info");
    expect(resolveLevel(finding, configOf({ default: "candidate" }))).toBe("candidate");
    expect(resolveLevel(finding, DEFAULT_RULE_CONFIG)).toBe("on");
  });

  it("addresses a subkind only under its own rule", () => {
    const config = configOf({ rules: { "a11y.name.missing/alt-text": "off" } });

    // The key names another rule's subkind; `a11y.lint/alt-text` must be unaffected.
    expect(resolveLevel(finding, config)).toBe("on");
    expect(resolveLevel(findingOf("a11y.name.missing", "alt-text", "a11y"), config)).toBe("off");
  });

  it("ignores a subkind key for a finding whose subkind is null", () => {
    const config = configOf({ rules: { "component.duplicate/": "off" } });

    expect(resolveLevel(findingOf("component.duplicate", null, "component"), config)).toBe("on");
  });
});

describe("resolveLevel — exact, prefix and the boundary between them", () => {
  const repaint = findingOf("style.override.repaint", null, "override");

  it("prefers the exact id over a dot-prefix of it", () => {
    expect(
      resolveLevel(
        repaint,
        configOf({ rules: { "style.override": "off", "style.override.repaint": "error" } }),
      ),
    ).toBe("error");
  });

  it("prefers the LONGEST matching prefix, whatever order the keys were written in", () => {
    const general = configOf({ rules: { style: "off", "style.override": "warning" } });
    const reversed = configOf({ rules: { "style.override": "warning", style: "off" } });

    // JSON does not promise key order and a user must not have to think about it: the general
    // rule and its exception read the same whichever way round they were typed.
    expect(resolveLevel(repaint, general)).toBe("warning");
    expect(resolveLevel(repaint, reversed)).toBe("warning");
  });

  it("matches on a DOT boundary, never on a bare string prefix", () => {
    const config = configOf({ rules: { "token.literal": "off" } });

    expect(resolveLevel(findingOf("token.literal.color", null, "token"), config)).toBe("off");
    expect(resolveLevel(findingOf("token.literal", null, "token"), config)).toBe("off");
    // `token.literalism` merely starts with the key's characters — it is a different rule.
    expect(resolveLevel(findingOf("token.literalism", null, "token"), config)).toBe("on");
  });

  it("reads own keys only, so a rule named after an Object member resolves normally", () => {
    // `{}["toString"]` is a function, not `undefined` — an implementation that indexed the
    // record directly would return it as a level.
    expect(resolveLevel(findingOf("toString", null, "a11y"), configOf({ default: "info" }))).toBe(
      "info",
    );
    expect(
      resolveLevel(findingOf("constructor", "toString", "a11y"), configOf({ default: "info" })),
    ).toBe("info");
  });
});

describe("applyRuleConfig — the view over a finished run", () => {
  const findings: readonly Finding[] = [
    findingOf("a11y.lint", "alt-text", "a11y", "error"),
    findingOf("a11y.lint", "no-access-key", "a11y", "info"),
    findingOf("component.duplicate", null, "component", "candidate"),
  ];

  it("drops `off` and keeps input order", () => {
    const visible = applyRuleConfig(findings, configOf({ rules: { "a11y.lint": "off" } }));

    expect(visible.map((finding) => finding.rule)).toEqual(["component.duplicate"]);
    expect(applyRuleConfig(findings, configOf({ default: "off" }))).toEqual([]);
  });

  it("`on` keeps the rule's OWN severity, which varies per subkind", () => {
    const visible = applyRuleConfig(findings, configOf({ rules: { "a11y.lint": "on" } }));

    expect(visible.map((finding) => finding.severity)).toEqual(["error", "info", "candidate"]);
  });

  it("a severity level rewrites `severity` and nothing else", () => {
    const [first] = applyRuleConfig(findings, configOf({ categories: { a11y: "warning" } }));

    expect(first?.severity).toBe("warning");
    expect(first?.id).toBe("f_0001");
    expect(first?.impact).toEqual({ occurrences: 1, files: 1 });
    expect(first?.impactKey).toBe("a11y.lint:x");
    // Key order is load-bearing for the report's byte-comparison suites: the rewrite must
    // replace `severity` in place rather than append it.
    expect(Object.keys(first ?? {})).toEqual(Object.keys(findings[0] ?? {}));
  });

  it("passes an unchanged finding through BY IDENTITY", () => {
    const untouched = applyRuleConfig(findings, DEFAULT_RULE_CONFIG);
    const regraded = applyRuleConfig(findings, configOf({ rules: { "a11y.lint": "error" } }));

    expect(untouched[0]).toBe(findings[0]);
    expect(untouched[2]).toBe(findings[2]);
    // `alt-text` is already `error`, so naming that level changes nothing and must not copy.
    expect(regraded[0]).toBe(findings[0]);
    expect(regraded[1]).not.toBe(findings[1]);
    expect(regraded[2]).toBe(findings[2]);
  });

  it("isVisible agrees with resolveLevel on every level", () => {
    for (const level of RULE_LEVELS) {
      const config = configOf({ default: level });

      expect(isVisible(findings[0] as Finding, config)).toBe(level !== "off");
    }
  });
});

describe("analyzeProject({ ruleConfig }) — summary over visible, payload still raw", () => {
  it("keeps every raw finding and counts only the visible ones", async () => {
    const dir = fixturePath("dialog");
    const result = await analyzeProject({
      dir,
      ruleConfig: configOf({ rules: { "a11y.lint": "off" } }),
    });

    // The fixture produces three findings: two `a11y.lint` and one `a11y.pattern.focus`.
    expect(result.findings).toHaveLength(3);
    expect(result.findings.map((finding) => finding.rule)).toContain("a11y.lint");
    expect(result.suppressedCount).toBe(2);
    expect(result.summary.findings.total).toBe(1);
    expect(result.summary.findings.byRule).toEqual({ "a11y.pattern.focus": 1 });
    expect(result.summary.findings.byCategory).toEqual({ component: 0, icon: 0, a11y: 1 });
  });

  it("re-grades the summary without touching the raw finding's severity", async () => {
    const result = await analyzeProject({
      dir: fixturePath("dialog"),
      ruleConfig: configOf({ rules: { "a11y.pattern.focus": "info", "a11y.lint": "off" } }),
    });

    expect(result.summary.findings.bySeverity).toEqual({
      error: 0,
      warning: 0,
      info: 1,
      candidate: 0,
    });
    expect(result.findings.find((finding) => finding.rule === "a11y.pattern.focus")?.severity).toBe(
      "error",
    );
    expect(result.suppressedCount).toBe(2);
  });

  it("recounts clean files over the visible set", async () => {
    const dir = fixturePath("duplicates");
    const shown = await analyzeProject({ dir });
    const hidden = await analyzeProject({ dir, ruleConfig: configOf({ default: "off" }) });

    expect(shown.summary.files).toEqual({ scanned: 2, clean: 1 });
    expect(hidden.summary.files).toEqual({ scanned: 2, clean: 2 });
    expect(hidden.summary.findings.total).toBe(0);
    expect(hidden.findings).toHaveLength(1);
    expect(hidden.suppressedCount).toBe(1);
  });

  it("is bit-for-bit the old function when `ruleConfig` is omitted", async () => {
    const dir = fixturePath("dialog");
    const bare = await analyzeProject({ dir });
    const permissive = await analyzeProject({ dir, ruleConfig: DEFAULT_RULE_CONFIG });

    expect(bare.suppressedCount).toBeUndefined();
    expect("suppressedCount" in bare).toBe(false);
    expect(permissive.suppressedCount).toBe(0);
    // A config that hides nothing must produce the same payload plus the one new counter.
    expect(JSON.stringify({ ...permissive, suppressedCount: undefined })).toBe(
      JSON.stringify({ ...bare, suppressedCount: undefined }),
    );
  });
});

describe("ruleCatalog — derived from the registry that will run", () => {
  const engineCatalog = ruleCatalog();

  it("lists the engine's eleven rules, once each, in category-then-id order", () => {
    expect(engineCatalog).toHaveLength(11);
    expect(new Set(engineCatalog.map((entry) => entry.id)).size).toBe(11);
    expect(engineCatalog.map((entry) => entry.id)).toEqual([
      "component.duplicate",
      "icon.foreign-pack",
      "a11y.aria.invalid",
      "a11y.aria.redundant",
      "a11y.aria.required",
      "a11y.contrast.text",
      "a11y.focus.suppressed",
      "a11y.lint",
      "a11y.name.missing",
      "a11y.pattern.focus",
      "a11y.pattern.relations",
    ]);
    expect(engineCatalog.every((entry) => entry.origin === "engine")).toBe(true);
  });

  it("declares a real severity wherever the rule assigns one, `mixed` where it varies", () => {
    const byId = new Map(engineCatalog.map((entry) => [entry.id, entry.builtinSeverity]));

    expect(byId.get("a11y.name.missing")).toBe("error");
    expect(byId.get("a11y.aria.redundant")).toBe("info");
    expect(byId.get("icon.foreign-pack")).toBe("warning");
    expect(byId.get("component.duplicate")).toBe("candidate");
    // `a11y.contrast.text` grades by ratio, `a11y.lint` by sub-rule, `a11y.aria.invalid` and
    // `a11y.pattern.relations` by branch — all four must say so rather than pick one.
    expect(byId.get("a11y.contrast.text")).toBe("mixed");
    expect(byId.get("a11y.lint")).toBe("mixed");
    expect(byId.get("a11y.aria.invalid")).toBe("mixed");
    expect(byId.get("a11y.pattern.relations")).toBe("mixed");
    expect(
      engineCatalog.every(
        (entry) =>
          entry.builtinSeverity === "mixed" ||
          ruleLevelSchema.safeParse(entry.builtinSeverity).success,
      ),
    ).toBe(true);
  });

  it("carries `a11y.lint`'s sub-rules, read off RULE_META and sorted", () => {
    const lint = engineCatalog.find((entry) => entry.id === "a11y.lint");
    const ids = lint?.subrules.map((subrule) => subrule.id) ?? [];

    expect(ids).toHaveLength(30);
    expect([...ids].toSorted()).toEqual(ids);
    expect(ids).toContain("alt-text");
    expect(ids).toContain("prefer-tag-over-role");
    expect(lint?.subrules.find((subrule) => subrule.id === "alt-text")?.severity).toBe("error");
    expect(lint?.subrules.find((subrule) => subrule.id === "no-access-key")?.severity).toBe("info");
    expect(lint?.subrules.every((subrule) => subrule.description.length > 0)).toBe(true);
    // Every other rule's `subkind` is an open value (a component name, a role) and cannot be
    // enumerated, so nothing else may claim sub-rules.
    expect(
      engineCatalog.filter((entry) => entry.subrules.length > 0).map((entry) => entry.id),
    ).toEqual(["a11y.lint"]);
  });

  /**
   * THE LABEL LAW (UX design §4): every catalog row carries a short name in both languages,
   * because the compact formatter prints one on every finding row and a missing label would
   * surface as a nameless line in a user's terminal rather than as a failure here.
   *
   * The length bound is a layout constraint, not taste: §2.4 gives the row `actual` (≤ 60) +
   * two spaces + the label + the rule id, and a label longer than 40 columns pushes the id off
   * an 80-column terminal.
   */
  const LABEL_LIMIT = 40;

  it("names every rule in both languages, short enough for one terminal row", () => {
    for (const entry of engineCatalog) {
      expect(entry.label.ru.trim()).toBe(entry.label.ru);
      expect(entry.label.en.trim()).toBe(entry.label.en);
      expect(entry.label.ru.length).toBeGreaterThan(0);
      expect(entry.label.en.length).toBeGreaterThan(0);
      // A label is a noun phrase, not a sentence.
      expect(entry.label.ru.endsWith(".")).toBe(false);
      expect(entry.label.en.endsWith(".")).toBe(false);
      expect([...entry.label.en].length).toBeLessThanOrEqual(LABEL_LIMIT);
      // NO EXEMPTION any more. `a11y.pattern.focus` used to be one at 41 code points, on the
      // reasoning that byte-identity with the dashboard's `RULE_LABEL` was worth a column
      // (V5 finding #17). Both were shortened together instead — the identity is intact, and
      // the bound is now a bound.
      expect(`${entry.id}: ${[...entry.label.ru].length}`).toBe(
        `${entry.id}: ${Math.min([...entry.label.ru].length, LABEL_LIMIT)}`,
      );
    }

    // Distinct: two rules sharing a label would print two different problems under one name.
    expect(new Set(engineCatalog.map((entry) => entry.label.ru)).size).toBe(engineCatalog.length);
    expect(new Set(engineCatalog.map((entry) => entry.label.en)).size).toBe(engineCatalog.length);
  });

  it("names each of `a11y.lint`'s thirty sub-rules for itself", () => {
    const lint = engineCatalog.find((entry) => entry.id === "a11y.lint");
    const subrules = lint?.subrules ?? [];

    expect(subrules).toHaveLength(30);
    for (const subrule of subrules) {
      expect(subrule.label.ru.length).toBeGreaterThan(0);
      expect(subrule.label.en.length).toBeGreaterThan(0);
      expect([...subrule.label.ru].length).toBeLessThanOrEqual(LABEL_LIMIT);
      expect([...subrule.label.en].length).toBeLessThanOrEqual(LABEL_LIMIT);
      expect(subrule.label.ru.endsWith(".")).toBe(false);
      expect(subrule.label.en.endsWith(".")).toBe(false);
      // The parent's label — «Базовое правило доступности» — is what a sub-rule must NOT be.
      expect(subrule.label.ru).not.toBe(lint?.label.ru);
    }
    expect(new Set(subrules.map((subrule) => subrule.label.ru)).size).toBe(30);
    expect(new Set(subrules.map((subrule) => subrule.label.en)).size).toBe(30);
    expect(subrules.find((subrule) => subrule.id === "alt-text")?.label).toEqual({
      ru: "Изображение без alt",
      en: "Image without alt",
    });
  });

  it("lists a rule's EMITTED ids instead of its own, and honours `replaces`", () => {
    // Shaped exactly like EDS's `style.override` / `component.novel` pair, which is the case
    // this branch exists for; the real adapter lives downstream of this package and cannot be
    // imported here without a dependency cycle.
    const adapter = {
      id: "fake-kit",
      kitPackages: [],
      replaces: ["component.duplicate"],
      rules: [
        {
          id: "style.override",
          category: "override" as const,
          description: "четыре вердикта",
          label: { ru: "Стилизация снаружи", en: "Styled from outside" },
          severity: "mixed" as const,
          emits: [
            {
              id: "style.override.repaint",
              description: "перекраска",
              label: { ru: "Перекраска", en: "Repaint" },
              severity: "warning" as const,
            },
            {
              id: "style.override.size",
              description: "размеры",
              label: { ru: "Размеры", en: "Size" },
              severity: "info" as const,
            },
          ],
          run: () => [],
        },
        {
          id: "component.novel",
          category: "component" as const,
          description: "кандидат",
          label: { ru: "Кандидат", en: "Candidate" },
          severity: "candidate" as const,
          emits: [
            {
              id: "component.novel",
              description: "кандидат",
              label: { ru: "Кандидат", en: "Candidate" },
              severity: "candidate" as const,
            },
            {
              id: "component.duplicate",
              description: "дубль",
              label: { ru: "Дубль", en: "Duplicate" },
              severity: "candidate" as const,
            },
          ],
          run: () => [],
        },
        // Declares NOTHING beyond the four required fields — the shape an adapter written
        // against the old `Rule` interface still has. It must appear in the catalog, and it
        // must appear as `mixed`, because "we do not know" is the only honest answer.
        {
          id: "token.mystery",
          category: "token" as const,
          description: "?",
          label: { ru: "Загадка", en: "Mystery" },
          run: () => [],
        },
      ],
    } as unknown as KitAdapter;

    const catalog = ruleCatalog(adapter);
    const ids = catalog.map((entry) => entry.id);

    // 11 engine rules − 1 replaced + 2 + 2 emitted + 1 bare = 15, and `component.duplicate`
    // appears exactly once even though both the engine and the adapter can produce it.
    expect(catalog).toHaveLength(15);
    expect(new Set(ids).size).toBe(15);
    // An adapter rule that declares no `severity` is `mixed`, never a guess.
    expect(catalog.find((entry) => entry.id === "token.mystery")?.builtinSeverity).toBe("mixed");
    expect(catalog.find((entry) => entry.id === "token.mystery")?.subrules).toEqual([]);
    expect(ids.filter((id) => id === "component.duplicate")).toHaveLength(1);
    expect(ids).not.toContain("style.override");
    expect(ids).toContain("style.override.repaint");
    expect(catalog.find((entry) => entry.id === "style.override.size")?.builtinSeverity).toBe(
      "info",
    );
    expect(catalog.find((entry) => entry.id === "style.override.size")?.origin).toBe("fake-kit");
    // Each emitted id is named for itself: one label over four `style.override.*` rows would
    // make the console say the same thing about a repaint and an `!important`.
    expect(catalog.find((entry) => entry.id === "style.override.repaint")?.label).toEqual({
      ru: "Перекраска",
      en: "Repaint",
    });
    expect(catalog.find((entry) => entry.id === "style.override.size")?.label).toEqual({
      ru: "Размеры",
      en: "Size",
    });
    expect(catalog.find((entry) => entry.id === "component.duplicate")?.origin).toBe("fake-kit");
    expect(catalog.find((entry) => entry.id === "a11y.lint")?.origin).toBe("engine");
    // `override` precedes `component` in the category enum, so the emitted override rows sort
    // ahead of the component ones however the registry was ordered.
    expect(ids.indexOf("style.override.repaint")).toBeLessThan(ids.indexOf("component.novel"));
  });

  it("makes every catalog id addressable by the config it was built for", () => {
    for (const entry of engineCatalog) {
      const finding = findingOf(entry.id, null, entry.category);

      expect(resolveLevel(finding, configOf({ rules: { [entry.id]: "off" } }))).toBe("off");
    }
  });
});

describe("the schemas the CLI parses a config file with", () => {
  it("accepts exactly the six levels", () => {
    expect(RULE_LEVELS).toEqual(["off", "on", "error", "warning", "info", "candidate"]);
    for (const level of RULE_LEVELS) {
      expect(ruleLevelSchema.safeParse(level).success).toBe(true);
    }
    expect(ruleLevelSchema.safeParse("ON").success).toBe(false);
    expect(ruleLevelSchema.safeParse("fatal").success).toBe(false);
    expect(ruleLevelSchema.safeParse(2).success).toBe(false);
  });

  it("round-trips a resolved config and rejects an unknown category or level", () => {
    const config: RuleConfig = {
      default: "on",
      categories: { a11y: "error", token: "off" },
      rules: { "a11y.lint/alt-text": "warning" },
      source: { kind: "file", path: "/tmp/fg.config.json" },
    };

    expect(ruleConfigSchema.parse(config)).toEqual(config);
    expect(ruleConfigSchema.safeParse(DEFAULT_RULE_CONFIG).success).toBe(true);
    expect(ruleConfigSchema.safeParse({ ...config, categories: { nope: "on" } }).success).toBe(
      false,
    );
    expect(ruleConfigSchema.safeParse({ ...config, rules: { x: "loud" } }).success).toBe(false);
    expect(ruleConfigSchema.safeParse({ ...config, source: { kind: "file" } }).success).toBe(false);
  });

  it("keeps DEFAULT_RULE_CONFIG permissive and immutable", () => {
    expect(DEFAULT_RULE_CONFIG).toEqual({
      default: "on",
      categories: {},
      rules: {},
      source: { kind: "defaults" },
    });
    expect(Object.isFrozen(DEFAULT_RULE_CONFIG)).toBe(true);
    expect(resolveLevel(findingOf("anything.at.all", null, "a11y"), DEFAULT_RULE_CONFIG)).toBe(
      "on",
    );
  });
});
