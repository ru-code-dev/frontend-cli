import { describe, expect, it } from "vite-plus/test";

import { analyzeFixture, countsByRule, findingsOf, locationsOf } from "./fixtures.ts";

/**
 * The nine generic a11y rules, each against the fixture that seeds it.
 *
 * Assertions are per rule — id, count, file and line — rather than one snapshot of everything.
 * A snapshot of a whole run answers "did anything change"; these answer "does this rule still
 * find this defect", which is the question a port has to keep answering.
 */

describe("plain css + jsx", () => {
  it("reports the seeded violations and nothing else", async () => {
    const result = await analyzeFixture("plain-css");

    expect(countsByRule(result)).toEqual({
      "a11y.lint": 1,
      "a11y.name.missing": 2,
      "a11y.aria.invalid": 1,
      "a11y.focus.suppressed": 1,
      "a11y.contrast.text": 1,
    });
  });

  it("a11y.lint — the image with no alt, carried through from the plugin", async () => {
    const result = await analyzeFixture("plain-css");
    const [finding] = findingsOf(result, "a11y.lint");

    expect(finding?.subkind).toBe("alt-text");
    expect(finding?.file).toBe("src/App.tsx");
    expect(finding?.line).toBe(7);
    expect(finding?.severity).toBe("error");
    // The editorial layer, not the plugin's message.
    expect(finding?.a11y?.wcag).toEqual(["1.1.1"]);
    expect(finding?.a11y?.fix).toContain("alt");
  });

  it("a11y.aria.invalid — an unknown role, with the near-miss offered as a patch", async () => {
    const result = await analyzeFixture("plain-css");
    const [finding] = findingsOf(result, "a11y.aria.invalid");

    expect(finding?.subkind).toBe("unknownRole");
    expect(finding?.actual).toBe('role="buton"');
    expect(finding?.expected?.value).toBe('role="button"');
    expect(finding?.autoFixable).toBe(true);
    expect(finding?.snippet.after).toContain('role="button"');
  });

  it("a11y.name.missing — the icon-only button and the unlabelled image", async () => {
    const result = await analyzeFixture("plain-css");
    const subkinds = findingsOf(result, "a11y.name.missing").map((finding) => finding.subkind);

    expect(subkinds).toEqual(["unlabelled", "iconOnly"]);
    expect(locationsOf(result, "a11y.name.missing")).toEqual(["src/App.tsx:7", "src/App.tsx:17"]);
  });

  it("a11y.focus.suppressed — a blanket reset in a file that styles focus nowhere", async () => {
    const result = await analyzeFixture("plain-css");
    const [finding] = findingsOf(result, "a11y.focus.suppressed");

    expect(finding?.subkind).toBe("blanket");
    expect(finding?.file).toBe("src/app.css");
    expect(finding?.actual).toBe("outline: none");
    expect(finding?.a11y?.wcag).toEqual(["2.4.7"]);
  });

  it("a11y.contrast.text — the failing pair only, not the passing one", async () => {
    const result = await analyzeFixture("plain-css");
    const [finding] = findingsOf(result, "a11y.contrast.text");

    expect(finding?.subkind).toBe("normalText");
    expect(finding?.actual).toBe("#8a8a8a на #ffffff");
    // 3.45:1 — under the 4.5:1 bar for normal text but over 3:1, hence a warning.
    expect(finding?.severity).toBe("warning");
    expect(findingsOf(result, "a11y.contrast.text")).toHaveLength(1);
  });
});

describe("css modules", () => {
  it("reports the seeded violations and nothing else", async () => {
    const result = await analyzeFixture("css-modules");

    expect(countsByRule(result)).toEqual({
      "a11y.aria.required": 1,
      "a11y.lint": 1,
      "a11y.aria.redundant": 1,
      "a11y.pattern.relations": 1,
      "a11y.focus.suppressed": 1,
    });
  });

  it("a11y.aria.required — role=checkbox without aria-checked", async () => {
    const result = await analyzeFixture("css-modules");
    const [finding] = findingsOf(result, "a11y.aria.required");

    expect(finding?.subkind).toBe("checkbox");
    expect(finding?.file).toBe("src/Panel.tsx");
    expect(finding?.line).toBe(8);
    expect(finding?.why).toContain("aria-checked");
  });

  it("a11y.aria.redundant — role duplicating the tag, offered as a deletion", async () => {
    const result = await analyzeFixture("css-modules");
    const [finding] = findingsOf(result, "a11y.aria.redundant");

    expect(finding?.line).toBe(13);
    expect(finding?.severity).toBe("info");
    expect(finding?.autoFixable).toBe(true);
    // The patch deletes the attribute from its own line and touches nothing around it.
    const patched = finding?.snippet.after?.split("\n")[(finding.snippet.highlightLine ?? 1) - 1];
    expect(patched).toBe('      <button type="button" className={styles.action}>');
  });

  it("a11y.pattern.relations — aria-labelledby pointing at an absent id", async () => {
    const result = await analyzeFixture("css-modules");
    const [finding] = findingsOf(result, "a11y.pattern.relations");

    expect(finding?.subkind).toBe("danglingId");
    expect(finding?.actual).toBe('aria-labelledby="panel-heading-missing"');
    expect(finding?.line).toBe(18);
  });

  it("a11y.focus.suppressed — a focus block that draws nothing back", async () => {
    const result = await analyzeFixture("css-modules");
    const [finding] = findingsOf(result, "a11y.focus.suppressed");

    expect(finding?.subkind).toBe("onFocus");
    expect(finding?.file).toBe("src/panel.module.css");
    expect(finding?.confidence).toBe(0.95);
  });
});

describe("styled-components", () => {
  it("finds the same two defects inside tagged templates", async () => {
    const result = await analyzeFixture("styled-components");

    expect(countsByRule(result)).toEqual({
      "a11y.focus.suppressed": 1,
      "a11y.contrast.text": 1,
    });
    expect(locationsOf(result, "a11y.focus.suppressed")).toEqual(["src/Card.tsx:9"]);
    expect(findingsOf(result, "a11y.contrast.text")[0]?.severity).toBe("error");
  });
});

describe("emotion", () => {
  it("finds the same two defects in emotion's own idiom", async () => {
    const result = await analyzeFixture("emotion");

    expect(countsByRule(result)).toEqual({
      "a11y.contrast.text": 1,
      "a11y.focus.suppressed": 1,
    });
    expect(locationsOf(result, "a11y.contrast.text")).toEqual(["src/Banner.tsx:9"]);
    expect(locationsOf(result, "a11y.focus.suppressed")).toEqual(["src/Banner.tsx:17"]);
  });
});

describe("hand-rolled dialogs", () => {
  it("a11y.pattern.focus — reports the broken dialog and leaves the good one alone", async () => {
    const result = await analyzeFixture("dialog");
    const findings = findingsOf(result, "a11y.pattern.focus");

    expect(findings).toHaveLength(1);
    expect(findings[0]?.subkind).toBe("noEscape");
    expect(findings[0]?.rootCause?.name).toBe("BrokenDialog");
    expect(findings[0]?.a11y?.pattern).toBe("dialog-modal");
    // No design-system component is suggested: there is no kit to suggest one from.
    expect(findings[0]?.expected).toBeNull();
    expect(findings[0]?.candidates).toEqual([]);
  });
});
