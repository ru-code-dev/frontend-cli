/**
 * THE TWO COPIES MUST AGREE — the whole reason the dashboard may keep its own implementation.
 *
 * `packages/fg-analyzer-engine/src/config/apply.ts` decides what the console prints and what the
 * summary counts. `dashboard/src/lib/rule-config.ts` decides what the reader sees, live, in the
 * browser, over the embedded raw findings. They cannot be one function — the dashboard is a
 * zero-dependency single-file build and cannot import the engine — so they are two, and this
 * suite is what makes the duplication safe rather than merely convenient.
 *
 * Two claims, both from design §5.3:
 *
 *  1. Over a generated table of findings × configs, the dashboard's `resolveLevel` and
 *     `applyRuleConfig` return exactly what the engine's do. The table is built to hit every
 *     rung of the D7 ladder and the edges that historically break a precedence walk: an exact
 *     id against a dot-prefix of it, the LONGEST of two prefixes, a `<rule>/<subkind>` key, a
 *     dot-BOUNDARY trap (`token.literal` must not catch `token.literalism`), and a rule named
 *     after an `Object.prototype` member.
 *  2. The dashboard's live recount equals the number the ENGINE put in the payload under the
 *     same config. Not "equals a second implementation of the same formula" — equals what
 *     `analyzeProject({ruleConfig})` actually computed, over a real fixture, through
 *     `payloadOf`. That is the number the reader compares against the console output.
 */
import {
  analyzeProject,
  applyRuleConfig as engineApplyRuleConfig,
  resolveLevel as engineResolveLevel,
  type Finding as EngineFindingRecord,
  type RuleConfig,
  type RuleLevel,
} from "@smart-tools/fg-analyzer-engine";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

import {
  applyRuleConfig as browserApplyRuleConfig,
  recountFindings,
  resolveLevel as browserResolveLevel,
} from "../dashboard/src/lib/rule-config.js";
import { payloadOf } from "../src/index.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const LEVELS: readonly RuleLevel[] = ["off", "on", "error", "warning", "info", "candidate"];

/**
 * A finding with every field the engine's schema requires, and the four that matter varied.
 *
 * Only `rule`, `subkind`, `category` and `severity` participate in the decision; the rest is
 * present so the objects are real `Finding`s rather than a shape that happens to typecheck, and
 * so a deep-equality failure points at a changed severity instead of a missing field.
 */
const findingAt = (
  rule: string,
  subkind: string | null,
  category: EngineFindingRecord["category"],
  severity: EngineFindingRecord["severity"],
): EngineFindingRecord => ({
  id: `${rule}:${subkind ?? "-"}:src/App.tsx:1`,
  rule,
  subkind,
  category,
  severity,
  confidence: 1,
  file: "src/App.tsx",
  line: 1,
  column: 1,
  snippet: { before: "<div />", after: null, highlightLine: 1, startLine: 1 },
  actual: "<div />",
  expected: null,
  why: "Причина",
  note: null,
  rootCause: null,
  appliedTo: null,
  a11y: null,
  autoFixable: false,
  needsAgent: false,
  candidates: [],
  impact: { occurrences: 1, files: 1 },
  impactKey: `${rule}:key`,
});

/** Every shape a config key can address, plus the two traps a naive matcher falls into. */
const SAMPLE: readonly EngineFindingRecord[] = [
  findingAt("style.override.repaint", null, "override", "warning"),
  findingAt("style.override.important", null, "override", "error"),
  findingAt("style.override.size", "onScale", "override", "info"),
  findingAt("token.literal.color", "near", "token", "warning"),
  findingAt("token.literal.dimension", "offScale", "token", "info"),
  // Dot-BOUNDARY trap: `token.literal` must not address this one.
  findingAt("token.literalism", null, "token", "error"),
  findingAt("a11y.lint", "alt-text", "a11y", "error"),
  findingAt("a11y.lint", "no-autofocus", "a11y", "warning"),
  findingAt("a11y.contrast.text", "largeText", "a11y", "warning"),
  findingAt("component.duplicate", null, "component", "candidate"),
  findingAt("icon.foreign-pack", null, "icon", "warning"),
  // Prototype trap: a rule named after an `Object.prototype` member must resolve normally.
  findingAt("toString", null, "component", "info"),
];

/**
 * A rule named after an `Object.prototype` member.
 *
 * Built by assignment rather than as a literal because `{ toString: "off" }` collides with the
 * `toString(): string` every object type inherits — which is itself a small proof that this is
 * the trap it looks like: a resolver reaching through the prototype would find a FUNCTION here.
 */
const prototypeKey: string = "toString";
const prototypeTrap: Record<string, RuleLevel> = { [prototypeKey]: "off" };

const RULE_SETS: readonly Readonly<Record<string, RuleLevel>>[] = [
  {},
  { "style.override": "off" },
  // General rule first, exception after it — the LONGEST key has to win, whatever the order.
  { "style.override": "off", "style.override.important": "error" },
  { "style.override.important": "error", "style.override": "off" },
  { "token.literal": "warning" },
  { "a11y.lint": "off" },
  { "a11y.lint/alt-text": "candidate" },
  { "a11y.lint": "off", "a11y.lint/alt-text": "error" },
  prototypeTrap,
  { a11y: "info", component: "off", "component.duplicate": "candidate" },
];

const CATEGORY_SETS: readonly RuleConfig["categories"][] = [
  {},
  { a11y: "off" },
  { token: "error", override: "info" },
  { component: "candidate", icon: "warning", a11y: "on" },
];

