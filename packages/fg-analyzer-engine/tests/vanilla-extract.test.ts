import { describe, expect, it } from "vite-plus/test";

import { scanFixture, styleValueAt, styleValuesOf } from "./fixtures.ts";

/**
 * The vanilla-extract collector (design §2.1/§2.2).
 *
 * Asserted on OBSERVATIONS rather than findings, because the engine's own eleven rules have
 * nothing to say about a style value's unit or token reference — a findings-level test here
 * would pass whatever the collector did, which is the definition of a tautological test. The
 * facts below are the ones a kit adapter's token rules read.
 */

const PANEL = "src/panel.css.ts";
const CARD = "src/card.css.ts";
const SHELL = "src/shell.ts";
const BADGE = "src/badge.css.ts";

describe("vanilla-extract — the style factories", () => {
  it("records the dialect on the profile", () => {
    const scan = scanFixture("vanilla-extract");

    expect(scan.profile.styleSyntaxes).toContain("vanilla-extract");
  });

  it("reads `style({ … })`, numbers included, with vanilla-extract's px rule", () => {
    const scan = scanFixture("vanilla-extract");

    // A number on a dimension property becomes pixels; the unitless list does not.
    expect(styleValueAt(scan, PANEL, "padding")?.value).toBe("21px");
    expect(styleValueAt(scan, PANEL, "border-radius")?.value).toBe("4px");
    expect(styleValueAt(scan, PANEL, "font-weight")?.value).toBe("500");
    expect(styleValueAt(scan, PANEL, "line-height")?.value).toBe("1.5");
    expect(styleValueAt(scan, PANEL, "z-index")?.value).toBe("3");
    expect(styleValueAt(scan, PANEL, "opacity")?.value).toBe("0.5");
    expect(styleValueAt(scan, PANEL, "flex-grow")?.value).toBe("1");
    expect(styleValueAt(scan, PANEL, "color")?.value).toBe("#2969e3");
  });

  it("descends into `selectors` and `@media` without inventing a selector called `selectors`", () => {
    const scan = scanFixture("vanilla-extract");
    const values = styleValuesOf(scan, PANEL);

    const hover = values.find((value) => value.property === "background-color");
    expect(hover?.selector).toBe("&:hover");
    expect(hover?.value).toBe("#ff1f78");

    // The condition is not the selector: a `@media` body still styles the enclosing rule.
    const responsive = values.filter((value) => value.property === "padding");
    expect(responsive.map((value) => value.value)).toEqual(["21px", "32px"]);
    expect(responsive.map((value) => value.selector)).toEqual(["panel", "panel"]);

    expect(values.some((value) => value.selector === "selectors")).toBe(false);
    expect(values.some((value) => value.selector === "@media")).toBe(false);
  });

  it("reads `styleVariants`, skipping the composed classes in an array form", () => {
    const scan = scanFixture("vanilla-extract");
    const borders = styleValuesOf(scan, PANEL).filter((value) => value.property === "border-color");

    expect(borders.map((value) => `${value.selector ?? ""}=${value.value}`)).toEqual([
      "tone.danger=#d0021b",
      "tone.calm=#4a90e2",
    ]);
  });

  it("reads a recipe's base, variants and compound variants", () => {
    const scan = scanFixture("vanilla-extract");
    const values = styleValuesOf(scan, PANEL);

    expect(values.find((value) => value.property === "border-radius")?.selector).toBe("button");
    expect(
      values
        .filter((value) => value.property === "font-size")
        .map((value) => `${value.selector ?? ""}=${value.value}`),
    ).toEqual(["button:size=sm=12px", "button:size=md=14px"]);
    expect(values.find((value) => value.property === "letter-spacing")?.selector).toBe(
      "button:compound[0]",
    );
  });

  it("does not read a recipe's configuration as if it were CSS", () => {
    const scan = scanFixture("vanilla-extract");
    const values = styleValuesOf(scan, PANEL);

    // `variants: { size: 'sm' }` and `defaultVariants` are configuration. The shape-based pass
    // would happily read them under invented property names if they were not marked.
    expect(values.some((value) => value.property === "size")).toBe(false);
    expect(values.some((value) => value.source !== "vanilla-extract")).toBe(false);
  });

  it("reads `globalStyle(selector, { … })`", () => {
    const scan = scanFixture("vanilla-extract");
    const global = styleValueAt(scan, PANEL, "margin-top");

    expect(global?.value).toBe("8px");
    expect(global?.selector).toBe("`${panel} > p`");
  });
});

