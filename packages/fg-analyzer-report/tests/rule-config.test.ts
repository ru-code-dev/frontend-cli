/**
 * THE CONFIG, END TO END THROUGH THIS PACKAGE: contract → payload → HTML → back.
 *
 * Four things have to hold for the rule panel to be honest, and none of them is provable by
 * looking at the dashboard source:
 *
 *  1. A caller that never heard of rule config still gets a valid payload — the identity config
 *     and an empty catalog, never a missing key the dashboard would index into.
 *  2. The config survives embedding. Its `source.path` is an arbitrary filesystem path, which
 *     makes it the one string in the payload a user can put `</script>` into on purpose.
 *  3. The `cfg` URL parameter round-trips, and degrades instead of exploding on a hand-edited
 *     link. A shared report link that renders blank because somebody trimmed a character is
 *     worse than one that quietly ignores the trimmed part.
 *  4. Every rule the catalog can list has a Russian name. A panel of thirty-two dotted
 *     identifiers is a config file with extra steps.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ruleCatalog, type RuleConfig } from "@smart-tools/fg-analyzer-engine";
import { describe, expect, it } from "vite-plus/test";

import {
  CATEGORY_LABEL,
  FROM_FILE_LABEL,
  LEVEL_LABEL,
  RULE_LABEL,
  configNote,
  ruleLabel,
} from "../dashboard/src/data.js";
import {
  CATEGORIES,
  DEFAULT_RULE_CONFIG as BROWSER_DEFAULT_RULE_CONFIG,
  EMPTY_OVERRIDES,
  INHERIT_OPTION,
  RULE_LEVELS,
  catalogByCategory,
  mergeConfig,
  overrideCount,
  parseOverrides,
  serialiseOverrides,
  tallyFindings,
  withOverride,
  type RuleOverrides,
} from "../dashboard/src/lib/rule-config.js";
import {
  EMPTY,
  activeFilters,
  parseViewState,
  serialiseViewState,
} from "../dashboard/src/lib/url-params.js";
import { DEFAULT_RULE_CONFIG, payloadOf, renderReport, type ReportPayload } from "../src/index.ts";
import { builtTemplate, minimalFinding, packageRoot, resultOf } from "./support.ts";

const SLOT = /<script type="application\/json" id="ds-data">([\s\S]*?)<\/script>/;

const readBack = (html: string): ReportPayload => {
  const match = SLOT.exec(html);
  if (match?.[1] === undefined) {
    throw new Error("rendered report has no ds-data slot");
  }
  return JSON.parse(match[1]) as ReportPayload;
};

/**
 * The 32 finding-level ids `ruleCatalog(createEdsAdapter())` produces, verified and listed by
 * A1 (`WORKFLOW/features/rule-config/reports/a1-engine-rule-config.md` §5) and confirmed as the
 * binding number by the design's §9 amendment.
 *
 * Written out rather than computed because `@smart-tools/fg-eds-adapter` is NOT a dependency of
 * this package and the manifests are frozen for this wave — so the list is the fact under test,
 * and what the test proves is that the dashboard has a Russian label for every one of them. A1
 * flagged the missing automated assertion of the number ITSELF as work for a package that
 * depends on both (its §9.1); this is not that assertion and does not claim to be.
 */
const EDS_CATALOG_IDS: readonly string[] = [
  "token.literal.color",
  "token.literal.dimension",
  "token.tier.violation",
  "token.typography.partial",
  "font.foreign",
  "api.deprecated",
  "api.dnu",
  "import.bypass",
  "import.internal",
  "prop.invalid",
  "style.override.important",
  "style.override.inner",
  "style.override.repaint",
  "style.override.size",
  "component.ambiguous",
  "component.custom",
  "component.duplicate",
  "component.fork",
  "component.novel",
  "icon.foreign-file",
  "icon.foreign-pack",
  "icon.inline-svg",
  "a11y.aria.invalid",
  "a11y.aria.redundant",
  "a11y.aria.required",
  "a11y.contrast.text",
  "a11y.focus.suppressed",
  "a11y.lint",
  "a11y.name.missing",
  "a11y.pattern.focus",
  "a11y.pattern.keyboard",
  "a11y.pattern.relations",
];

