/**
 * THE MAPPING: engine result → what the dashboard reads.
 *
 * The assertions here are the ones a wrong mapping would show as a broken screen: a snippet
 * block that renders raw HTML, counters that disagree with the list under them, and the two
 * slots (`diff`, `iconPreviews`) that must be present-and-empty rather than missing, because
 * the dashboard indexes into them.
 */
import { describe, expect, it } from "vite-plus/test";

import { payloadOf, type EngineFinding } from "../src/index.ts";
import { kitResultOf, minimalFinding, resultOf } from "./support.ts";

const at = (overrides: Partial<EngineFinding>): EngineFinding => ({
  ...minimalFinding,
  ...overrides,
});

describe("payloadOf", () => {
  it("fills every optional finding field with the value the dashboard treats as «none»", () => {
    const [finding] = payloadOf(resultOf([minimalFinding]), { generatedAt: "2026-08-30" }).findings;

    expect(finding).toMatchObject({
      subkind: null,
      expected: null,
      note: null,
      rootCause: null,
      appliedTo: null,
      a11y: null,
      needsAgent: false,
      candidates: [],
      confidence: 1,
    });
  });

  it("carries the engine's own grouping key through untouched", () => {
    const payload = payloadOf(resultOf([at({ impactKey: "a11y.lint:alt-text" })]), {
      generatedAt: "2026-08-30",
    });

    expect(payload.findings[0]?.impactKey).toBe("a11y.lint:alt-text");
  });

  it("renders the snippet as escaped plain text in the element the stylesheet styles", () => {
    const payload = payloadOf(
      resultOf([at({ snippet: { ...minimalFinding.snippet, before: '<img alt="&">' } })]),
      {
        generatedAt: "2026-08-30",
      },
    );

    expect(payload.findings[0]?.snippet.beforeHtml).toBe(
      '<pre class="shiki"><code>&lt;img alt=&quot;&amp;&quot;&gt;</code></pre>',
    );
    expect(payload.findings[0]?.snippet.afterHtml).toBeNull();
  });

  it("recomputes the summary counters when the engine does not carry them", () => {
    const payload = payloadOf(
      resultOf([
        at({ id: "1", severity: "error", category: "a11y", rule: "a11y.lint", autoFixable: true }),
        at({ id: "2", severity: "warning", category: "icon", rule: "icon.foreign-pack" }),
        at({ id: "3", severity: "warning", category: "component", rule: "component.duplicate" }),
      ]),
      { generatedAt: "2026-08-30" },
    );

    expect(payload.summary.findings).toEqual({
      total: 3,
      bySeverity: { error: 1, warning: 2, info: 0, candidate: 0 },
      byRule: { "a11y.lint": 1, "icon.foreign-pack": 1, "component.duplicate": 1 },
      byCategory: {
        token: 0,
        typography: 0,
        font: 0,
        api: 0,
        override: 0,
        component: 1,
        icon: 1,
        a11y: 1,
      },
      autoFixable: 1,
      needsAgent: 0,
    });
  });

  it("prefers the engine's own counters when it does carry them", () => {
    const counters = {
      total: 99,
      bySeverity: { error: 99, warning: 0, info: 0, candidate: 0 },
      byRule: { "a11y.lint": 99 },
      byCategory: {
        token: 0,
        typography: 0,
        font: 0,
        api: 0,
        override: 0,
        component: 0,
        icon: 0,
        a11y: 99,
      },
      autoFixable: 3,
      needsAgent: 0,
    };
    const payload = payloadOf(
      {
        findings: [minimalFinding],
        summary: { files: { scanned: 1, clean: 0 }, findings: counters },
      },
      { generatedAt: "2026-08-30" },
    );

    expect(payload.summary.findings).toEqual(counters);
  });

  it("emits the two unported slots as present-and-empty, never missing", () => {
    const payload = payloadOf(resultOf([]), { generatedAt: "2026-08-30" });

    expect(payload.diff).toBeNull();
    expect(payload.iconPreviews).toEqual({});
    expect(payload.summary.limitations).toEqual([]);
    expect(payload.summary.positives).toEqual([]);
  });

  it("takes limitations off the profile when the summary carries none", () => {
    const limitation = {
      file: "src/theme.ts",
      line: null,
      reason: "dynamic-styles",
      detail: "стиль собран в рантайме",
    };
    const payload = payloadOf(
      {
        findings: [],
        summary: { files: { scanned: 1, clean: 1 } },
        profile: { limitations: [limitation] },
      },
      { generatedAt: "2026-08-30" },
    );

    expect(payload.summary.limitations).toEqual([limitation]);
  });

  it("reads the project off `profile` when the result has no `project`", () => {
    const payload = payloadOf(
      {
        findings: [],
        summary: { files: { scanned: 0, clean: 0 } },
        profile: { name: "app", root: "/repo/app" },
      },
      { generatedAt: "2026-08-30" },
    );

    expect(payload.project).toEqual({ name: "app", root: "/repo/app" });
  });

  it("is deterministic when the caller supplies the timestamp", () => {
    const result = resultOf([minimalFinding]);

    expect(payloadOf(result, { generatedAt: "2026-08-30" })).toEqual(
      payloadOf(result, { generatedAt: "2026-08-30" }),
    );
  });
});

