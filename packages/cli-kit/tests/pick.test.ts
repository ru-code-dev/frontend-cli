/**
 * `pick` is the only executable thing in the frozen contract, so it is the only thing here
 * that can be tested. Everything else in `src/index.ts` is a type, and the typecheck gate
 * (`tsgo -p tsconfig.json`) is what proves those.
 */
import { describe, expect, it } from "vite-plus/test";

import { pick, type Localized } from "../src/index.ts";

const HELLO: Localized = { ru: "привет", en: "hello" };

describe("pick — resolving a Localized for the language in play", () => {
  it("returns the russian side for `ru`", () => {
    expect(pick(HELLO, "ru")).toBe("привет");
  });

  it("returns the english side for `en`", () => {
    expect(pick(HELLO, "en")).toBe("hello");
  });

  it("is pure — it reads the input and never rewrites it", () => {
    const before = { ...HELLO };
    pick(HELLO, "ru");
    pick(HELLO, "en");
    expect(HELLO).toEqual(before);
  });
});