describe("vanilla-extract — js-path token references", () => {
  it("turns a member path off a named import into a structured reference", () => {
    const scan = scanFixture("token-refs");
    const color = styleValueAt(scan, CARD, "color");

    expect(color?.value).toBe("themeTokens.sys.color.textPrimary");
    expect(color?.dynamic).toBe(false);
    expect(color?.reference).toEqual({
      kind: "js-path",
      module: "@acme/design-tokens",
      exportName: "themeTokens",
      path: ["sys", "color", "textPrimary"],
      spread: false,
    });
  });

  it("treats a string subscript as a spelling, not a computation", () => {
    const scan = scanFixture("token-refs");

    expect(styleValueAt(scan, CARD, "background-color")?.reference).toEqual({
      kind: "js-path",
      module: "@acme/design-tokens",
      exportName: "themeTokens",
      path: ["sys", "color", "surface"],
      spread: false,
    });
  });

  it("folds a namespace import back to the same reference a named import produces", () => {
    const scan = scanFixture("token-refs");

    // `import * as design` + `design.themeTokens.sys.color.border` must not become a token id
    // of its own, or one project spelling the same import two ways splits its own histogram.
    expect(styleValueAt(scan, CARD, "border-color")?.reference).toEqual({
      kind: "js-path",
      module: "@acme/design-tokens",
      exportName: "themeTokens",
      path: ["sys", "color", "border"],
      spread: false,
    });
  });

  it("keeps the literal parts of a template literal and the reference inside it", () => {
    const scan = scanFixture("token-refs");
    const shadow = styleValueAt(scan, CARD, "box-shadow");

    expect(shadow?.value).toBe("0px 0px 0px 1px inset");
    expect(shadow?.dynamic).toBe(true);
    expect(shadow?.authored).toBe("`${themeTokens.sys.color.shadow} 0px 0px 0px 1px inset`");
    expect(shadow?.reference?.kind).toBe("js-path");
  });

  it("refuses to guess a computed segment, and says so", () => {
    const scan = scanFixture("token-refs");
    const outline = styleValueAt(scan, CARD, "outline-color");

    expect(outline?.reference).toBeNull();
    expect(outline?.dynamic).toBe(true);

    // UNRESOLVED IS NOT CLEAN (design E5): the gap is on the record, at the right line.
    const limitation = scan.observations.limitations.find(
      (entry) => entry.reason === "unresolved-token-reference",
    );
    expect(limitation?.file).toBe(CARD);
    expect(limitation?.line).toBe(outline?.line);
    expect(limitation?.detail).toContain("вычисляемый сегмент");
  });

  it("records a spread of a token group, and marks it as one", () => {
    const scan = scanFixture("token-refs");
    const spread = styleValuesOf(scan, CARD).find(
      (value) => value.property === "..." && value.selector === "cardText",
    );

    expect(spread?.reference).toEqual({
      kind: "js-path",
      module: "@acme/design-tokens",
      exportName: "themeTokens",
      path: ["sys", "typography", "body"],
      spread: true,
    });

    // A property reference in the same object is NOT a spread — the two facts stay apart.
    const color = styleValuesOf(scan, CARD).find(
      (value) => value.property === "color" && value.selector === "cardText",
    );
    expect(color?.reference?.kind === "js-path" && color.reference.spread).toBe(false);
  });

  it("names a spread it cannot resolve to a token path", () => {
    const scan = scanFixture("token-refs");
    const spread = styleValuesOf(scan, CARD).find(
      (value) => value.property === "..." && value.selector === "cardMeta",
    );

    // `...localBase` hides an unknown number of declarations; the object must not read as if
    // `font-size` were all it declared.
    expect(spread?.reference).toBeNull();
    expect(spread?.dynamic).toBe(true);
    expect(
      scan.observations.limitations.some(
        (entry) => entry.reason === "unresolved-token-reference" && entry.detail.includes("spread"),
      ),
    ).toBe(true);
  });

  it("still reads the literals around the references", () => {
    const scan = scanFixture("token-refs");

    expect(styleValueAt(scan, CARD, "padding")?.value).toBe("12px");
  });
});

describe("vanilla-extract — which files take part", () => {
  it("reads a `.css.ts` whose factories come from a relative project module", () => {
    const scan = scanFixture("token-refs");
    const color = styleValueAt(scan, BADGE, "color");

    // Neither an `@vanilla-extract/*` import nor a kit-declared factory: the file name is the
    // only signal, and it is the one the bundler itself uses.
    expect(color?.source).toBe("vanilla-extract");
    expect(color?.reference).toEqual({
      kind: "js-path",
      module: "@acme/design-tokens",
      exportName: "themeTokens",
      path: ["sys", "color", "textTertiary"],
      spread: false,
    });
    expect(styleValueAt(scan, BADGE, "padding")?.value).toBe("3px");
    expect(styleValueAt(scan, BADGE, "gap")?.selector).toBe("badgeSize");
  });

  it("ignores a kit's own style factory until a kit declares it", () => {
    const scan = scanFixture("token-refs");
    const padding = styleValueAt(scan, SHELL, "padding");

    // `shell.css.ts` imports no `@vanilla-extract/*`, so with no adapter it is an ordinary
    // object literal: read by the shape-based pass, under no dialect. The member path is not a
    // literal to that pass, so the colour is not recorded AT ALL — which is precisely the
    // blindness the reference model exists to remove, and it is left on the record as a
    // limitation rather than as a clean line.
    expect(padding?.source).toBe("inline-style");
    expect(padding?.value).toBe("7px");
    expect(styleValueAt(scan, SHELL, "color")).toBeUndefined();
    expect(
      scan.observations.limitations.some(
        (entry) => entry.file === SHELL && entry.reason === "dynamic-styles",
      ),
    ).toBe(true);
  });

  it("reads it as vanilla-extract once the kit names the factory module", () => {
    const scan = scanFixture("token-refs", {
      kitPackages: ["@acme/kit"],
      wrappedUpstreamScope: null,
      styleFactories: [{ module: "@acme/kit", names: ["makeStyles"] }],
    });
    const color = styleValueAt(scan, SHELL, "color");

    expect(color?.source).toBe("vanilla-extract");
    expect(color?.reference).toEqual({
      kind: "js-path",
      module: "@acme/design-tokens",
      exportName: "themeTokens",
      path: ["sys", "color", "textSecondary"],
      spread: false,
    });
  });
});
