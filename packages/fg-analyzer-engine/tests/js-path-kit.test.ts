import { describe, expect, it } from "vite-plus/test";

import {
  analyzeProject,
  analyzerResultSchema,
  tokenIdForReference,
  type KitAdapter,
  type Rule,
  type TokenReference,
} from "../src/index.ts";
import { fixturePath } from "./fixtures.ts";

/**
 * The adapter seam, driven by a design system whose tokens are a JS object (design §2.3–§2.6).
 *
 * The kit below is FAKE and deliberately so. What is under test is that the engine can serve a
 * js-path design system at all — the reference reaches the binding, the histogram counts it,
 * `expected.jsPath` survives to the wire — and a test built on the real adapter would prove
 * that the real adapter works rather than that this seam is kit-independent. Nothing here
 * names a module, an export or a factory that exists.
 */

const TOKEN_IDS: ReadonlyMap<string, string> = new Map([
  ["sys.color.textPrimary", "sys.color.text-primary"],
  ["sys.color.surface", "sys.color.surface"],
  ["sys.color.border", "sys.color.border"],
  ["sys.color.shadow", "sys.color.shadow"],
  ["sys.color.textSecondary", "sys.color.text-secondary"],
]);

/**
 * Resolution keys on the IMPORT, never on the identifier.
 *
 * The trap this shape exists to avoid: a project is free to have a token object of its own
 * called exactly what the kit calls its own, and a kit that matched on the name would claim
 * the project's tokens as its own on every line.
 */
const KIT_MODULES: ReadonlySet<string> = new Set([
  "@acme/design-tokens",
  "@acme/design-tokens/theme",
]);

const tokenIdOfReference = (reference: TokenReference): string | null => {
  if (reference.kind !== "js-path") {
    return null;
  }
  if (!KIT_MODULES.has(reference.module) || reference.exportName !== "themeTokens") {
    return null;
  }

  return TOKEN_IDS.get(reference.path.join(".")) ?? null;
};

/** A rule that does nothing but carry a `jsPath` suggestion to the wire. */
const jsPathSuggestionRule: Rule = {
  id: "token.js-path",
  category: "token",
  description: "Reports the first style value that references a token by member path.",
  label: { ru: "Токен по JS-пути", en: "Token by JS path" },
  run: (context) =>
    context.observations.styleValues
      .filter((styleValue) => styleValue.reference?.kind === "js-path")
      .slice(0, 1)
      .map((styleValue) => ({
        rule: "token.js-path",
        subkind: null,
        category: "token" as const,
        severity: "info" as const,
        confidence: 1,
        file: styleValue.file,
        line: styleValue.line,
        column: styleValue.column,
        actual: styleValue.value,
        expected: {
          token: "sys.color.text-primary",
          // A js-path kit publishes no custom property, so `cssVar` is honestly null and
          // `jsPath` carries the paste-ready replacement instead (design E8).
          cssVar: null,
          component: null,
          value: "themeTokens.sys.color.textPrimary",
          jsPath: "themeTokens.sys.color.textPrimary",
        },
        why: "Проверка контракта.",
        note: null,
        rootCause: null,
        appliedTo: null,
        autoFixable: false,
        needsAgent: false,
        candidates: [],
        impactKey: "token.js-path",
        replaceWith: null,
      })),
};

const fakeKit = (rules: readonly Rule[] = []): KitAdapter => ({
  id: "fake-js-path-kit",
  kitPackages: ["@acme/kit"],
  wrappedUpstreamScope: null,
  rules,
  domains: ["tokens"],
  binding: {
    iconCount: null,
    tokenColorHex: () => null,
    tokenIdOf: () => null,
    tokenIdOfReference,
    tokenColorHexOfReference: (reference) =>
      tokenIdOfReference(reference) === null ? null : "#101820",
    tokenReferenceModel: {
      kind: "js-path",
      modules: ["@acme/design-tokens", "@acme/design-tokens/theme"],
      exportName: "themeTokens",
      styleFactories: [{ module: "@acme/kit", names: ["makeStyles"] }],
    },
    a11yAvailable: false,
    canonicalComponentFor: () => null,
    variantValues: () => null,
    componentNames: () => [],
  },
});

