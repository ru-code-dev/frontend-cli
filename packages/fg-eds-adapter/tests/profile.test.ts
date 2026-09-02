import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeProject, ruleCatalog } from "@smart-tools/fg-analyzer-engine";
import { afterAll, describe, expect, it } from "vite-plus/test";

import {
  createEdsAdapter,
  EDS_PROFILES,
  eds2Adapter,
  edsAdapter,
  EMBEDDED_ARTIFACTS,
  EMBEDDED_ARTIFACTS_V2,
  EMBEDDED_VERSION,
  EMBEDDED_VERSION_V2,
  KIT_PROFILE_IDS,
  KitSpec,
} from "../src/index.ts";
import { iconComponentName } from "../src/extract/v2/icons.ts";
import { kitClassesIn } from "../src/rules/api/kit-classes.ts";
import { isImportant } from "../src/rules/style-value.ts";

/**
 * THE PROFILE IS THE SEAM — this suite is what makes that claim checkable.
 *
 * Almost every assertion below walks `EDS_PROFILES` rather than naming a kit, because the
 * property being tested is not "EDS 2.x behaves like this" but "a design system's behaviour is
 * decided by its profile". A third profile added tomorrow is covered by these tests the moment
 * it is registered; a rule that starts branching on `id` instead of reading a field breaks them.
 *
 * The style syntaxes are checked against the ENGINE's own schema (`styleSyntaxSchema`), because
 * `KitStyleSyntax` is a copy of an enum this package cannot import, and a copy nobody checks is
 * a copy that drifts.
 */

const scratch = mkdtempSync(join(tmpdir(), "fg-eds2-profile-"));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A throwaway consumer project on disk; the scanner anchors on its `package.json`. */
const project = (name: string, files: Readonly<Record<string, string>>): string => {
  const root = join(scratch, name);
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, content, "utf8");
  }
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name, dependencies: { "@sds-eng/kit-exp": "^2.0.0" } }),
    "utf8",
  );
  return root;
};

const findingsOf = async (root: string, adapter = eds2Adapter) =>
  (await analyzeProject({ dir: root, adapter })).findings;

describe("the profile registry", () => {
  it("registers exactly the ids the adapters publish, and no adapter invents its own", () => {
    expect(KIT_PROFILE_IDS).toEqual(["eds", "eds2"]);
    expect(Object.keys(EDS_PROFILES)).toEqual([...KIT_PROFILE_IDS]);

    for (const id of KIT_PROFILE_IDS) {
      expect(EDS_PROFILES[id].id).toBe(id);
      expect(EDS_PROFILES[id].corpusDir).toBe(id);
    }
    expect(edsAdapter.id).toBe(EDS_PROFILES.eds.id);
    expect(eds2Adapter.id).toBe(EDS_PROFILES.eds2.id);
  });

  it("gives every profile a token channel, and never zero of them", () => {
    for (const profile of Object.values(EDS_PROFILES)) {
      const channels = profile.tokenReference;
      expect(channels.cssVar !== null || channels.jsPath !== null).toBe(true);
      // `prefer` must name a channel that exists, or a finding would offer a spelling the kit
      // does not publish.
      expect(
        channels.prefer === "js-path" ? channels.jsPath !== null : channels.cssVar !== null,
      ).toBe(true);
    }
  });

  it("declares only style syntaxes the engine's own schema accepts", () => {
    // `KitStyleSyntax` is a COPY of an enum the engine does not export from its entry point
    // (`src/profile.ts`'s header says so), and a copy nobody checks is a copy that drifts. So
    // the engine's own source is read and the enum's members are taken out of it: the check
    // fails the day the engine renames one, which is exactly when it should.
    const source = readFileSync(
      fileURLToPath(new URL("../../fg-analyzer-engine/src/domain/profile.ts", import.meta.url)),
      "utf8",
    );
    const block = /styleSyntaxSchema = z\.enum\(\[([\s\S]*?)\]\)/.exec(source)?.[1] ?? "";
    const known = [...block.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);

    expect(known).toContain("vanilla-extract");
    expect(known.length).toBeGreaterThan(5);

    for (const profile of Object.values(EDS_PROFILES)) {
      for (const syntax of profile.styling) expect(known).toContain(syntax);
    }
  });

  it("keeps the two kits' packages disjoint, so autodetect can never see both", () => {
    const overlap = EDS_PROFILES.eds.packages.filter((name) =>
      EDS_PROFILES.eds2.packages.includes(name),
    );
    expect(overlap).toEqual([]);
  });

  it("offers the SAME 32 rule ids under both profiles — one fg.config.json fits either", () => {
    // Design E6: `import.bypass` stays registered under a kit that wraps nothing precisely so
    // this stays true. A catalog that shrank with the kit would make a shared config a lie.
    const v1 = ruleCatalog(edsAdapter)
      .map((rule) => rule.id)
      .toSorted();
    const v2 = ruleCatalog(eds2Adapter)
      .map((rule) => rule.id)
      .toSorted();

    expect(v2).toEqual(v1);
    expect(v2).toHaveLength(32);
  });
});

