import { describe, expect, it } from "vite-plus/test";

import { COMPONENTS, KIT_A11Y, KIT_ICONS, KIT_SIGNATURES, TOKENS } from "../src/artifacts/index.ts";

/**
 * The check that replaces runtime validation.
 *
 * `src/artifacts/index.ts` casts five JSON files to hand-written interfaces without parsing
 * them through a schema, and the header of `src/domain/artifacts.ts` argues why: the files are
 * compiled into this package's own `dist`, so a runtime check would validate the build against
 * itself and cost a second of every run to do it. That argument only holds if the shape is
 * checked *somewhere*, and this is where.
 *
 * Assertions are on the fields the specs and rules actually read, plus counts, so a
 * re-extraction that renamed a field or halved a table fails here rather than silently changing
 * what the analyzer reports.
 */

describe("the embedded artifacts", () => {
  it("declare the schema ids they were extracted under", () => {
    expect(TOKENS.$schema).toBe("ds-analyzer/tokens@1");
    expect(COMPONENTS.$schema).toBe("ds-analyzer/components@1");
    expect(KIT_A11Y.$schema).toBe("ds-analyzer/kit-a11y@1");
    expect(KIT_ICONS.$schema).toBe("ds-analyzer/kit-icons@1");
    expect(KIT_SIGNATURES.$schema).toBe("ds-analyzer/kit-signatures@1");
  });

  it("carry the token table and the scales the token rules read", () => {
    expect(TOKENS.tokens.length).toBeGreaterThan(2000);

    const withVariable = TOKENS.tokens.filter((token) => token.cssVariable !== null);
    expect(withVariable.length).toBeGreaterThan(500);

    const sample = TOKENS.tokens.find((token) => token.tier === "sys" && token.color !== null);
    expect(sample).toBeDefined();
    expect(sample?.id.startsWith("sys.")).toBe(true);
    expect(sample?.pathString.length).toBeGreaterThan(0);
    expect(typeof sample?.color?.light?.hex).toBe("string");

    for (const scale of [
      "borderRadiusPx",
      "borderWidthPx",
      "fontSizePx",
      "lineHeightPx",
    ] as const) {
      expect(TOKENS.scales[scale].length).toBeGreaterThan(0);
    }
    expect(TOKENS.scales.fontFamilies.length).toBeGreaterThan(0);
  });

  it("carry component variants, slots, wrap targets and deprecations", () => {
    expect(COMPONENTS.components.length).toBeGreaterThan(50);

    const button = COMPONENTS.components.find((component) => component.name === "Button");
    expect(button?.public).toBe(true);
    expect(button?.variants.some((variant) => variant.name === "views")).toBe(true);
    expect(button?.slots.flatMap((set) => set.slots).length).toBeGreaterThan(0);
    expect(button?.wraps.length).toBeGreaterThan(0);

    expect(COMPONENTS.publicSymbols.some((symbol) => symbol.deprecated)).toBe(true);
  });

  it("carry the upstream accessibility evidence the keyboard rule needs", () => {
    // `available === false` would make `a11y.pattern.keyboard` silent and turn its parity
    // fixture into a test of nothing.
    expect(KIT_A11Y.meta.upstreamAvailable).toBe(true);
    expect(KIT_A11Y.patterns.length).toBeGreaterThan(0);
    expect(KIT_A11Y.patterns.some((pattern) => pattern.roles.includes("tablist"))).toBe(true);
    expect(KIT_A11Y.spacing.gridBase).toBeGreaterThan(0);
  });

  it("carry icon geometry with fingerprints", () => {
    expect(KIT_ICONS.meta.counts.icons).toBeGreaterThan(0);
    expect(KIT_ICONS.icons.length).toBe(KIT_ICONS.meta.counts.icons);

    const variant = KIT_ICONS.icons[0]?.variants[0];
    expect(variant?.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(variant?.paths.length).toBeGreaterThan(0);
  });

  it("carry component signatures with prop weights and AST streams", () => {
    expect(KIT_SIGNATURES.signatures.length).toBe(KIT_SIGNATURES.meta.counts.components);
    expect(KIT_SIGNATURES.signatures.length).toBeGreaterThan(50);

    const sample = KIT_SIGNATURES.signatures.find(
      (signature) => signature.astSignature.length > 40,
    );
    expect(sample).toBeDefined();
    expect(Object.keys(sample?.propWeights ?? {}).length).toBeGreaterThan(0);
  });
});
