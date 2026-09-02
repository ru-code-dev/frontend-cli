import { describe, expect, it } from "vite-plus/test";

import { stableStringify } from "../src/serialize.ts";
import { extractFixture } from "./harness.ts";

describe("determinism", () => {
  it("produces byte-identical JSON on two independent runs over the same kit", () => {
    const first = stableStringify(extractFixture("kit-a"));
    const second = stableStringify(extractFixture("kit-a"));
    expect(second).toBe(first);
    // A real run, not an empty one.
    expect(first.length).toBeGreaterThan(2000);
  });

  it("is byte-identical for the second fixture kit too", () => {
    expect(stableStringify(extractFixture("kit-b"))).toBe(stableStringify(extractFixture("kit-b")));
  });

  it("emits every object key in sorted order at every depth", () => {
    const json = stableStringify(extractFixture("kit-a"));
    const parsed: unknown = JSON.parse(json);

    const assertSorted = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => assertSorted(item, `${path}[${index}]`));
        return;
      }
      if (typeof value === "object" && value !== null) {
        const keys = Object.keys(value as Record<string, unknown>);
        expect(keys, `keys of ${path}`).toEqual([...keys].sort());
        for (const key of keys)
          assertSorted((value as Record<string, unknown>)[key], `${path}.${key}`);
      }
    };

    assertSorted(parsed, "$");
  });

  it("contains no absolute path from the machine it ran on", () => {
    const json = stableStringify(extractFixture("kit-a"));
    expect(json).not.toContain("/packages/fe-kit-extract/tests/fixtures");
  });
});