/**
 * X3: the adapter stamp and the adapter-gated half of the payload.
 *
 * The law this suite pins is the one the CLI's tier-2 lane restates against the shipped
 * bundle: with no adapter, the payload is what it always was PLUS `adapter: null`, and nothing
 * else. Written here as a string comparison over the serialised object, because "nothing else"
 * is a claim about bytes and a deep-equal over two objects built by the same code would pass
 * whatever both of them did.
 */
describe("the adapter stamp", () => {
  it("is null when the caller names no adapter", () => {
    expect(payloadOf(resultOf([minimalFinding])).adapter).toBeNull();
  });

  it("carries the name and version the caller selected", () => {
    const payload = payloadOf(resultOf([minimalFinding]), {
      adapter: { name: "eds", version: "9.9.9" },
    });
    expect(payload.adapter).toEqual({ name: "eds", version: "9.9.9" });
  });

  it("adding the stamp is the ONLY change to an adapter-less payload", () => {
    const result = resultOf([minimalFinding]);
    const generatedAt = "2026-01-01T00:00:00.000Z";
    const withStamp = JSON.stringify(payloadOf(result, { generatedAt }));

    // What the payload was before X3: the same object with the one new key removed.
    expect(withStamp).toContain('"adapter":null,');
    const withoutStamp = withStamp.replace('"adapter":null,', "");

    expect(withoutStamp).not.toContain("adapter");
    // Nothing kit-shaped leaked into the adapter-less shape either.
    for (const key of ["usage", "healthScore", "healthFormula", "tokenCoverage", "kitGaps"]) {
      expect(withoutStamp).not.toContain(key);
    }
  });
});

describe("the adapter-gated half", () => {
  it("passes usage and the kit summary fields straight through", () => {
    const payload = payloadOf(kitResultOf([minimalFinding]));

    expect(payload.summary.healthScore).toBe(71);
    expect(payload.summary.adoption).toBeCloseTo(0.4);
    expect(payload.summary.kitGaps).toHaveLength(1);
    expect(payload.usage?.tokenUsage).toEqual({ "--x-color-fg": 7 });
    expect(payload.usage?.components).toHaveLength(1);
  });

  it("fills in the one field the renderer owns — the custom component's snippet HTML", () => {
    const component = payloadOf(kitResultOf([minimalFinding])).usage?.customComponents[0];

    expect(component?.snippet).toBe("const Card = () => <div />;");
    // Same treatment as `Snippet.beforeHtml`: escaped plain text in the `.shiki` element.
    expect(component?.snippetHtml).toBe(
      '<pre class="shiki"><code>const Card = () =&gt; &lt;div /&gt;;</code></pre>',
    );
  });

  it("emits no kit key at all when the engine produced none", () => {
    const payload = payloadOf(resultOf([minimalFinding]));

    expect(payload.usage).toBeUndefined();
    expect("usage" in payload).toBe(false);
    expect("healthScore" in payload.summary).toBe(false);
    expect("kitGaps" in payload.summary).toBe(false);
  });
});