describe("payloadOf and the rule config", () => {
  it("gives a caller that never heard of rule config a valid, permissive payload", () => {
    const payload = payloadOf(resultOf([minimalFinding]), { generatedAt: "2026-09-08" });

    expect(payload.ruleConfig).toEqual({
      default: "on",
      categories: {},
      rules: {},
      source: { kind: "defaults" },
    });
    expect(payload.ruleCatalog).toEqual([]);
  });

  it("carries the caller's config and catalog through verbatim", () => {
    const config: RuleConfig = {
      default: "off",
      categories: { a11y: "error" },
      rules: { "style.override": "info" },
      source: { kind: "file", path: "/repo/fg.config.json" },
    };
    const catalog = ruleCatalog();

    const payload = payloadOf(resultOf([minimalFinding]), {
      generatedAt: "2026-09-08",
      ruleConfig: config,
      ruleCatalog: catalog,
    });

    expect(payload.ruleConfig).toEqual(config);
    expect(payload.ruleCatalog).toEqual(catalog);
    // Design D11: the config never touches the findings on the way into the payload, even a
    // config that hides all of them.
    expect(payload.findings).toHaveLength(1);
  });

  it("accepts the engine's `suppressedCount` without putting it in the payload", () => {
    const payload = payloadOf(
      { ...resultOf([minimalFinding]), suppressedCount: 4 },
      { generatedAt: "2026-09-08" },
    );

    expect("suppressedCount" in payload).toBe(false);
  });

  it("hands out a DEFAULT_RULE_CONFIG nobody can corrupt for the next caller", () => {
    expect(() => {
      (DEFAULT_RULE_CONFIG as { default: string }).default = "off";
    }).toThrow(TypeError);
    expect(DEFAULT_RULE_CONFIG.default).toBe("on");
    // The dashboard's copy is a different object with the same content, by design (§5.1).
    expect(BROWSER_DEFAULT_RULE_CONFIG).toEqual(DEFAULT_RULE_CONFIG);
  });
});

describe("the config survives the trip into the HTML file", () => {
  it("round-trips through the real template", () => {
    const config: RuleConfig = {
      default: "warning",
      categories: { icon: "off" },
      rules: { "a11y.lint/alt-text": "error" },
      source: { kind: "file", path: "/repo/fg.config.json" },
    };
    const payload = payloadOf(resultOf([minimalFinding]), {
      generatedAt: "2026-09-08",
      ruleConfig: config,
      ruleCatalog: ruleCatalog(),
    });
    const back = readBack(renderReport(payload, builtTemplate()));

    expect(back.ruleConfig).toEqual(config);
    expect(back.ruleCatalog).toHaveLength(ruleCatalog().length);
  });

  it("survives a `</script>` inside the config path — the file still parses as one document", () => {
    // The path is user-supplied (`--config <path>`) and is the only place in the payload where
    // an arbitrary string reaches the reader through the config rather than through a snippet.
    const path = "/repo/</script><script>alert(1)</script>/fg.config.json";
    const html = renderReport(
      payloadOf(resultOf([minimalFinding]), {
        generatedAt: "2026-09-08",
        ruleConfig: { ...DEFAULT_RULE_CONFIG, source: { kind: "file", path } },
      }),
      builtTemplate(),
    );

    expect(html).not.toContain("</script><script>alert(1)");
    expect(readBack(html).ruleConfig.source).toEqual({ kind: "file", path });
  });
});

describe("the built dashboard ships the rule panel", () => {
  for (const marker of [
    "Правила",
    "сбросить к файлу",
    "встроенные значения по умолчанию",
    "наследует",
    "По умолчанию",
    "по конфигу файла",
  ]) {
    it(`shows «${marker}»`, () => {
      expect(builtTemplate()).toContain(marker);
    });
  }

  for (const label of Object.values(LEVEL_LABEL)) {
    it(`offers the level «${label}» in its dropdowns`, () => {
      expect(builtTemplate()).toContain(label);
    });
  }
});