describe("createEdsAdapter over a profile", () => {
  it("defaults to EDS 1.x and takes its kit facts from the profile, not from constants", () => {
    const built = createEdsAdapter();
    expect(built.id).toBe("eds");
    expect(built.kitPackages).toEqual(EDS_PROFILES.eds.packages);
    expect(built.wrappedUpstreamScope).toBe("@v-uik");
    // No js-path model: the binding is exactly the object it was before EDS 2.x existed.
    expect(built.binding.tokenReferenceModel).toBeUndefined();
    expect(built.binding.tokenIdOfReference).toBeUndefined();
  });

  it("builds a v2 adapter whose binding declares the js-path channel", () => {
    expect(eds2Adapter.kitPackages).toEqual(["@sds-eng/base-exp", "@sds-eng/kit-exp"]);
    expect(eds2Adapter.wrappedUpstreamScope).toBeNull();

    const model = eds2Adapter.binding.tokenReferenceModel;
    expect(model?.kind).toBe("js-path");
    expect(model?.exportName).toBe("themeTokens");
    // Three spellings of the same object (S1 trap T2) — a single module string would drop two.
    expect(model?.modules).toEqual([
      "@sds-eng/base-exp",
      "@sds-eng/kit-exp",
      "@sds-eng/base-exp/theme",
    ]);
    expect(model?.styleFactories?.map((factory) => factory.module)).toEqual([
      "@sds-eng/base-exp",
      "@sds-eng/kit-exp",
    ]);
  });

  it("stamps each embedded snapshot with the DESIGN SYSTEM's own version", () => {
    expect(EMBEDDED_VERSION).toBe("1.13.0");
    expect(EMBEDDED_VERSION_V2).toBe("2.0.0");
  });
});

