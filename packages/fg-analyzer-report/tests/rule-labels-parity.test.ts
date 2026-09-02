/**
 * THE CONSOLE AND THE HTML REPORT MUST NAME A FINDING THE SAME WAY.
 *
 * Two independent tables used to exist: the dashboard's `RULE_LABEL`
 * (`dashboard/src/data.ts`), which is what a reader sees in the browser, and — since the UX
 * redesign (`WORKFLOW/features/cli-ux/plans/ux-design.md` §4) — `Rule.label`, which is what
 * `--format compact` prints on every row of the terminal. A user who runs `fg --preport
 * --format compact`, fixes half the findings and then opens the HTML report is reading two
 * renderings of ONE analysis: a rule called «Импорт в обход кита» on one screen and something
 * else on the other is not a cosmetic difference, it is two vocabularies for one project.
 *
 * So this suite pins the pair, in both directions:
 *
 *   1. every id the RULE CATALOG can produce has a `RULE_LABEL` entry, and
 *   2. that entry is CHARACTER-IDENTICAL to the catalog's `label.ru`.
 *
 * WHY THE EDS HALF IS BUILT FROM THE RULE FACTORIES. `@smart-tools/fg-eds-adapter` is not a
 * dependency of this package and the manifests are frozen for this wave, so
 * `ruleCatalog(createEdsAdapter())` — the call that produces all 32 finding-level ids — cannot
 * be made here. The existing suite (`tests/rule-config.test.ts`) writes the 32 ids out by hand
 * for that reason. A hand-written copy of the LABELS would be worse than no test at all: it
 * would pin the dashboard against a transcription instead of against the rules, and a rule
 * whose label changed would leave both the transcription and the dashboard stale together. The
 * factories are therefore imported from source by relative path and called with a kit context
 * they never touch while being constructed — every label below is the object the engine will
 * actually put in the catalog, not a copy of it.
 */
import { ruleCatalog, type RuleLabel } from "@smart-tools/fg-analyzer-engine";
import { describe, expect, it } from "vite-plus/test";

import { patternKeyboardRule } from "../../fg-eds-adapter/src/rules/a11y/pattern-keyboard.ts";
import {
  bypassImportRule,
  doNotUseImportRule,
  internalImportRule,
} from "../../fg-eds-adapter/src/rules/api/imports.ts";
import { styleOverrideRule } from "../../fg-eds-adapter/src/rules/api/overrides.ts";
import { deprecatedApiRule, invalidPropRule } from "../../fg-eds-adapter/src/rules/api/props.ts";
import {
  customComponentRule,
  novelComponentRule,
} from "../../fg-eds-adapter/src/rules/components/custom.ts";
import { foreignSvgFileRule, inlineSvgRule } from "../../fg-eds-adapter/src/rules/icons/icons.ts";
import type { KitContext } from "../../fg-eds-adapter/src/rules/kit-context.ts";
import { colorLiteralRule } from "../../fg-eds-adapter/src/rules/tokens/color.ts";
import { dimensionLiteralRule } from "../../fg-eds-adapter/src/rules/tokens/dimension.ts";
import { foreignFontRule } from "../../fg-eds-adapter/src/rules/tokens/font.ts";
import { tierViolationRule } from "../../fg-eds-adapter/src/rules/tokens/tier.ts";
import { partialTypographyRule } from "../../fg-eds-adapter/src/rules/tokens/typography.ts";
import { RULE_LABEL, SUBKIND_LABEL, ruleLabel, subkindLabel } from "../dashboard/src/data.js";

/**
 * The four kit facades, absent.
 *
 * Every EDS rule is a factory that CLOSES OVER its kit and reads it inside `run` — never while
 * the rule object is being built. Constructing the sixteen with nothing therefore yields real
 * rule objects with real ids, `emits` and labels, and never asks the disk for a corpus. A
 * factory that started reading its kit at construction time would throw here, which is a
 * property worth failing on rather than working around.
 */
const NO_KIT = {} as KitContext;

