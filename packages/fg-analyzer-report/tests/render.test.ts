/**
 * THE SUBSTITUTION: the payload goes into the real template and comes back out unchanged.
 *
 * Round-tripping through the built artifact — not through a hand-written stub — is the point:
 * what must hold is that the file a user double-clicks parses back into the analysis it was
 * generated from. The escaping cases are the two that historically break such a file: a
 * `</script>` inside a code snippet, and a `$'` inside it (a replacement-pattern splice that
 * the source renderer's function-form `replace` exists to prevent —
 * `hackathon2026/ds-analyzer/src/report/render.ts:170-174`).
 */
import { describe, expect, it } from "vite-plus/test";

import { payloadOf, renderReport, ReportTemplateError } from "../src/index.ts";
import { builtTemplate, minimalFinding, resultOf } from "./support.ts";

const SLOT = /<script type="application\/json" id="ds-data">([\s\S]*?)<\/script>/;

const readBack = (html: string): unknown => {
  const match = SLOT.exec(html);
  if (match?.[1] === undefined) {
    throw new Error("rendered report has no ds-data slot");
  }
  return JSON.parse(match[1]) as unknown;
};

describe("renderReport", () => {
  it("places the payload in the slot and it round-trips", () => {
    const payload = payloadOf(resultOf([minimalFinding]), { generatedAt: "2026-08-30" });

    expect(readBack(renderReport(payload, builtTemplate()))).toEqual(payload);
  });

  it("leaves the rest of the document alone", () => {
    const template = builtTemplate();
    const html = renderReport(payloadOf(resultOf([]), { generatedAt: "2026-08-30" }), template);

    expect(html.replace(SLOT, "")).toBe(template.replace(SLOT, ""));
  });

  it("survives a `</script>` inside a snippet — the file still parses as one document", () => {
    const finding = {
      ...minimalFinding,
      snippet: {
        ...minimalFinding.snippet,
        before: "const html = '</script><script>alert(1)</script>'",
      },
    };
    const html = renderReport(
      payloadOf(resultOf([finding]), { generatedAt: "2026-08-30" }),
      builtTemplate(),
    );

    expect(html).not.toContain("</script><script>alert(1)");
    expect(
      (readBack(html) as { findings: { snippet: { before: string } }[] }).findings[0]?.snippet
        .before,
    ).toBe(finding.snippet.before);
  });

  it("survives `$'` and `$&` in a snippet — no replacement-pattern splice", () => {
    const finding = {
      ...minimalFinding,
      snippet: { ...minimalFinding.snippet, before: 'const weird = "$\' $& $` $$"' },
    };
    const html = renderReport(
      payloadOf(resultOf([finding]), { generatedAt: "2026-08-30" }),
      builtTemplate(),
    );

    expect(
      (readBack(html) as { findings: { snippet: { before: string } }[] }).findings[0]?.snippet
        .before,
    ).toBe(finding.snippet.before);
  });

  it("escapes the JS line terminators U+2028/U+2029", () => {
    const before = "a\u2028b\u2029c";
    const finding = { ...minimalFinding, snippet: { ...minimalFinding.snippet, before } };
    const html = renderReport(
      payloadOf(resultOf([finding]), { generatedAt: "2026-08-30" }),
      builtTemplate(),
    );
    const slot = SLOT.exec(html)?.[1] ?? "";

    expect(slot).not.toContain("\u2028");
    expect(slot).not.toContain("\u2029");
    expect(
      (readBack(html) as { findings: { snippet: { before: string } }[] }).findings[0]?.snippet
        .before,
    ).toBe(before);
  });

  it("refuses a template that is not a dashboard build instead of writing a broken file", () => {
    expect(() =>
      renderReport(payloadOf(resultOf([]), { generatedAt: "2026-08-30" }), "<html></html>"),
    ).toThrow(ReportTemplateError);
  });
});
