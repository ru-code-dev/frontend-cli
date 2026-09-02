import { describe, expect, it } from "vite-plus/test";

import { extractFixture } from "./harness.ts";

/**
 * kit-b ships its own `tsconfig.json` whose `paths` alias is the ONLY way `@kitb/core` resolves.
 * If the extractor fell back to its defaults, `Chip` would be unreachable from the `ext` package
 * and `Frame`'s delegated root would collapse to `root-component-not-in-kit`.
 */
describe("a kit with its own tsconfig", () => {
  const kit = extractFixture("kit-b");

  it("uses the kit's tsconfig rather than the built-in defaults", () => {
    expect(kit.kit.tsconfig).toBe("tsconfig.json");
    expect(kit.kit.compilerOptions).toBe("tsconfig");
  });

  it("honours the tsconfig's `paths` alias when following a cross-package root", () => {
    expect(kit.components.Frame?.renders).toEqual({
      element: "span",
      confidence: "delegated",
      via: ["Chip"],
      reason: null,
    });
  });

  it("records a component re-exported by two packages once, not as a collision", () => {
    expect(Object.keys(kit.components)).toEqual(["Chip", "Frame"]);
    expect(kit.components.Chip?.package).toBe("@fixture/kitb-core");
    expect(kit.unresolved).toEqual([]);
  });

  it("falls back to the documented defaults when a kit ships no tsconfig", () => {
    const kitA = extractFixture("kit-a");
    expect(kitA.kit.tsconfig).toBeNull();
    expect(kitA.kit.compilerOptions).toBe("defaults");
  });
});