const EDS_RULES = [
  patternKeyboardRule(NO_KIT),
  bypassImportRule(NO_KIT),
  internalImportRule(NO_KIT),
  doNotUseImportRule(NO_KIT),
  styleOverrideRule(NO_KIT),
  invalidPropRule(NO_KIT),
  deprecatedApiRule(NO_KIT),
  customComponentRule(NO_KIT),
  novelComponentRule(NO_KIT),
  inlineSvgRule(NO_KIT),
  foreignSvgFileRule(NO_KIT),
  colorLiteralRule(NO_KIT),
  dimensionLiteralRule(NO_KIT),
  foreignFontRule(NO_KIT),
  tierViolationRule(NO_KIT),
  partialTypographyRule(NO_KIT),
];

/**
 * Finding-level id → label, exactly as `config/catalog.ts` derives it: a rule that declares
 * `emits` is listed under THOSE ids with THEIR labels, otherwise under its own.
 *
 * `component.duplicate` is produced by both halves — the engine's split-out clustering rule and
 * EDS's `component.novel`, which `replaces` it — so the merge asserts they agree rather than
 * letting whichever ran last win silently.
 */
const catalogLabels = (): ReadonlyMap<string, RuleLabel> => {
  const labels = new Map<string, RuleLabel>();
  const add = (id: string, label: RuleLabel): void => {
    const existing = labels.get(id);
    if (existing !== undefined) {
      expect(existing).toEqual(label);
      return;
    }
    labels.set(id, label);
  };

  for (const entry of ruleCatalog()) add(entry.id, entry.label);
  for (const rule of EDS_RULES) {
    if (rule.emits === undefined) {
      add(rule.id, rule.label);
      continue;
    }
    for (const emitted of rule.emits) add(emitted.id, emitted.label);
  }

  return labels;
};

/**
 * subkind → label, over the same two halves — V5 finding #6.
 *
 * `Rule.subkindLabels` is a rule-level map, and two rules that grade the same shade must name it
 * the same way (`kit-icon` is graded by both icon rules), so the merge asserts agreement rather
 * than letting the last one win. A rule that emits several ids shares its parent's map, which is
 * why this walks RULES rather than catalog rows.
 */
const catalogSubkindLabels = (): ReadonlyMap<string, RuleLabel> => {
  const labels = new Map<string, RuleLabel>();
  const addAll = (map: Readonly<Record<string, RuleLabel>> | undefined): void => {
    for (const [subkind, label] of Object.entries(map ?? {})) {
      const existing = labels.get(subkind);
      if (existing !== undefined) {
        expect(`${subkind}: ${existing.ru}`).toBe(`${subkind}: ${label.ru}`);
        continue;
      }
      labels.set(subkind, label);
    }
  };

  for (const entry of ruleCatalog()) addAll(entry.subkindLabels);
  for (const rule of EDS_RULES) addAll(rule.subkindLabels);

  return labels;
};

