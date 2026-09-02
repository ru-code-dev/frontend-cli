import { analyzeProject, rulesFor } from "@smart-tools/fe-analyzer-engine";
import { describe, expect, it } from "vite-plus/test";

import { edsAdapter } from "../src/index.ts";
import { analyzeWithAdapter, fixturePath } from "./fixtures.ts";

/**
 * The seam itself: what connecting an adapter does, and what disconnecting it undoes.
 *
 * `parity.test.ts` proves the connected run matches the tool. This suite proves the two owner's
 * laws that parity alone cannot: that the adapter is a plain object with no filesystem
 * dependency, and that the engine without it is unchanged — on the very same fixture, which is
 * a harder statement than "the old tests still pass".
 */

describe("the adapter is data, not a loader", () => {
  it("is an imported object with no path in it", () => {
    expect(edsAdapter.id).toBe("eds");
    expect(edsAdapter.kitPackages.length).toBeGreaterThan(0);
    expect(typeof edsAdapter.wrappedUpstreamScope).toBe("string");
    expect(typeof edsAdapter.binding.tokenColorHex).toBe("function");
    expect(typeof edsAdapter.summaryExtras).toBe("function");
  });

  it("answers kit queries without touching the filesystem", () => {
    // Every one of these would have been a `readFileSync` away in the hackathon's pipeline
    // (`ds-analyzer/src/cli/run-analyze.ts:56-59`). Here the data is already in the bundle.
    expect(edsAdapter.binding.iconCount).toBeGreaterThan(0);
    expect(edsAdapter.binding.a11yAvailable).toBe(true);
    expect(edsAdapter.binding.componentNames().length).toBeGreaterThan(50);
    expect(edsAdapter.binding.canonicalComponentFor("dialog")?.component).toBe("Modal");
    expect(edsAdapter.binding.variantValues("Button", "view")).toEqual([
      "primary",
      "secondary",
      "negative",
    ]);
    expect(edsAdapter.binding.variantValues("Button", "notAProp")).toBeNull();
  });

  it("contributes sixteen rules and takes over exactly one", () => {
    expect(edsAdapter.rules).toHaveLength(16);
    expect(edsAdapter.replaces).toEqual(["component.duplicate"]);

    // The engine's split-out duplicate rule stands down, and the adapter's `component.novel`
    // — which emits `component.duplicate` itself — takes its place.
    const ids = rulesFor(["a11y", "components", "icons", "tokens", "api"], edsAdapter).map(
      (rule) => rule.id,
    );
    expect(ids.filter((id) => id === "component.duplicate")).toEqual([]);
    expect(ids).toContain("component.novel");
    expect(ids).toHaveLength(26);
  });
});

describe("the engine without the adapter", () => {
  it("runs the generic eleven and reports no design-system knowledge", async () => {
    const bare = await analyzeProject({ dir: fixturePath("kit-components") });

    expect(bare.domains).toEqual(["a11y", "components", "icons"]);
    expect(bare.usage).toBeUndefined();
    expect(bare.summary.healthScore).toBeUndefined();
    expect(bare.summary.adoption).toBeUndefined();
    expect(Object.keys(bare.summary.findings.byCategory).sort()).toEqual([
      "a11y",
      "component",
      "icon",
    ]);

    // No rule outside the generic three domains can have fired.
    const categories = new Set(bare.findings.map((finding) => finding.category));
    expect(
      [...categories].every((category) => ["a11y", "component", "icon"].includes(category)),
    ).toBe(true);
  });

  it("is a strict subset: connecting the adapter only ever adds", async () => {
    const bare = await analyzeProject({ dir: fixturePath("kit-api") });
    const withKit = await analyzeWithAdapter("kit-api");

    expect(withKit.findings.length).toBeGreaterThan(bare.findings.length);

    // Same rule, same place: the a11y findings the engine finds on its own are still found,
    // and the adapter does not silence them.
    const key = (finding: { rule: string; file: string; line: number; column: number }): string =>
      `${finding.rule} ${finding.file}:${String(finding.line)}:${String(finding.column)}`;
    const connected = new Set(withKit.findings.map(key));

    for (const finding of bare.findings) {
      expect(connected.has(key(finding))).toBe(true);
    }
  });
});

describe("the connected run restores what the port had narrowed", () => {
  it("emits usage, the eight-key byCategory and the adoption summary", async () => {
    const result = await analyzeWithAdapter("kit-components");

    expect(result.usage).toBeDefined();
    expect(result.usage?.unusedComponents.length).toBeGreaterThan(0);
    expect(Object.keys(result.summary.findings.byCategory).sort()).toEqual([
      "a11y",
      "api",
      "component",
      "font",
      "icon",
      "override",
      "token",
      "typography",
    ]);
    expect(result.summary.healthScore).toBeGreaterThanOrEqual(0);
    expect(result.summary.healthFormula).toContain("adoption");
    expect(result.summary.adoption).toBeGreaterThan(0);
    expect(Array.isArray(result.summary.positives)).toBe(true);
    expect(Array.isArray(result.summary.kitGaps)).toBe(true);
  });

  it("tags kit components, which is what every restored gate depends on", async () => {
    const result = await analyzeWithAdapter("kit-components");

    // `adoption` counts elements whose `kitComponent` is set; a non-zero value is the
    // observable proof that the scanner's kit closure ran.
    expect(result.summary.adoption).toBeGreaterThan(0);
    expect(result.usage?.elementBreakdown.kit).toBeGreaterThan(0);
  });
});