describe("KitSpec over the v2 profile", () => {
  const kit = new KitSpec(
    EMBEDDED_ARTIFACTS_V2.tokens,
    EMBEDDED_ARTIFACTS_V2.components,
    "light",
    EDS_PROFILES.eds2,
  );
  const v1 = new KitSpec(EMBEDDED_ARTIFACTS.tokens, EMBEDDED_ARTIFACTS.components);

  it("indexes the same token under both channels", () => {
    const byPath = kit.tokenByJsPath("themeTokens.edsSys.Background.backAccent");
    const byVariable = kit.tokenByCssVariable("--sds-eng-edsSys-Background-backAccent");

    expect(byPath?.id).toBe("edsSys.Background.backAccent");
    expect(byVariable?.id).toBe(byPath?.id);
    expect(byPath?.resolved).toEqual({ light: "#2969e3", dark: "#2a72f8" });
  });

  it("resolves a js-path reference by IMPORT SOURCE and refuses a stranger's object", () => {
    const path = ["edsSys", "Background", "backAccent"];

    expect(
      kit.tokenForReference({
        kind: "js-path",
        module: "@sds-eng/kit-exp",
        exportName: "themeTokens",
        path,
      })?.id,
    ).toBe("edsSys.Background.backAccent");

    // S1 trap T1: the kit's own showroom has a `themeTokens` of its own. Same identifier, same
    // member names, a different module — and therefore not a kit token.
    expect(
      kit.tokenForReference({
        kind: "js-path",
        module: "@showroom/shared/theme",
        exportName: "themeTokens",
        path,
      }),
    ).toBeNull();
  });

  it("expands a SPREAD of a token group instead of calling it unresolved", () => {
    // Design §6's spread rule: the group is a resolved reference, so the engine must not record
    // an `unresolved-token-reference` limitation against code that applies a whole ramp.
    expect(
      kit.tokenIdForReference({
        kind: "js-path",
        module: "@sds-eng/base-exp",
        exportName: "themeTokens",
        path: ["edsSys", "Typography", "Body", "BodyM"],
        spread: true,
      }),
    ).toBe("edsSys.Typography.Body.BodyM");

    expect(
      kit.tokenIdForReference({
        kind: "js-path",
        module: "@sds-eng/base-exp",
        exportName: "themeTokens",
        path: ["edsSys", "NoSuchGroup"],
        spread: true,
      }),
    ).toBeNull();
  });

  it("fills BOTH channels in `expected`, and omits jsPath entirely for a css-var-only kit", () => {
    const token = kit.tokenByJsPath("themeTokens.edsSys.Background.backAccent");
    const expected = kit.expectedFor(token!);

    expect(expected?.value).toBe("themeTokens.edsSys.Background.backAccent");
    expect(expected?.cssVar).toBe("--sds-eng-edsSys-Background-backAccent");
    expect(expected?.jsPath).toBe("themeTokens.edsSys.Background.backAccent");

    // THE BYTE-IDENTITY GUARD. `jsPath: null` here would write the key into every EDS 1.x
    // finding and break the parity goldens.
    const v1Expected = v1.expectedFor(v1.tokenByCssVariable("--sds-eng-Background-backAccent")!);
    expect(v1Expected?.value).toBe("var(--sds-eng-Background-backAccent)");
    expect(Object.keys(v1Expected ?? {})).not.toContain("jsPath");
  });

  it("reads variant values from the recipe group under v2 and from the plural under v1", () => {
    expect(kit.variantValues("Button", "view")).toEqual(["negative", "primary", "secondary"]);
    expect(kit.variantValues("Button", "size")).toEqual(["md", "sm", "xs"]);
    // The v1 convention is a plural const object; asking for the exact name finds nothing there.
    expect(v1.variantValues("Button", "view")).not.toBeNull();
  });

  it("knows which subpaths the kit declares public", () => {
    expect(kit.declaredExports("@sds-eng/base-exp")).toContain("Button");
    expect(kit.declaredExports("@sds-eng/base-exp")).toContain("theme");
    expect(kit.declaredExports("@sds-eng/base-exp")).not.toContain("dist");
    // v1 declares none, which is what keeps `import.internal` unchanged there.
    expect(v1.declaredExports("@sds-eng/base")).toEqual([]);
  });

  it("orders the style layers longest-first, so `text-field` beats `text`", () => {
    const layers = kit.styleLayers;
    expect(layers).toContain("text-field");
    expect(layers.indexOf("text-field")).toBeLessThan(layers.indexOf("text"));
  });
});

describe("the kit-class matcher", () => {
  const kit = new KitSpec(
    EMBEDDED_ARTIFACTS_V2.tokens,
    EMBEDDED_ARTIFACTS_V2.components,
    "light",
    EDS_PROFILES.eds2,
  );

  it("reads a component out of an attribute selector and grades the descendant as inner", () => {
    expect(kitClassesIn("[class*='sds-eng-button-root']", kit)).toEqual([
      { component: "Button", slot: "root", matched: "sds-eng-button-root", inner: false },
    ]);

    const [inner] = kitClassesIn("`${panel} [class*='sds-eng-text-field-input'] input`", kit);
    expect(inner).toEqual({
      component: "TextField",
      slot: "input",
      matched: "sds-eng-text-field-input",
      inner: true,
    });
  });

  it("finds nothing for a kit whose profile declares no class prefix", () => {
    const v1 = new KitSpec(EMBEDDED_ARTIFACTS.tokens, EMBEDDED_ARTIFACTS.components);
    expect(kitClassesIn("[class*='sds-eng-button-root']", v1)).toEqual([]);
  });

  it("ignores a class that is not one of the kit's declared layers", () => {
    expect(kitClassesIn("[class*='sds-eng-not-a-layer-root']", kit)).toEqual([]);
  });
});

