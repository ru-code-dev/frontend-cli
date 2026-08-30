import { describe, expect, it } from "vite-plus/test";

import { analyzerResultSchema, analyzeProject, ALL_DOMAINS, rulesFor } from "../src/index.ts";
import { analyzeFixture, fixturePath } from "./fixtures.ts";

/**
 * The public API: the shape it returns, the domains it runs, and the negative fixture.
 *
 * The clean-project test is the one that would catch the failure mode that gets an analyser
 * switched off. A rule that fires on correctly written code costs more trust than the defect
 * it was meant to find.
 */

describe("analyzeProject — the result shape", () => {
  it("returns a payload that satisfies its own schema", async () => {
    const result = await analyzeFixture("plain-css");

    expect(analyzerResultSchema.safeParse(result).success).toBe(true);
    expect(result.$schema).toBe("fe-analyzer-engine/analysis@1");
    expect(result.domains).toEqual(["a11y", "components", "icons"]);
  });

  it("gives every finding an id, a snippet and an impact count", async () => {
    const result = await analyzeFixture("plain-css");
    const [first] = result.findings;

    expect(result.findings.map((finding) => finding.id)).toEqual([
      "f_0001",
      "f_0002",
      "f_0003",
      "f_0004",
      "f_0005",
      "f_0006",
    ]);
    expect(first?.snippet.before.length).toBeGreaterThan(0);
    expect(first?.snippet.highlightLine).toBeGreaterThan(0);
    expect(first?.impact.occurrences).toBeGreaterThanOrEqual(1);
    expect(first?.impact.files).toBeGreaterThanOrEqual(1);
  });

  it("orders findings by file, then line, then column", async () => {
    const result = await analyzeFixture("plain-css");
    const keys = result.findings.map(
      (finding) => `${finding.file}:${String(finding.line).padStart(4, "0")}`,
    );

    expect([...keys].sort()).toEqual(keys);
  });

  it("summarises counts, clean files and limitations", async () => {
    const result = await analyzeFixture("plain-css");

    expect(result.summary.files.scanned).toBe(2);
    expect(result.summary.files.clean).toBe(0);
    expect(result.summary.findings.total).toBe(result.findings.length);
    expect(result.summary.findings.bySeverity).toEqual({
      error: 5,
      warning: 1,
      info: 0,
      candidate: 0,
    });
    expect(result.summary.findings.byCategory).toEqual({ a11y: 6, component: 0, icon: 0 });
    expect(result.summary.findings.autoFixable).toBe(1);
    expect(Array.isArray(result.summary.limitations)).toBe(true);
  });
});

describe("analyzeProject — domains", () => {
  it("defaults to all three", () => {
    expect(ALL_DOMAINS).toEqual(["a11y", "components", "icons"]);
    expect(rulesFor().map((rule) => rule.id)).toHaveLength(11);
  });

  it("selects rules by domain, and says which domains ran", async () => {
    const result = await analyzeProject({
      dir: fixturePath("plain-css"),
      domains: ["components", "icons"],
    });

    expect(result.domains).toEqual(["components", "icons"]);
    expect(result.findings).toEqual([]);
    expect(rulesFor(["a11y"]).map((rule) => rule.id)).toEqual([
      "a11y.lint",
      "a11y.focus.suppressed",
      "a11y.aria.invalid",
      "a11y.aria.required",
      "a11y.aria.redundant",
      "a11y.pattern.relations",
      "a11y.pattern.focus",
      "a11y.name.missing",
      "a11y.contrast.text",
    ]);
    expect(rulesFor(["components"]).map((rule) => rule.id)).toEqual(["component.duplicate"]);
    expect(rulesFor(["icons"]).map((rule) => rule.id)).toEqual(["icon.foreign-pack"]);
  });
});

describe("analyzeProject — the ignore option", () => {
  it("drops the ignored files from the scan, findings and counts", async () => {
    const withCss = await analyzeProject({ dir: fixturePath("plain-css") });
    const withoutCss = await analyzeProject({ dir: fixturePath("plain-css"), ignore: ["*.css"] });

    expect(withCss.summary.files.scanned).toBe(2);
    expect(withoutCss.summary.files.scanned).toBe(1);
    expect(withoutCss.findings.some((finding) => finding.file.endsWith(".css"))).toBe(false);
  });
});

describe("a clean project", () => {
  it("produces no findings in any domain", async () => {
    const result = await analyzeFixture("clean");

    expect(result.findings).toEqual([]);
    expect(result.summary.findings.total).toBe(0);
    expect(result.summary.files.scanned).toBe(2);
    expect(result.summary.files.clean).toBe(2);
  });
});