describe("the `cfg` URL parameter", () => {
  const OVERRIDES: RuleOverrides = {
    default: "on",
    categories: { a11y: "off", token: "warning" },
    rules: { "token.literal.color": "warning", "a11y.lint/alt-text": "on" },
  };

  it("serialises to the readable form the design specifies", () => {
    expect(serialiseOverrides(OVERRIDES)).toBe(
      "*:on;@token:warning;@a11y:off;a11y.lint/alt-text:on;token.literal.color:warning",
    );
  });

  it("round-trips through the string and through the whole view state", () => {
    expect(parseOverrides(serialiseOverrides(OVERRIDES))).toEqual(OVERRIDES);

    const state = { ...EMPTY, screen: "problems" as const, overrides: OVERRIDES };
    expect(parseViewState(serialiseViewState(state))).toEqual(state);
  });

  it("keeps `cfg` out of the URL when the reader has changed nothing", () => {
    expect(serialiseOverrides(EMPTY_OVERRIDES)).toBe("");
    expect(serialiseViewState(EMPTY)).toBe("");
    expect(parseViewState("").overrides).toEqual(EMPTY_OVERRIDES);
  });

  it("is deterministic — the same flips in a different order give the same link", () => {
    const other: RuleOverrides = {
      default: "on",
      categories: { token: "warning", a11y: "off" },
      rules: { "a11y.lint/alt-text": "on", "token.literal.color": "warning" },
    };

    expect(serialiseOverrides(other)).toBe(serialiseOverrides(OVERRIDES));
  });

  it("drops what it cannot read and keeps the rest, rather than blanking the report", () => {
    const parsed = parseOverrides(
      "@a11y:off;@nosuch:off;rule.without.level;x.y:shouty;*:candidate",
    );

    expect(parsed).toEqual({
      default: "candidate",
      categories: { a11y: "off" },
      rules: {},
    });
  });

  it("shows exactly one chip for the whole config, counting the flips", () => {
    const crumbs = activeFilters({ ...EMPTY, overrides: OVERRIDES });

    expect(crumbs).toEqual([{ key: "overrides", label: "правила", value: "изменены (5)" }]);
    expect(overrideCount(OVERRIDES)).toBe(5);
    expect(activeFilters(EMPTY)).toEqual([]);
  });

  it("survives a reset of every FILTER, because it is not one", () => {
    // `navigate`/`reset` rebuild the state from `EMPTY`; the hook carries `overrides` across.
    // Asserted here on the shape those two functions produce.
    const after = { ...EMPTY, overrides: OVERRIDES, screen: "files" as const };

    expect(after.overrides).toEqual(OVERRIDES);
    expect(activeFilters(after)).toHaveLength(1);
  });
});

describe("merging the reader's flips onto the file's config", () => {
  const file: RuleConfig = {
    default: "on",
    categories: { a11y: "off", token: "error" },
    rules: { "style.override": "off" },
    source: { kind: "file", path: "/repo/fg.config.json" },
  };

  it("overrides layer by layer and never renames the file it came from", () => {
    const merged = mergeConfig(file, {
      default: "warning",
      categories: { a11y: "on" },
      rules: { "style.override.important": "error" },
    });

    expect(merged).toEqual({
      default: "warning",
      categories: { a11y: "on", token: "error" },
      rules: { "style.override": "off", "style.override.important": "error" },
      source: { kind: "file", path: "/repo/fg.config.json" },
    });
  });

  it("is the file's config exactly when the reader has changed nothing", () => {
    expect(mergeConfig(file, EMPTY_OVERRIDES)).toEqual(file);
  });

  it("never mutates the overrides it is handed", () => {
    const before: RuleOverrides = { categories: {}, rules: {} };
    const next = withOverride(before, { kind: "rule", id: "icon.inline-svg" }, "off");

    expect(before).toEqual({ categories: {}, rules: {} });
    expect(next.rules).toEqual({ "icon.inline-svg": "off" });
    expect(withOverride(next, { kind: "default" }, "off").default).toBe("off");
    expect(withOverride(next, { kind: "category", id: "icon" }, "info").categories).toEqual({
      icon: "info",
    });
  });
});

