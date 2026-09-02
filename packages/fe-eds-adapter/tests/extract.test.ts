/**
 * TIER 1 — the five extractors, over a kit small enough to reason about completely.
 *
 * `tests/fixtures/mini-kit/` is a real design-system checkout in miniature: a `packages/theme`
 * with the same six files and the same `{edsRef.…}` template mechanism the real kit uses (its
 * `calcTheme.ts` is the real one, copied), and a `packages/base` with two components, four SVGs
 * and both barrels. Twenty-six files, no network, no install — the whole suite runs in about a
 * second.
 *
 * WHY A FIXTURE AT ALL, when `parse-ui-kit.integration.test.ts` already proves the extractors
 * against the real kit byte for byte. Because those two suites answer different questions and
 * neither substitutes for the other. The integration one asks "is the port faithful?", needs a
 * checkout outside this repository and a private registry, and is therefore tier 2 — it cannot
 * be what a contributor runs before pushing. This one asks "does each extractor still do the
 * thing it is for?", and it can say WHICH thing broke: a fixture with two components and one
 * deprecated symbol names the failure, while a 2.7-megabyte diff against `tokens.json` says only
 * that something moved.
 *
 * THE ASSERTIONS ARE ABOUT MECHANISMS, NOT COUNTS. Each one pins a behaviour that has a reason
 * to exist somewhere else in the port: the theme is EXECUTED rather than parsed (so
 * `rgba({ref},0.06)` becomes `#rrggbbaa`), `as const` variant literals are read syntactically,
 * `ioNN-Name.svg` groups variants by name, a file outside the convention is counted rather than
 * dropped, and the TF-IDF prop weighting is computed over the public components. A test that
 * asserted "23 tokens" would fail on every fixture edit and teach nothing when it did.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { extractComponents } from "../src/extract/components/extract.ts";
import { extractIcons } from "../src/extract/icons/extract.ts";
import { extractKitA11y } from "../src/extract/kit-a11y/extract.ts";
import { extractKnowledge } from "../src/extract/kit-knowledge/extract.ts";
import { ExtractionError } from "../src/extract/shared/errors.ts";
import { resolveKitPaths } from "../src/extract/paths.ts";
import { extractTokens } from "../src/extract/tokens/extract.ts";
import { loadThemeSource } from "../src/extract/tokens/loader.ts";

const MINI_KIT = fileURLToPath(new URL("fixtures/mini-kit", import.meta.url));

const paths = resolveKitPaths({ uiKitRoot: MINI_KIT });

describe("resolveKitPaths", () => {
  it("refuses a directory that is not a UI kit", () => {
    expect(() =>
      resolveKitPaths({ uiKitRoot: fileURLToPath(new URL(".", import.meta.url)) }),
    ).toThrow(ExtractionError);
  });

  it("reports no upstream when @v-uik is not installed", () => {
    expect(paths.upstreamDir).toBeNull();
  });
});

describe("the theme loader (typescript + node:vm, no esbuild)", () => {
  const theme = loadThemeSource(paths.themeSrcDir);

  it("executes the sources rather than parsing them", () => {
    // `sysLight.Background.backAccent` is authored as the STRING `'{edsRef.color.blue}'`. Only
    // running `calcTheme()` turns it into the primitive it points at; an AST reader would have
    // to reimplement the resolution, which is the alternative the loader's header rejects.
    expect(theme.sysLight["Background"]).toMatchObject({ backAccent: "{edsRef.color.blue}" });
    expect(theme.light.edsSys["Background"]).toMatchObject({ backAccent: "#0055ff" });
  });

  it("performs the kit's own rgba(...) alpha merge", () => {
    // `rgba({edsRef.color.blue},0.06)` → `#0055ff0f`. The kit's arithmetic, step by step
    // (`ui-kit-eds-ce/packages/theme/src/calcTheme.ts:30-42`): the opacity text `"0.06"` has its
    // `"0."` STRIPPED to `"06"`, which is then read as the NUMBER 6 — so `round(255 * 6 / 100)`
    // = 15 = `0f`. It is idiosyncratic enough that any reimplementation would get it wrong,
    // which is the argument for executing the real file rather than parsing it.
    expect(theme.light.edsSys["Border"]).toMatchObject({ borderBase: "#0055ff0f" });
  });

  it("resolves both modes from the same sources", () => {
    expect(theme.dark.edsSys["Background"]).toMatchObject({ backAccent: "#ffffff" });
  });

  it("spreads a namespace import of a barrel directory", () => {
    // `comp.ts` is `{ backwardCompatibilityMode: false, ...theme }` where `theme` is
    // `import * as theme from './theme'`, a directory whose index only `export *`s. Getting this
    // right is the reason the transpile runs with `esModuleInterop`.
    expect(Object.keys(theme.comp)).toContain("button");
  });

  it("refuses a directory missing the required sources", () => {
    expect(() => loadThemeSource(paths.baseSrcDir)).toThrow(ExtractionError);
  });
});

describe("tokens", () => {
  it("flattens every tier, sorted by id, with css variables only where the kit emits them", async () => {
    const artifact = await extractTokens(paths);
    const ids = artifact.tokens.map((token) => token.id);

    expect(ids).toEqual([...ids].sort());
    expect(ids).toContain("ref.color.blue");
    expect(ids).toContain("sys.Background.backAccent");
    expect(ids).toContain("comp.button.shapeBorderRadius");

    const accent = artifact.tokens.find((token) => token.id === "sys.Background.backAccent");
    expect(accent?.resolved).toEqual({ light: "#0055ff", dark: "#ffffff" });
    expect(accent?.themeDependent).toBe(true);
    // The prefix is the kit's own (`tokens/css-variables.ts`), not one this port chose.
    expect(accent?.cssVariable).toBe("--sds-eng-Background-backAccent");

    // The `comp` tier ships no CSS variables — `flatten.ts:168` gates it on the slice, and
    // fabricating names the kit never emits is the bug that gate prevents.
    const compToken = artifact.tokens.find((token) => token.tier === "comp");
    expect(compToken?.cssVariable).toBeNull();
  });

  it("derives the scales from the ref tier and stamps the theme package version", async () => {
    const artifact = await extractTokens(paths);
    expect(artifact.scales.borderRadiusPx).toEqual([2, 4]);
    expect(artifact.scales.fontFamilies).toContain("Inter");
    expect(artifact.meta.themePackageVersion).toBe("9.9.9");
    expect(artifact.meta.sourceRoot).toBe("packages/theme/src");
  });

  it("is deterministic across runs", async () => {
    const [first, second] = await Promise.all([extractTokens(paths), extractTokens(paths)]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("components", () => {
  it("reads variants, publicness and deprecation syntactically", async () => {
    const artifact = await extractComponents(paths);
    const names = artifact.components.map((component) => component.name);
    expect(names).toEqual(["Button", "Legacy"]);

    const button = artifact.components.find((component) => component.name === "Button");
    // `public` is decided by the component barrel, not by the directory existing: `Legacy` is a
    // directory nobody re-exports, and calling it public would make the report recommend it.
    expect(button?.public).toBe(true);
    expect(artifact.components.find((component) => component.name === "Legacy")?.public).toBe(
      false,
    );

    // Variants are `as const` OBJECTS mapping the public value to the one forwarded upstream.
    // Only the KEYS are the consumer contract — `<Button view="error"/>` is invalid even though
    // `'error'` is on the right-hand side (`components/variants.ts:10-22`) — and both halves are
    // recorded so a rule can also recognise a raw upstream value that bypassed the mapping.
    const views = button?.variants.find((variant) => variant.name === "views");
    // In AUTHORING order, not sorted: these are the values a consumer writes, and the order the
    // kit declares them in is the order a help message or a suggestion should list them in.
    expect(views?.keys).toEqual(["primary", "secondary", "negative"]);
    expect(views?.values).toMatchObject({ negative: "error" });

    // No type checker is available on a bare checkout, and the artifact says so rather than
    // implying the props were resolved through one.
    expect(artifact.meta.typeCheckerAvailable).toBe(false);
  });

  it("records the upstream packages a component wraps", async () => {
    const artifact = await extractComponents(paths);
    expect(artifact.components.find((component) => component.name === "Button")?.wraps).toEqual([
      "@v-uik/base",
    ]);
  });
});

describe("icons", () => {
  it("groups ioNN-Name.svg variants by name and counts what it could not read", () => {
    const artifact = extractIcons(paths);

    expect(artifact.icons.map((icon) => icon.name)).toEqual(["dot", "star"]);
    // Two sizes of one icon are one icon with two variants, ordered by size — that grouping is
    // the whole point of the naming convention.
    expect(
      artifact.icons.find((icon) => icon.name === "star")?.variants.map((v) => v.size),
    ).toEqual([16, 24]);
    // `not-an-icon.svg` is OUTSIDE the convention. It is counted, not skipped: "a shrinking
    // artifact must be visible in review" (`icons/extract.ts:13-15`).
    expect(artifact.meta.counts).toMatchObject({ icons: 2, files: 4, unreadable: 1 });
  });

  it("fingerprints geometry, so two sizes of one glyph differ and a shape is stable", () => {
    const artifact = extractIcons(paths);
    const star = artifact.icons.find((icon) => icon.name === "star");
    const [small, large] = star?.variants ?? [];
    expect(small?.fingerprint).toBeTruthy();
    expect(small?.fingerprint).not.toBe(large?.fingerprint);
    expect(extractIcons(paths).icons).toEqual(artifact.icons);
  });

  it("reads the legacy hand-written barrel — and only ever finds single-quoted re-exports", () => {
    // `Icon` is unconditional (the wrapper lives in `components/`); `Bulb` is the fixture's
    // `export { Bulb } from "./old/Bulb"`, and it is ABSENT — which is the assertion.
    expect(extractIcons(paths).legacyComponents).toEqual(["Icon"]);
  });

  it("finds the legacy exports when the barrel is quoted the way the kit quotes it", () => {
    // THE BRITTLENESS, PINNED RATHER THAN FIXED. `icons/extract.ts`'s `LEGACY_EXPORT` regex
    // spells the quote literally — `from\s+'\.\/old\//` — so it matches `'./old/Bulb'` and
    // not `"./old/Bulb"`. That is correct for the real kit, whose barrel is single-quoted, and
    // the byte-identity suite proves it reproduces `kit-icons.json` exactly; widening the regex
    // would be changing extractor behaviour to suit a test, which is the one thing this port
    // must not do.
    //
    // It cannot be shown from `fixtures/mini-kit` because THIS repository's formatter rewrites
    // every `.ts` file to double quotes (`pnpm fmt`), so the fixture can only ever exercise the
    // non-matching half. Hence a barrel written here, at runtime, in the kit's own style — which
    // also makes the sensitivity visible to whoever next wonders why the fixture finds one name.
    const root = mkdtempSync(join(tmpdir(), "fe-icons-quotes-"));
    try {
      mkdirSync(join(root, "packages", "theme", "src"), { recursive: true });
      const icons = join(root, "packages", "base", "src", "icons");
      mkdirSync(join(icons, "svg"), { recursive: true });
      writeFileSync(
        join(icons, "index.ts"),
        "export * from './components'\nexport { Bulb } from './old/Bulb'\nexport { Lamp } from './old/Lamp'\n",
        "utf8",
      );

      const legacy = extractIcons(resolveKitPaths({ uiKitRoot: root })).legacyComponents;
      // Sorted, de-duplicated, with the always-present wrapper folded in.
      expect(legacy).toEqual(["Bulb", "Icon", "Lamp"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("kit-a11y without an installed upstream", () => {
  it("degrades to a recorded gap instead of throwing", async () => {
    const components = await extractComponents(paths);
    const artifact = extractKitA11y({ paths, components });

    expect(artifact.meta).toMatchObject({ upstreamAvailable: false, packagesScanned: 0 });
    expect(artifact.patterns).toEqual([]);
    // The diagnostic is the contract: a rule that depends on this artifact must be able to say
    // "not checked" rather than silently finding nothing.
    expect(artifact.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "upstream-not-installed",
    );
  });
});

describe("kit-knowledge", () => {
  it("describes only public components, weighting props by rarity", async () => {
    const components = await extractComponents(paths);
    const a11y = extractKitA11y({ paths, components });
    const { signatures, cards } = extractKnowledge({ paths, components, a11y });

    expect(signatures.signatures.map((signature) => signature.name)).toEqual(["Button"]);

    const button = signatures.signatures[0];
    expect(button?.propSignature).toEqual(["disabled", "size", "view"]);
    // TF-IDF over one public component: log(1/1) = 0 for every prop it declares. The value is
    // uninteresting; that it is COMPUTED rather than defaulted is what this pins.
    expect(Object.keys(button?.propWeights ?? {})).toEqual(["disabled", "size", "view"]);
    expect(button?.nativeTags).toContain("span");

    // Synonyms are a kit-agnostic table, so a component named `Button` has none while the card
    // still lists the example file next to it.
    expect(cards.cards[0]?.t1.examples).toEqual(["Basic"]);
  });

  it("takes its inputs as values, so it cannot read a stale artifact from disk", async () => {
    const components = await extractComponents(paths);
    // Passing `a11y: null` is the "upstream never ran" case, and it must produce empty ARIA
    // fields rather than reaching for a `kit-a11y.json` somewhere.
    const { signatures } = extractKnowledge({ paths, components, a11y: null });
    expect(signatures.signatures[0]?.ariaRoles).toEqual([]);
  });
});