describe("rule labels — the catalog and the dashboard say the same thing", () => {
  const labels = catalogLabels();

  it("covers exactly the 32 finding-level ids, from both halves of the registry", () => {
    expect(labels.size).toBe(32);
    // The number the design fixes (§4) and the reason `RULE_LABEL` has 32 rows: 11 engine
    // rules, one of which (`component.duplicate`) EDS takes over, plus 22 EDS ids.
    expect([...labels.keys()].toSorted()).toEqual(Object.keys(RULE_LABEL).toSorted());
  });

  it("gives the dashboard's Russian label, character for character", () => {
    for (const [id, label] of labels) {
      expect(`${id}: ${RULE_LABEL[id] ?? "<missing>"}`).toBe(`${id}: ${label.ru}`);
    }
  });

  it("leaves no rule falling back to its own id in the browser", () => {
    for (const id of labels.keys()) {
      expect(ruleLabel(id)).not.toBe(id);
    }
  });

  it("names every id in English too, within the compact row's budget", () => {
    for (const [id, label] of labels) {
      expect(`${id}: ${label.en.length > 0}`).toBe(`${id}: true`);
      // §2.4 lays the row out as `actual` (≤ 60) + label + rule id; 40 columns is what a
      // label may take before the id stops fitting on an 80-column terminal.
      expect(`${id}: ${[...label.en].length <= 40}`).toBe(`${id}: true`);
      expect(label.en.endsWith(".")).toBe(false);
      expect(label.en.trim()).toBe(label.en);
    }
  });

  /**
   * V5 FINDING #17 — the ru side had no width guard and one label was 41 code points.
   *
   * The en side has been guarded since the redesign (the case above); ru is the DEFAULT language
   * and the one every Russian-speaking user reads, so it is the half that mattered most and the
   * half nothing measured.
   */
  it("names every id in Russian within the same 40-column budget", () => {
    for (const [id, label] of labels) {
      expect(`${id}: ${[...label.ru].length <= 40}`).toBe(`${id}: true`);
      expect(label.ru.endsWith(".")).toBe(false);
      expect(label.ru.trim()).toBe(label.ru);
    }
  });

  /**
   * V5 FINDING #18 — the two English nits the audit's spot-check found.
   *
   * `style.override.size` said "resized from outside" while its Russian said «внутренних
   * отступов»: two different defects under one id. `token.tier.violation` was the only label of
   * 62 starting lowercase. Written out literally, because a derived assertion cannot notice a
   * label that changed BACK.
   */
  it("says the same thing in both languages, and starts every English label with a capital", () => {
    expect(labels.get("style.override.size")).toEqual({
      ru: "Изменение внутренних отступов кита",
      en: "Kit component's inner padding overridden",
    });
    expect(labels.get("token.tier.violation")?.en).toBe("Ref variable instead of a sys role");
    for (const [id, label] of labels) {
      const first = [...label.en][0] ?? "";
      expect(`${id}: ${first}`).toBe(`${id}: ${first.toUpperCase()}`);
    }
  });

  it("keeps the two languages distinct per id, so neither is a copy of the other", () => {
    const ru = [...labels.values()].map((label) => label.ru);
    const en = [...labels.values()].map((label) => label.en);

    // 32 ids, but `component.custom`/`component.novel` are each declared twice (the rule and
    // the id it emits) with the same label — the map already collapsed those, so a repeat here
    // would be two DIFFERENT rules sharing one name.
    expect(new Set(ru).size).toBe(labels.size);
    expect(new Set(en).size).toBe(labels.size);
  });
});

/**
 * THE SAME PARITY, ONE LEVEL DOWN — V5 finding #6.
 *
 * `compact` now appends the shade to the row (`<label> — <subkind label>`), which makes
 * `Rule.subkindLabels` a second vocabulary the browser and the terminal share: the dashboard has
 * shown these phrases in its finding cards all along, out of its own `SUBKIND_LABEL`. Two
 * spellings of «почти токен» would be exactly the split this file exists to prevent.
 *
 * ONE DIRECTION ONLY, deliberately. Every subkind the catalog can PRODUCE must be in the
 * dashboard's table with the same words; the dashboard may carry rows for shades no rule emits
 * today (it renders whatever a stored report contains, including one written by an older build),
 * and failing on those would make an old report a test failure.
 */
describe("subkind labels — the shade a row names is the shade the browser names", () => {
  const shades = catalogSubkindLabels();

  it("declares a shade for the rules whose findings carry a fixed set of them", () => {
    // The ten rules that grade: colour, dimension, both icon rules, focus, contrast, name,
    // relations, aria and dialog, plus EDS's keyboard pattern.
    expect(shades.size).toBeGreaterThanOrEqual(24);
  });

  it("gives the dashboard's Russian phrase, character for character", () => {
    for (const [subkind, label] of shades) {
      expect(`${subkind}: ${SUBKIND_LABEL[subkind] ?? "<missing>"}`).toBe(
        `${subkind}: ${label.ru}`,
      );
      expect(subkindLabel(subkind)).not.toBe(subkind);
    }
  });

  it("names every shade in English too, and keeps it short enough for one row", () => {
    for (const [subkind, label] of shades) {
      expect(`${subkind}: ${label.en.length > 0}`).toBe(`${subkind}: true`);
      expect(`${subkind}: ${[...label.en].length <= 45}`).toBe(`${subkind}: true`);
      expect(label.en.endsWith(".")).toBe(false);
      expect(label.en.trim()).toBe(label.en);
    }
  });
});
