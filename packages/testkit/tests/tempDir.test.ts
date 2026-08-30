/**
 * SKELETON suite — the testkit's own helpers are test machinery, so they get tested like any
 * other code. A broken `makeTempDir` would surface as a confusing failure inside somebody
 * else's suite otherwise.
 */
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vite-plus/test";

import { makeTempDir, removeTempDir } from "../src/index.ts";

describe("makeTempDir / removeTempDir", () => {
  it("creates a real, distinct directory under the OS temp root", () => {
    const a = makeTempDir("fe-testkit-");
    const b = makeTempDir("fe-testkit-");
    try {
      expect(existsSync(a)).toBe(true);
      expect(existsSync(b)).toBe(true);
      expect(a).not.toBe(b);
      expect(a.startsWith(tmpdir())).toBe(true);
    } finally {
      removeTempDir(a);
      removeTempDir(b);
    }
  });

  it("removes the directory, and removing a gone one is not an error", () => {
    const dir = makeTempDir("fe-testkit-");
    removeTempDir(dir);
    expect(existsSync(dir)).toBe(false);
    expect(() => {
      removeTempDir(dir);
    }).not.toThrow();
  });
});