describe("a kit whose tokens are a JS object", () => {
  it("counts js-path references in the token histogram", async () => {
    const result = await analyzeProject({
      dir: fixturePath("token-refs"),
      adapter: fakeKit(),
    });

    // Five resolvable references in `card.css.ts` — one inside a template literal, and
    // `textPrimary` twice — plus the one in `shell.ts`, which is visible only because the kit
    // declared `makeStyles` as a style factory. The spread is a group this kit cannot expand,
    // so it is a limitation rather than a count.
    expect(result.usage?.tokenUsage).toEqual({
      "sys.color.text-primary": 2,
      "sys.color.surface": 1,
      "sys.color.border": 1,
      "sys.color.shadow": 1,
      "sys.color.text-secondary": 1,
    });
  });

  it("counts nothing when the kit does not recognise the paths", async () => {
    const stranger = fakeKit();
    const result = await analyzeProject({
      dir: fixturePath("token-refs"),
      adapter: {
        ...stranger,
        binding: { ...stranger.binding, tokenIdOfReference: () => null },
      },
    });

    // Not a tautology: the same fixture, the same collector, only the kit's answer changed.
    expect(result.usage?.tokenUsage).toEqual({});
  });

  it("counts nothing for a kit with no js-path model at all", async () => {
    const stranger = fakeKit();
    const { tokenIdOfReference: _dropped, ...binding } = stranger.binding;
    const result = await analyzeProject({
      dir: fixturePath("token-refs"),
      adapter: { ...stranger, binding },
    });

    // An absent query is a different fact from "not a token", and neither may crash the run.
    expect(result.usage?.tokenUsage).toEqual({});
    expect(result.summary.findings.total).toBeGreaterThanOrEqual(0);
  });

  it("does not see the kit's own style factory without the declaration", async () => {
    const stranger = fakeKit();
    const { tokenReferenceModel: _dropped, ...binding } = stranger.binding;
    const result = await analyzeProject({
      dir: fixturePath("token-refs"),
      adapter: { ...stranger, binding },
    });

    // `shell.css.ts` falls back to an ordinary object literal, so its reference is gone and
    // the four in `card.css.ts` — which imports vanilla-extract directly — remain.
    expect(Object.keys(result.usage?.tokenUsage ?? {}).toSorted()).toEqual([
      "sys.color.border",
      "sys.color.shadow",
      "sys.color.surface",
      "sys.color.text-primary",
    ]);
  });

  it("turns a token group the kit cannot expand into a limitation", async () => {
    const result = await analyzeProject({
      dir: fixturePath("token-refs"),
      adapter: fakeKit(),
    });
    const unresolved = result.summary.limitations.filter(
      (entry) => entry.reason === "unresolved-token-reference",
    );

    // `...themeTokens.sys.typography.body` is a resolvable PATH, but this kit publishes no
    // such token, so the group cannot be expanded and the run says so — rather than letting a
    // typography rule call the object partial.
    expect(
      unresolved.some((entry) => entry.detail.includes("не смогла раскрыть эту группу токенов")),
    ).toBe(true);
  });

  it("stays silent about a group the kit CAN expand", async () => {
    const kit = fakeKit();
    const result = await analyzeProject({
      dir: fixturePath("token-refs"),
      adapter: {
        ...kit,
        binding: {
          ...kit.binding,
          tokenIdOfReference: (reference) =>
            reference.kind === "js-path" && reference.spread
              ? "sys.typography.body"
              : tokenIdOfReference(reference),
        },
      },
    });

    // Same fixture, same collector: only the kit's answer changed.
    expect(
      result.summary.limitations.some((entry) =>
        entry.detail.includes("не смогла раскрыть эту группу токенов"),
      ),
    ).toBe(false);
  });

  it("resolves by import source, not by identifier name", async () => {
    const kit = fakeKit();
    const result = await analyzeProject({
      dir: fixturePath("token-refs"),
      adapter: {
        ...kit,
        binding: {
          ...kit.binding,
          // A kit that only publishes from a subpath must not claim the barrel's paths, even
          // though the identifier reading them is spelled identically.
          tokenIdOfReference: (reference) =>
            reference.kind === "js-path" && reference.module === "@acme/design-tokens/theme"
              ? "sys.color.text-primary"
              : null,
        },
      },
    });

    expect(result.usage?.tokenUsage).toEqual({});
  });

  it("answers both reference channels through one entry point", () => {
    const binding = fakeKit().binding;

    // A kit may publish the same token as a custom property AND as a member path (design §6);
    // one function asks about either kind, so no caller has to branch and no two callers can
    // branch differently. That the two answers agree is the kit's guarantee — asserted here
    // against a kit that keeps that promise.
    expect(
      tokenIdForReference(
        { ...binding, tokenIdOf: () => "sys.color.text-primary" },
        { kind: "css-var", name: "--acme-sys-color-text-primary" },
      ),
    ).toBe("sys.color.text-primary");
    expect(
      tokenIdForReference(binding, {
        kind: "js-path",
        module: "@acme/design-tokens",
        exportName: "themeTokens",
        path: ["sys", "color", "textPrimary"],
        spread: false,
      }),
    ).toBe("sys.color.text-primary");
  });

  it("carries `expected.jsPath` to the wire, and validates against the schema", async () => {
    const result = await analyzeProject({
      dir: fixturePath("token-refs"),
      adapter: fakeKit([jsPathSuggestionRule]),
    });
    const finding = result.findings.find((entry) => entry.rule === "token.js-path");

    expect(finding?.expected?.jsPath).toBe("themeTokens.sys.color.textPrimary");
    expect(finding?.expected?.cssVar).toBeNull();
    expect(analyzerResultSchema.safeParse(result).success).toBe(true);
  });

  it("leaves `jsPath` ABSENT on every finding that does not set one", async () => {
    const result = await analyzeProject({
      dir: fixturePath("plain-css"),
      adapter: fakeKit(),
    });
    const withExpected = result.findings.filter((finding) => finding.expected !== null);

    // The additivity guarantee, asserted rather than asserted-about: an absent key is what
    // keeps every golden — this package's eight and the EDS adapter's parity set — byte-equal.
    expect(withExpected.length).toBeGreaterThan(0);
    for (const finding of withExpected) {
      expect(Object.hasOwn(finding.expected ?? {}, "jsPath")).toBe(false);
    }
  });
});