describe("`!important` in a vanilla-extract value", () => {
  it("is read out of the value text, which is the only place it can be", () => {
    const base = {
      property: "width",
      authored: null,
      file: "a.css.ts",
      line: 1,
      column: 1,
      source: "vanilla-extract" as const,
      selector: null,
      classNames: [],
      dynamic: false,
      rootCause: null,
      reference: null,
      appliedTo: null,
    };

    expect(isImportant({ ...base, value: "213px !important", important: false })).toBe(true);
    expect(isImportant({ ...base, value: "213px", important: false })).toBe(false);
    // The CSS collectors keep setting the flag, and it still wins.
    expect(isImportant({ ...base, value: "213px", important: true })).toBe(true);
  });
});

describe("the v2 icon name rule", () => {
  it("re-implements the generator's own derivation", () => {
    // The `_generated` directory the kit's barrel imports is gitignored and absent from a
    // checkout (S1 §3), so these names cannot be read — only derived.
    expect(iconComponentName("accordions-down")).toBe("AccordionsDown");
    expect(iconComponentName("META-API")).toBe("MetaAPI");
    expect(iconComponentName("2fa")).toBe("Twofa");
    expect(iconComponentName("Pulse-color")).toBe("PulseColor");
  });
});

describe("the rules, under the v2 profile", () => {
  it("honours declared subpath exports and still reports a path outside them", async () => {
    const root = project("imports", {
      "src/a.ts": [
        "import { Button } from '@sds-eng/base-exp/Button'",
        "import { themeTokens } from '@sds-eng/base-exp/theme'",
        "import { Card } from '@sds-eng/base-exp/dist/components/Card'",
        "export const use = [Button, themeTokens, Card]",
      ].join("\n"),
    });

    const internal = (await findingsOf(root)).filter((f) => f.rule === "import.internal");
    expect(internal.map((f) => f.actual)).toEqual(["@sds-eng/base-exp/dist/components/Card"]);
  });

  it("registers import.bypass, emits nothing and says why", async () => {
    const root = project("bypass", {
      "src/a.ts": "import { Button } from '@v-uik/base'\nexport const x = Button",
    });
    const result = await analyzeProject({ dir: root, adapter: eds2Adapter });

    expect(result.findings.filter((f) => f.rule === "import.bypass")).toEqual([]);
    expect(result.summary.limitations.map((l) => l.reason)).toContain("no-upstream");
    // The gap is a property of the DESIGN SYSTEM, so it is stated once and not per file.
    expect(result.summary.limitations.filter((l) => l.reason === "no-upstream")).toHaveLength(1);
  });

  it("reports a deprecated hook at its IMPORT, which is the only place it appears", async () => {
    const root = project("deprecated", {
      "src/a.ts": [
        "import { useLocalStorage, useConverter } from '@sds-eng/base-exp'",
        "export const use = [useLocalStorage, useConverter]",
      ].join("\n"),
    });

    const found = (await findingsOf(root)).filter((f) => f.rule === "api.deprecated");
    expect(found.map((f) => f.actual)).toEqual(["useLocalStorage"]);
    // The kit writes its replacement in backticks; the note carries it rather than shrugging.
    expect(found[0]?.expected?.component).toBe("useStorage");
  });

  it("never reads an import as deprecated under a profile that does not ask it to", async () => {
    const root = project("deprecated-v1", {
      "src/a.ts": "import { Input } from '@sds-eng/base'\nexport const use = Input",
    });
    const found = (await findingsOf(root, edsAdapter)).filter((f) => f.rule === "api.deprecated");
    // `Input` IS deprecated in the 1.x kit; the 1.x profile still only reads elements.
    expect(found).toEqual([]);
  });

  it("reports a reference-tier colour and leaves the shape scale alone", async () => {
    const root = project("tiers", {
      "src/a.css.ts": [
        "import { themeTokens } from '@sds-eng/base-exp'",
        "import { style } from '@vanilla-extract/css'",
        "export const a = style({",
        "  backgroundColor: themeTokens.edsRef.palette.electric.electric700,",
        "  borderRadius: themeTokens.edsRef.borderRadius.m,",
        "  color: themeTokens.edsSys.Foreground.foreParagraph,",
        "})",
      ].join("\n"),
    });

    const found = (await findingsOf(root)).filter((f) => f.rule === "token.tier.violation");
    expect(found.map((f) => f.actual)).toEqual(["themeTokens.edsRef.palette.electric.electric700"]);
    // The replacement is offered in the spelling this kit's consumers write.
    expect(found[0]?.expected?.value).toMatch(/^themeTokens\./);
  });

  it("recognises BOTH primitive tiers, not just the kit's legacy one", async () => {
    // S1 break V5: EDS 2.x carries two palettes — `edsRef` (the 1.x one) and `ref` (a newer
    // material-style pair with `sys`). A rule that knew only the first would leave half the
    // tier system invisible, and `ref.palette.coldGray90` is the half that would be missed.
    const root = project("both-tiers", {
      "src/a.css.ts": [
        "import { themeTokens } from '@sds-eng/base-exp'",
        "import { style } from '@vanilla-extract/css'",
        "export const a = style({ borderColor: themeTokens.ref.palette.coldGray90 })",
      ].join("\n"),
    });

    const found = (await findingsOf(root)).filter((f) => f.rule === "token.tier.violation");
    expect(found.map((f) => f.actual)).toEqual(["themeTokens.ref.palette.coldGray90"]);
  });

  it("reports a palette reference even when the kit publishes no same-role twin", async () => {
    // The 1.x rule fires only when a semantic token of the SAME ROLE holds the same colour,
    // because without one there is no fix to ask for. Under v2 the primitive tiers are the
    // kit's internal composition layer, so the reference is wrong on its own — and the finding
    // then carries NO replacement rather than a background token offered for a border.
    const root = project("no-twin", {
      "src/a.css.ts": [
        "import { themeTokens } from '@sds-eng/base-exp'",
        "import { style } from '@vanilla-extract/css'",
        "export const a = style({ borderColor: themeTokens.ref.palette.coldGray90 })",
      ].join("\n"),
    });

    const found = (await findingsOf(root)).find((f) => f.rule === "token.tier.violation");
    expect(found?.expected).toBeNull();
    expect(found?.autoFixable).toBe(false);
  });

  it("leaves a literal that IS on the kit's ramp alone", async () => {
    // EDS 2.x's ramp is complete, so an on-scale number is the kit's own step written as a
    // number; reporting every `gap: 8` at `info` would bury the ones that are off the scale.
    const root = project("on-scale", {
      "src/a.css.ts": [
        "import { style } from '@vanilla-extract/css'",
        "export const a = style({ fontSize: '16px', borderRadius: '4px', gap: 8 })",
      ].join("\n"),
    });

    expect((await findingsOf(root)).filter((f) => f.rule === "token.literal.dimension")).toEqual(
      [],
    );
  });

  it("judges an off-ramp length on a property the engine's list declines", async () => {
    const root = project("dimensions", {
      "src/a.css.ts": [
        "import { style } from '@vanilla-extract/css'",
        "export const a = style({ height: 21, width: 16 })",
      ].join("\n"),
    });

    const found = (await findingsOf(root)).filter((f) => f.rule === "token.literal.dimension");
    // 21 is not on the kit's 41-value dimension set; 16 is, so it is clean rather than `info`.
    expect(found.map((f) => f.actual)).toEqual(["21px"]);
  });
});