describe("what the panel counts and lists", () => {
  const findings = [
    { rule: "a11y.lint", subkind: "alt-text", category: "a11y" as const },
    { rule: "a11y.lint", subkind: "no-autofocus", category: "a11y" as const },
    { rule: "icon.inline-svg", subkind: null, category: "icon" as const },
  ];

  it("counts what is hidden as well as what is shown, per category, rule and sub-rule", () => {
    const tally = tallyFindings(findings, {
      default: "on",
      categories: {},
      rules: { "a11y.lint/alt-text": "off" },
      source: { kind: "defaults" },
    });

    expect(tally.byCategory.get("a11y")).toEqual({ visible: 1, hidden: 1 });
    expect(tally.byRule.get("a11y.lint")).toEqual({ visible: 1, hidden: 1 });
    expect(tally.bySubrule.get("a11y.lint/alt-text")).toEqual({ visible: 0, hidden: 1 });
    expect(tally.bySubrule.get("a11y.lint/no-autofocus")).toEqual({ visible: 1, hidden: 0 });
    expect(tally.byCategory.get("icon")).toEqual({ visible: 1, hidden: 0 });
  });

  it("still lists a rule the catalog forgot, so no finding is unreachable from the panel", () => {
    const grouped = catalogByCategory([], findings);

    expect(grouped.get("a11y")?.map((entry) => entry.id)).toEqual(["a11y.lint"]);
    expect(grouped.get("icon")?.map((entry) => entry.id)).toEqual(["icon.inline-svg"]);
    // Every category gets a bucket, so the panel draws all eight rows either way.
    expect([...grouped.keys()]).toEqual([...CATEGORIES]);
  });

  it("groups the engine's own catalog into its categories, sorted", () => {
    const grouped = catalogByCategory(ruleCatalog(), []);

    expect(grouped.get("a11y")?.map((entry) => entry.id)).toEqual([
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
    expect(grouped.get("icon")?.map((entry) => entry.id)).toEqual(["icon.foreign-pack"]);
    expect(grouped.get("token")).toEqual([]);
  });
});

describe("the reader-facing vocabulary covers the whole catalog", () => {
  it("names every rule the engine can list", () => {
    const missing = ruleCatalog()
      .map((entry) => entry.id)
      .filter((id) => RULE_LABEL[id] === undefined);

    expect(missing).toEqual([]);
  });

  it("names every rule the EDS catalog can list — all 32 of them", () => {
    expect(EDS_CATALOG_IDS).toHaveLength(32);
    expect(EDS_CATALOG_IDS.filter((id) => RULE_LABEL[id] === undefined)).toEqual([]);
    // And no label is a copy of the id, which is what `ruleLabel` falls back to.
    expect(EDS_CATALOG_IDS.filter((id) => ruleLabel(id) === id)).toEqual([]);
  });

  it("carries `a11y.lint`'s 30 sub-rules, which the panel addresses individually", () => {
    const lint = ruleCatalog().find((entry) => entry.id === "a11y.lint");

    expect(lint?.subrules).toHaveLength(30);
    expect(lint?.builtinSeverity).toBe("mixed");
  });

  it("names all six levels and all eight categories", () => {
    expect(Object.keys(LEVEL_LABEL).toSorted()).toEqual([...RULE_LEVELS].toSorted());
    expect(Object.keys(CATEGORY_LABEL).toSorted()).toEqual([...CATEGORIES].toSorted());
    // `on` must not be described as a severity: for `a11y.lint` it is thirty different ones.
    expect(LEVEL_LABEL.on).not.toBe(LEVEL_LABEL.error);
  });

  it("says which config an un-recountable number was computed under, truthfully", () => {
    expect(configNote({ ...DEFAULT_RULE_CONFIG, source: { kind: "file", path: "/x" } })).toBe(
      "по конфигу файла",
    );
    // V4 audit finding 2: with no config file there is nothing to say, and saying it anyway put
    // a note on a line that never had one.
    expect(configNote(DEFAULT_RULE_CONFIG)).toBe("");
  });
});

/* ── V4 audit fixes (F2) ─────────────────────────────────────────────────────────────────── */

/**
 * AUDIT FINDING 7, and the only one of the six with no behavioural test to write: an incomplete
 * `useMemo` dependency array is invisible until the omitted value can change, and `payload` is a
 * module-level binding assigned once at import, so today it cannot. A renderer test would
 * therefore pass either way, and the lint config carries no react-hooks plugin
 * (`.oxlintrc.json`). What CAN be asserted is the property itself — the array names what the
 * memo reads — which is what would break the day somebody moves the payload into state.
 */
describe("configuredPayload's memo lists every value it reads (audit finding 7)", () => {
  it("names `payload` in its dependency array", () => {
    const source = readFileSync(join(packageRoot, "dashboard", "src", "App.tsx"), "utf8");
    const memo = /const configuredPayload = useMemo\(\(\) => \{[\s\S]*?\}, \[([^\]]*)\]\);/u.exec(
      source,
    );
    expect(memo?.[1]).toBeTypeOf("string");
    const deps = (memo?.[1] ?? "").split(",").map((name) => name.trim());
    expect(deps).toEqual(["payload", "effectiveConfig"]);
  });
});

describe("«как в файле» removes a row's override (audit finding 3)", () => {
  /** The audit's own repro: a file that already says `icon: on`. */
  const fileConfig: RuleConfig = {
    default: "on",
    categories: { icon: "on" },
    rules: {},
    source: { kind: "file", path: "/repo/fg.config.json" },
  };

  it("picking the file's own value is undone by it, leaving zero overrides", () => {
    // What the reader could do before: re-pick the level already in force. Still possible, and
    // still recorded — that is a deliberate choice the panel has no business second-guessing.
    const picked = withOverride(EMPTY_OVERRIDES, { kind: "category", id: "icon" }, "on");
    expect(overrideCount(picked)).toBe(1);
    expect(serialiseOverrides(picked)).toBe("@icon:on");

    // …and «как в файле» is the way back, per row.
    const back = withOverride(picked, { kind: "category", id: "icon" }, INHERIT_OPTION);
    expect(overrideCount(back)).toBe(0);
    expect(serialiseOverrides(back)).toBe("");
    expect(mergeConfig(fileConfig, back)).toEqual(fileConfig);
  });

  it("removes at every scope, and round-trips through `cfg` on the way", () => {
    let overrides = withOverride(EMPTY_OVERRIDES, { kind: "default" }, "off");
    overrides = withOverride(overrides, { kind: "category", id: "a11y" }, "error");
    overrides = withOverride(overrides, { kind: "rule", id: "a11y.lint/alt-text" }, "info");
    expect(serialiseOverrides(overrides)).toBe("*:off;@a11y:error;a11y.lint/alt-text:info");

    // Through the URL and back — the removal has to work on the parsed object too, which is
    // what a reader who opened a shared link is holding.
    const parsed = parseOverrides(serialiseOverrides(overrides));
    expect(parsed).toEqual(overrides);

    let cleared = withOverride(parsed, { kind: "rule", id: "a11y.lint/alt-text" }, INHERIT_OPTION);
    expect(serialiseOverrides(cleared)).toBe("*:off;@a11y:error");
    cleared = withOverride(cleared, { kind: "category", id: "a11y" }, INHERIT_OPTION);
    expect(serialiseOverrides(cleared)).toBe("*:off");
    cleared = withOverride(cleared, { kind: "default" }, INHERIT_OPTION);
    expect(serialiseOverrides(cleared)).toBe("");
    expect(overrideCount(cleared)).toBe(0);
    // `cfg` is dropped from the URL entirely, so the link is the plain report again.
    expect(cleared).toEqual(EMPTY_OVERRIDES);
  });

  it("is a no-op on a row that has no override, at every scope", () => {
    for (const target of [
      { kind: "default" } as const,
      { kind: "category", id: "icon" } as const,
      { kind: "rule", id: "a11y.lint" } as const,
    ]) {
      expect(withOverride(EMPTY_OVERRIDES, target, INHERIT_OPTION)).toEqual(EMPTY_OVERRIDES);
    }
    // …and it leaves its neighbours alone.
    const one = withOverride(EMPTY_OVERRIDES, { kind: "rule", id: "icon.foreign-pack" }, "off");
    expect(withOverride(one, { kind: "rule", id: "a11y.lint" }, INHERIT_OPTION)).toEqual(one);
  });

  it("ships in the built dashboard as the first option of every level select", () => {
    expect(FROM_FILE_LABEL).toBe("как в файле");
    // `includes` rather than `toContain`: a failure here would otherwise print the whole
    // 3 MB template as a diff.
    expect(builtTemplate().includes(FROM_FILE_LABEL)).toBe(true);
  });
});
