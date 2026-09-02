import { describe, expect, it } from "vite-plus/test";

import {
  analyzeWithAdapter,
  FIXTURES,
  readGolden,
  serialise,
  type FixtureName,
} from "./fixtures.ts";

/**
 * THE ACCEPTANCE TEST.
 *
 * For every fixture, `analyzeProject(dir, { adapter: edsAdapter })` must produce **the same
 * bytes** as `node <hackathon>/skills/ds-audit/scripts/ds.mjs analyze <dir>` — the tool this
 * port replaces — for all three of its JSON artifacts.
 *
 * **The normalization list is empty.** Not "small": empty. No path prefix is stripped, no
 * timestamp is masked, no field is skipped, no numeric tolerance is applied. Nothing in the
 * compared payloads is machine-dependent: every path is project-relative, the artifacts carry
 * no timestamps by design (`ds-analyzer/src/domain/kit-icons.ts:33-34` states that explicitly),
 * durations are printed to the console rather than written, and `summary.limitations` is empty
 * on these fixtures. The one thing that *is* asserted and is easy to lose by accident is key
 * order, which `JSON.stringify` takes from insertion order and which `summary.ts` and
 * `analyzerSummarySchema` are both written to preserve.
 *
 * This suite is tier 1: it compares against goldens committed under `tests/golden/`, so it needs
 * neither the hackathon checkout nor a subprocess and runs in milliseconds. What proves the
 * goldens are genuinely that tool's output is `parity.integration.test.ts`, which re-runs it.
 */

describe("parity with the hackathon's ds.mjs — findings", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture}: findings are byte-identical`, async () => {
      const result = await analyzeWithAdapter(fixture);

      expect(serialise(result.findings)).toBe(readGolden(fixture, "findings"));
    });
  }
});

describe("parity with the hackathon's ds.mjs — usage and summary", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture}: usage is byte-identical`, async () => {
      const result = await analyzeWithAdapter(fixture);

      expect(serialise(result.usage)).toBe(readGolden(fixture, "usage"));
    });

    it(`${fixture}: summary is byte-identical`, async () => {
      const result = await analyzeWithAdapter(fixture);

      expect(serialise(result.summary)).toBe(readGolden(fixture, "summary"));
    });
  }
});

/**
 * The fixtures are only worth the bytes they compare if they reach the whole registry.
 *
 * 32 rule ids is the hackathon's own total (`ds-analyzer/src/rules/index.ts:37-64` — 26 rule
 * functions, of which `style.override` emits four ids and `component.custom` three). A fixture
 * edit that silently stopped triggering one of them would leave that rule's port unverified
 * while the suite still passed, which is the failure mode this assertion exists to prevent.
 */
describe("parity coverage", () => {
  it("the four fixtures between them trigger all 32 rule ids", async () => {
    const ids = new Set<string>();

    for (const fixture of FIXTURES) {
      const result = await analyzeWithAdapter(fixture);
      for (const finding of result.findings) {
        ids.add(finding.rule);
      }
    }

    expect([...ids].sort()).toEqual([
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
      "api.deprecated",
      "api.dnu",
      "component.ambiguous",
      "component.custom",
      "component.duplicate",
      "component.fork",
      "component.novel",
      "font.foreign",
      "icon.foreign-file",
      "icon.foreign-pack",
      "icon.inline-svg",
      "import.bypass",
      "import.internal",
      "prop.invalid",
      "style.override.important",
      "style.override.inner",
      "style.override.repaint",
      "style.override.size",
      "token.literal.color",
      "token.literal.dimension",
      "token.tier.violation",
      "token.typography.partial",
    ] satisfies string[]);
  });

  it("every fixture produces findings, so a silent zero cannot pass as agreement", async () => {
    const counts: Record<FixtureName, number> = {
      "kit-api": 0,
      "kit-tokens": 0,
      "kit-icons": 0,
      "kit-components": 0,
    };

    for (const fixture of FIXTURES) {
      counts[fixture] = (await analyzeWithAdapter(fixture)).findings.length;
    }

    for (const fixture of FIXTURES) {
      expect(counts[fixture]).toBeGreaterThan(5);
    }
  });
});
