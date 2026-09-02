import { describe, expect, it } from "vite-plus/test";

import { globToRegExp } from "../src/discover.ts";
import { extractFixture } from "./harness.ts";

describe("exclusion globs", () => {
  it("anchors the pattern and supports `*` and `?`", () => {
    expect(globToRegExp("ui-*").test("ui-core")).toBe(true);
    expect(globToRegExp("ui-*").test("legacy-ui-core")).toBe(false);
    expect(globToRegExp("ui-cor?").test("ui-core")).toBe(true);
    expect(globToRegExp("ui-cor?").test("ui-corex")).toBe(false);
    expect(globToRegExp("ui-core").test("ui-core")).toBe(true);
    expect(globToRegExp("ui.core").test("uixcore")).toBe(false);
  });

  it("drops a package matched by directory name, along with everything it exported", () => {
    const kit = extractFixture("kit-a", ["ui-lab", "ui-broken"]);
    expect(kit.kit.packages.map((pkg) => pkg.name)).toEqual([
      "@fixture/ui-core",
      "@fixture/ui-legacy",
    ]);
    expect(Object.keys(kit.components)).not.toContain("Widget");
    expect(Object.keys(kit.types)).not.toContain("GlyphProps");
    // The excluded broken package no longer produces an unresolved entry either.
    expect(kit.unresolved.map((entry) => entry.export)).not.toContain("@fixture/ui-broken");
  });

  it("matches a glob against the package name as well as the directory name", () => {
    const kit = extractFixture("kit-a", ["@fixture/ui-le*"]);
    expect(kit.kit.packages.map((pkg) => pkg.name)).toEqual([
      "@fixture/ui-broken",
      "@fixture/ui-core",
      "@fixture/ui-lab",
    ]);
    expect(Object.keys(kit.components)).not.toContain("Badge");
  });

  it("keeps the remaining packages byte-identical to an unfiltered run", () => {
    const filtered = extractFixture("kit-a", ["ui-lab", "ui-broken", "ui-legacy"]);
    expect(Object.keys(filtered.components)).toEqual([
      "Box",
      "Button",
      "Card",
      "Card.Footer",
      "Card.Header",
      "CardHeader",
      "Maybe",
      "Panel",
      "Poly",
    ]);
  });
});