const CONFIGS: readonly RuleConfig[] = LEVELS.flatMap((fallback) =>
  RULE_SETS.flatMap((rules) =>
    CATEGORY_SETS.map(
      (categories): RuleConfig => ({
        default: fallback,
        categories,
        rules,
        source: { kind: "defaults" },
      }),
    ),
  ),
);

describe("the dashboard's copy of the config engine", () => {
  it("covers every rung of the precedence ladder over a table big enough to matter", () => {
    // 6 defaults × 10 rule sets × 4 category sets = 240 configs × 12 findings = 2880 decisions.
    expect(CONFIGS.length).toBeGreaterThanOrEqual(200);
    expect(CONFIGS.length * SAMPLE.length).toBe(2880);
  });

  it("resolves every finding to the level the ENGINE resolves it to", () => {
    const disagreements: string[] = [];

    for (const [index, config] of CONFIGS.entries()) {
      for (const finding of SAMPLE) {
        const engine = engineResolveLevel(finding, config);
        const browser = browserResolveLevel(finding, config);
        if (engine !== browser) {
          disagreements.push(
            `config#${String(index)} ${finding.rule}/${finding.subkind ?? "-"}: engine=${engine} browser=${browser}`,
          );
        }
      }
    }

    expect(disagreements).toEqual([]);
  });

  it("produces the same visible set, in the same order, with the same severities", () => {
    for (const config of CONFIGS) {
      expect(browserApplyRuleConfig(SAMPLE, config)).toEqual(engineApplyRuleConfig(SAMPLE, config));
    }
  });

  it("passes an unchanged finding through by IDENTITY, exactly where the engine does", () => {
    let passedThrough = 0;
    let copied = 0;

    for (const config of CONFIGS) {
      const engine = engineApplyRuleConfig(SAMPLE, config);
      const browser = browserApplyRuleConfig(SAMPLE, config);

      // Deep equality is the previous test. THIS one is about object identity: the screens'
      // `useMemo`s treat an untouched config as an untouched payload only because a finding
      // whose severity did not change is the SAME object it arrived as — on both sides.
      const engineKept = engine.map((finding) => SAMPLE.includes(finding));
      expect(browser.map((finding) => SAMPLE.includes(finding))).toEqual(engineKept);

      passedThrough += engineKept.filter(Boolean).length;
      copied += engineKept.filter((kept) => !kept).length;
    }

    // Both halves of the behaviour have to be exercised, or the assertion above is vacuous.
    expect(passedThrough).toBeGreaterThan(0);
    expect(copied).toBeGreaterThan(0);
  });
});

/**
 * The configs the second parity claim is checked under: nothing hidden, everything hidden, and
 * three partial views that each drop a different slice of the fixtures' findings.
 */
const SUMMARY_CONFIGS: readonly { readonly name: string; readonly config: RuleConfig }[] = [
  {
    name: "the identity config",
    config: { default: "on", categories: {}, rules: {}, source: { kind: "defaults" } },
  },
  {
    name: "everything off",
    config: { default: "off", categories: {}, rules: {}, source: { kind: "defaults" } },
  },
  {
    name: "a category switched off",
    config: { default: "on", categories: { a11y: "off" }, rules: {}, source: { kind: "defaults" } },
  },
  {
    name: "one sub-rule re-graded to error",
    config: {
      default: "on",
      categories: {},
      rules: { "a11y.lint/prefer-tag-over-role": "error" },
      source: { kind: "file", path: "/tmp/fg.config.json" },
    },
  },
  {
    name: "a whole family off with one exception kept",
    config: {
      default: "off",
      categories: { a11y: "off" },
      rules: { "a11y.pattern": "warning" },
      source: { kind: "file", path: "/tmp/fg.config.json" },
    },
  },
];

describe("the live recount equals the engine's own summary", () => {
  for (const fixture of ["dialog", "duplicates"]) {
    for (const { name, config } of SUMMARY_CONFIGS) {
      it(`agrees on \`${fixture}\` under ${name}`, async () => {
        const result = await analyzeProject({ dir: join(fixtures, fixture), ruleConfig: config });
        const payload = payloadOf(result, { generatedAt: "2026-09-08", ruleConfig: config });

        // The payload carries every RAW finding (design D11) — that is what makes the recount
        // possible at all, and what the dashboard re-derives the visible set from.
        expect(payload.findings).toHaveLength(result.findings.length);

        const visible = browserApplyRuleConfig(payload.findings, config);

        expect(recountFindings(visible)).toEqual(payload.summary.findings);
        expect(result.suppressedCount).toBe(result.findings.length - visible.length);
      });
    }
  }

  it("recounts to something DIFFERENT when the config actually hides something", async () => {
    // Guards the previous test against passing for the wrong reason: if `applyRuleConfig` were
    // a no-op, both sides would agree on every config and prove nothing.
    const raw = await analyzeProject({ dir: join(fixtures, "dialog") });
    const hidden = await analyzeProject({
      dir: join(fixtures, "dialog"),
      ruleConfig: {
        default: "on",
        categories: {},
        rules: { "a11y.lint": "off" },
        source: { kind: "defaults" },
      },
    });

    expect(raw.summary.findings.total).toBe(3);
    expect(hidden.summary.findings.total).toBe(1);
    expect(hidden.findings).toHaveLength(3);
    expect(hidden.suppressedCount).toBe(2);
  });
});