/**
 * V6 AUDIT FINDING #1 — THE TOOL'S OWN FIX MUST NOT BE THE TOOL'S NEXT ERROR.
 *
 * Under a profile whose `tierViolation` is `any-colour`, every primitive-tier colour reference
 * is an error, so a `token.literal.color` finding that offers `themeTokens.ref.palette.orchid40`
 * hands the reader a paste that fails the next run. Four of eleven colour fixes on the v2
 * fixture did exactly that.
 *
 * The property under test is a ROUND TRIP, not a string: apply every replacement the tool
 * offers, run again, and count the tier violations that were not there before. Zero is the only
 * passing number, and it is checked by re-running the analyzer over the rewritten source rather
 * than by asserting on the shape of a suggestion.
 */
describe("a suggestion a v2 consumer can actually paste", () => {
  it("never offers a primitive-tier colour, and says why instead", async () => {
    const root = project("no-semantic-twin", {
      // `#7c3aed` is 0.058 from `ref.palette.orchid40` (a PRIMITIVE) and 0.072 from the nearest
      // semantic token — so the kit's nearest answer is raw paint, which product code may not
      // name here.
      "src/a.css.ts": [
        "import { style } from '@vanilla-extract/css'",
        "export const a = style({ backgroundColor: '#7c3aed' })",
      ].join("\n"),
    });

    const found = (await findingsOf(root)).find((f) => f.rule === "token.literal.color");

    // The GRADE is unchanged — the kit does hold a colour this close, and saying otherwise
    // would be a second lie (V6 finding #8).
    expect(found?.subkind).toBe("shade");
    expect(found?.why).toContain("ref.palette.orchid40");
    // The replacement is withheld, in every field that carries one.
    expect(found?.expected).toBeNull();
    expect(found?.autoFixable).toBe(false);
    // And the absence is explained rather than left as silence.
    expect(found?.note).toContain("примитив ref.palette.orchid40");
    expect(found?.note).toContain("семантической роли «background»");
  });

  it("prefers the semantic twin when the same colour has one", async () => {
    // `#2969e3` is held by `edsRef.palette.electric.electric700` AND by
    // `edsSys.Background.backAccent`. Before this change the palette entry could win the tie;
    // the offerable one must.
    const root = project("semantic-twin", {
      "src/a.css.ts": [
        "import { style } from '@vanilla-extract/css'",
        "export const a = style({ backgroundColor: '#2969e3' })",
      ].join("\n"),
    });

    const found = (await findingsOf(root)).find((f) => f.rule === "token.literal.color");
    expect(found?.subkind).toBe("exact");
    expect(found?.expected?.token).toBe("edsSys.Background.backAccent");
    expect(found?.autoFixable).toBe(true);
  });

  it("keeps offering the palette entry under a profile that allows one", async () => {
    // EDS 1.x's `tierViolation` is `same-role-only`: there the palette entry is legal product
    // code and withholding it would be withholding the only advice that exists. The parity
    // goldens say the same thing; this says it in one assertion.
    // `color:` is the case that separates the two kits: EDS 1.x publishes no white under a
    // FOREGROUND role either, and where EDS 2.x now withholds, EDS 1.x falls back to the
    // palette entry — which is legal product code there and the only advice that exists.
    const root = project("v1-palette", {
      "src/a.css": ".a { color: #FFFFFF }",
    });

    const found = (await findingsOf(root, edsAdapter)).find(
      (f) => f.rule === "token.literal.color",
    );
    expect(found?.expected?.token).toBe("ref.palette.white");
    expect(found?.expected?.value).toBe("var(--sds-eng-palette-white)");
  });

  it("introduces no new tier violation when its own fixes are applied", async () => {
    const before = project("round-trip", {
      "src/a.css.ts": [
        "import { themeTokens } from '@sds-eng/base-exp'",
        "import { style } from '@vanilla-extract/css'",
        "export const a = style({",
        "  backgroundColor: '#2969e3',",
        "  borderColor: '#7c3aed',",
        "  color: '#FFFFFF',",
        "})",
      ].join("\n"),
    });

    const first = await findingsOf(before);
    const source = readFileSync(join(before, "src/a.css.ts"), "utf8");
    const fixed = first.reduce(
      (text, finding) =>
        finding.expected === null
          ? text
          : text.replace(`'${finding.actual}'`, finding.expected.value),
      source,
    );
    // At least one fix was offered, or the round trip would pass vacuously.
    expect(fixed).not.toBe(source);

    const after = project("round-trip-fixed", { "src/a.css.ts": fixed });
    const introduced = (await findingsOf(after)).filter((f) => f.rule === "token.tier.violation");
    expect(introduced.map((f) => f.actual)).toEqual([]);
  });
});

