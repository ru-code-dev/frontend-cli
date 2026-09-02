import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { extractComponentsV2 } from "../src/extract/v2/components.ts";
import { extractIconsV2 } from "../src/extract/v2/icons.ts";
import { extractKitA11yV2 } from "../src/extract/v2/kit-a11y.ts";
import { detectKitLayout, resolveKitPathsV2 } from "../src/extract/v2/paths.ts";
import { extractTokensV2 } from "../src/extract/v2/tokens.ts";
import { EMBEDDED_ARTIFACTS_V2 } from "../src/index.ts";

/**
 * TIER 2 — the v2 extractors against the real EDS 2.x checkout.
 *
 * This is the suite that makes the embedded v2 snapshot an EXTRACTION rather than a file
 * somebody once produced: it re-runs the pipeline over `../ui-kit-eds-ce-2` and asserts the
 * numbers S1 measured independently (`WORKFLOW/features/eds2/reports/s1-v2-facts.md` §1c, §2,
 * §3), then checks the embedded snapshot agrees with what the run just produced.
 *
 * The checkout is READ ONLY and is never installed into — the token extraction runs under a
 * vanilla-extract stub for exactly that reason. Skipped, loudly, when the sibling checkout is
 * not present, because a suite that silently passes on a machine without the kit proves nothing
 * on the machine that does have it.
 */

const CHECKOUT = fileURLToPath(new URL("../../../../ui-kit-eds-ce-2", import.meta.url));

const available = existsSync(CHECKOUT);
const when = available ? describe : describe.skip;

describe("the v2 checkout", () => {
  it("is present beside this repository", () => {
    // Deliberately NOT skipped: if the checkout is gone, this is the one line that says so
    // rather than a green run that checked nothing.
    expect(available, `expected an EDS 2.x checkout at ${CHECKOUT}`).toBe(true);
  });
});