/**
 * V6 AUDIT FINDING #4 — THE FILE DECIDES THE SPELLING, NOT THE PROFILE.
 *
 * `expectedFor` used to read `profile.tokenReference.prefer` alone, so every finding in a v2
 * project offered a member path — including findings in the plain `.css` files the v2 profile
 * itself declares as a dialect it expects. A JS member path is not a CSS value, so that
 * suggestion was one a reader could not use.
 *
 * One fixture file per syntax, and the three rules that offer a token are all checked, because
 * each reaches `expectedFor` by its own route.
 */
describe("the replacement channel follows the file", () => {
  const both = {
    "src/a.css":
      ".x { background-color: var(--sds-eng-edsRef-palette-electric-electric700) }\n.y { color: #2969e3; font-family: Inter, sans-serif }",
    "src/b.css.ts": [
      "import { themeTokens } from '@sds-eng/base-exp'",
      "import { style } from '@vanilla-extract/css'",
      "export const x = style({ backgroundColor: themeTokens.edsRef.palette.electric.electric700 })",
      "export const y = style({ color: '#2969e3', fontFamily: 'Inter, sans-serif' })",
    ].join("\n"),
  };

  it("offers CSS a custom property and vanilla-extract a member path", async () => {
    const found = await findingsOf(project("channels", both));
    const valueOf = (rule: string, file: string) =>
      found.find((f) => f.rule === rule && f.file === file)?.expected?.value ?? null;

    for (const rule of ["token.tier.violation", "token.literal.color", "font.foreign"]) {
      expect(valueOf(rule, "src/a.css")).toMatch(/^var\(--sds-eng-/);
      expect(valueOf(rule, "src/b.css.ts")).toMatch(/^themeTokens\./);
    }
  });

  it("carries BOTH channels whichever file it came from", async () => {
    const found = await findingsOf(project("channels-both", both));

    for (const file of ["src/a.css", "src/b.css.ts"]) {
      const finding = found.find((f) => f.rule === "token.literal.color" && f.file === file);
      // The same token, named twice — only `value` moves.
      expect(finding?.expected?.token).toBe("edsSys.Foreground.foreAccentHover");
      expect(finding?.expected?.cssVar).toBe("--sds-eng-edsSys-Foreground-foreAccentHover");
      expect(finding?.expected?.jsPath).toBe("themeTokens.edsSys.Foreground.foreAccentHover");
    }
  });

  it("leaves a css-var-only kit with the one spelling it has", async () => {
    // EDS 1.x publishes no member path, so no syntax can produce one — the guard that keeps the
    // parity goldens byte-identical.
    const root = project("v1-channel", { "src/a.css": ".a { color: #FFFFFF }" });
    const found = (await findingsOf(root, edsAdapter)).find(
      (f) => f.rule === "token.literal.color",
    );
    expect(found?.expected?.value).toMatch(/^var\(/);
    expect(found?.expected?.jsPath).toBeUndefined();
  });
});

/**
 * V6 AUDIT FINDING #7 — THE POSITIVES CARD NAMES THE MECHANISM IT OBSERVED.
 *
 * «N обращений к M токенам через CSS-переменные» was printed for a v2 project whose CSS holds
 * no `var(--…)` at all. The card is the half of the report a reader quotes as evidence that a
 * migration landed, so naming the wrong mechanism there is worse than naming none.
 */
const cardOf = async (root: string, adapter = eds2Adapter): Promise<string> => {
  const result = await analyzeProject({ dir: root, adapter });
  return (
    result.summary.positives?.find((entry) => entry.label === "Токены используются")?.detail ?? ""
  );
};

describe("the token-usage positive", () => {
  it("says «через themeTokens» for a project that references tokens in JS", async () => {
    const root = project("channel-js", {
      "src/a.css.ts": [
        "import { themeTokens } from '@sds-eng/base-exp'",
        "import { style } from '@vanilla-extract/css'",
        "export const a = style({ color: themeTokens.edsSys.Foreground.foreParagraph })",
      ].join("\n"),
    });

    expect(await cardOf(root)).toContain("через themeTokens");
    expect(await cardOf(root)).not.toContain("CSS-переменные");
  });

  it("says «через CSS-переменные» for a project that writes custom properties", async () => {
    const root = project("channel-css", {
      "src/a.css": ".a { color: var(--sds-eng-edsSys-Foreground-foreParagraph) }",
    });

    expect(await cardOf(root)).toContain("через CSS-переменные");
    expect(await cardOf(root)).not.toContain("themeTokens");
  });

  it("names BOTH when a project is mid-migration", async () => {
    const root = project("channel-mixed", {
      "src/a.css": ".a { color: var(--sds-eng-edsSys-Foreground-foreParagraph) }",
      "src/b.css.ts": [
        "import { themeTokens } from '@sds-eng/base-exp'",
        "import { style } from '@vanilla-extract/css'",
        "export const b = style({ color: themeTokens.edsSys.Foreground.foreParagraph })",
      ].join("\n"),
    });

    const detail = await cardOf(root);
    expect(detail).toContain("через CSS-переменные (1)");
    expect(detail).toContain("через themeTokens (1)");
  });
});