when("extracting EDS 2.x from its own sources", () => {
  const paths = resolveKitPathsV2(CHECKOUT);

  it("recognises the layout, and tells the two EDS versions apart", () => {
    expect(detectKitLayout(CHECKOUT)).toBe("v2");
    // The 1.x builder's own test for "is this the kit" is `packages/theme/src`, which EDS 2.x
    // does not have (S1 break V1) — so detection has to precede it, not live inside it.
    expect(detectKitLayout(fileURLToPath(new URL("../", import.meta.url)))).toBeNull();
  });

  it("extracts 1079 tokens across five tiers, with every reference resolved", async () => {
    const tokens = await extractTokensV2(paths);

    expect(tokens.meta.counts.total).toBe(1079);
    expect(tokens.meta.counts.byTier).toEqual({
      comp: 30,
      edsRef: 314,
      edsSys: 258,
      ref: 269,
      sys: 208,
    });
    // Dark mode covers `edsSys` only, and 78 of its tokens actually differ (S1 §1c).
    expect(tokens.meta.counts.themeDependent).toBe(78);

    // NOT ONE unresolved `var()` left: the stub resolves the whole chain, which is what makes
    // the artifact comparable with the real library's output.
    const unresolved = tokens.tokens.filter(
      (token) => typeof token.resolved.light === "string" && token.resolved.light.includes("var("),
    );
    expect(unresolved).toEqual([]);

    // Every tier emits a custom property (S1 break V7) AND a member path — both channels, one id.
    expect(tokens.meta.counts.cssVariables).toBe(1079);
    expect(tokens.tokens.every((token) => (token.jsPath ?? null) !== null)).toBe(true);
    expect(tokens.meta.tokenReference).toBe("js-path");

    const accent = tokens.tokens.find((token) => token.id === "edsSys.Background.backAccent");
    expect(accent?.cssVariable).toBe("--sds-eng-edsSys-Background-backAccent");
    expect(accent?.jsPath).toBe("themeTokens.edsSys.Background.backAccent");
    expect(accent?.resolved).toEqual({ light: "#2969e3", dark: "#2a72f8" });

    // All 30 `comp` tokens are contracts `assignTokensContract` never fills (S1 §1b), so their
    // value is `null` and not an empty string pretending to be one.
    const comp = tokens.tokens.filter((token) => token.tier === "comp");
    expect(comp).toHaveLength(30);
    expect(comp.every((token) => token.resolved.light === null)).toBe(true);

    // 14 deprecated token KEYS. S1 counted 28 `@deprecated` occurrences in `edsSys.ts`
    // (break V15), and that file declares the tier TWICE — `edsSys` at :225 and `edsSysDark`
    // at :465 — with the same 14 keys tagged in each. A key is one token whichever theme
    // repeats it, so the artifact records 14 and not 28. See the report's V15 correction.
    expect(tokens.meta.deprecatedTokens).toBe(14);
    expect(tokens.tokens.filter((token) => token.deprecated === true)).toHaveLength(14);
    expect(
      tokens.tokens.filter((token) => token.deprecated === true).every((t) => t.tier === "edsSys"),
    ).toBe(true);

    // The dimension ramp `token.literal.dimension` judges v2 lengths against.
    expect(tokens.scales.allDimensionPx).toContain(4);
    expect(tokens.scales.allDimensionPx).toContain(16);
    expect(tokens.scales.allDimensionPx).not.toContain(13);
    expect(tokens.scales.fontFamilies.map((stack) => stack.split(",")[0])).toEqual([
      "SB Sans Display",
      "SB Sans Mono",
      "SB Sans Text",
    ]);
  });

  it("extracts both packages, the recipes and the declared exports", async () => {
    const components = await extractComponentsV2(paths);

    // Both packages contribute, and every component says which one it came from.
    const packages = new Set(components.components.map((component) => component.package));
    expect([...packages].toSorted()).toEqual(["@sds-eng/base-exp", "@sds-eng/kit-exp"]);

    // Variants come from `recipe({ variants })`, never from the inverted `as const` objects —
    // reading the latter would offer `CONTAINED|GHOST|OUTLINED` (S1 break V6).
    const button = components.components.find((component) => component.name === "Button");
    expect(button?.package).toBe("@sds-eng/kit-exp");
    const groups = Object.fromEntries(
      (button?.variants ?? []).map((variant) => [variant.name, [...variant.keys]]),
    );
    expect(groups["view"]).toEqual(["negative", "primary", "secondary"]);
    expect(groups["size"]).toEqual(["md", "sm", "xs"]);
    expect(groups["kind"]).toEqual(["contained", "ghost", "outlined"]);
    expect(button?.variants.every((variant) => variant.kind === "recipe")).toBe(true);

    // The declared subpaths that make `import.internal` correct (S1 break V2). S1 counts 33
    // `exports` KEYS; 32 of them are subpaths — the thirty-third is `"."`, the package root,
    // which is not a subpath and is never a deep import.
    expect(components.meta.exports?.["@sds-eng/base-exp"]).toHaveLength(32);
    expect(components.meta.exports?.["@sds-eng/base-exp"]).toContain("Button");
    expect(components.meta.exports?.["@sds-eng/kit-exp"]).toEqual([]);

    // The 30 style layers that make `style.override` able to name a component from a class.
    expect(components.meta.styleLayers).toHaveLength(30);
    expect(components.meta.styleLayers).toContain("text-field");

    // The public deprecations. THREE were expected (S1 break V15); two are real — see the
    // report's V15 correction: `Options` is declared `@deprecated` but `useConverter/index.ts`
    // re-exports only `useConverter` and `UseConverterOptions`, so it never reaches the barrel.
    const deprecated = components.publicSymbols
      .filter((symbol) => symbol.deprecated)
      .map((symbol) => symbol.name)
      .toSorted();
    expect(deprecated).toEqual(["useFieldSizing", "useLocalStorage"]);
    expect(deprecated).not.toContain("Options");
  });

  it("extracts 233 icons from 466 flat SVGs, and no legacy barrel", () => {
    const icons = extractIconsV2(paths);

    expect(icons.meta.counts).toEqual({ icons: 233, files: 466, unreadable: 0 });
    // Two sizes of one icon are one component (S1 §3), which is why 466 files are 233 icons.
    expect(icons.icons.every((icon) => icon.variants.length === 2)).toBe(true);
    expect(icons.legacyComponents).toEqual(["Icon"]);
  });

  it("reads accessibility evidence out of the kit's own sources, there being no upstream", async () => {
    const components = await extractComponentsV2(paths);
    const a11y = extractKitA11yV2({ paths, components });

    expect(a11y.meta.upstreamVersion).toBe("none");
    // `upstreamAvailable` means "the evidence was built", and it WAS — from the kit itself.
    expect(a11y.meta.upstreamAvailable).toBe(true);
    expect(a11y.patterns.length).toBeGreaterThan(15);
    expect(a11y.patterns.every((pattern) => pattern.matchedBy === "own-source")).toBe(true);
    expect(a11y.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "a11y-evidence-from-kit-sources",
    );

    const tooltip = a11y.patterns.find((pattern) => pattern.component === "Tooltip");
    expect(tooltip?.roles).toContain("tooltip");
  });

  it("agrees with the embedded snapshot — the artifacts ARE this pipeline's output", async () => {
    const tokens = await extractTokensV2(paths);
    const embedded = EMBEDDED_ARTIFACTS_V2.tokens;

    // Not a byte comparison: the embedded files carry a `meta.corpus` provenance stamp the
    // extractor deliberately does not add (`src/extract/provenance.ts`'s header). Everything the
    // extractor DOES decide is compared.
    expect(embedded.tokens).toEqual(tokens.tokens);
    expect(embedded.scales).toEqual(tokens.scales);
  });
});
