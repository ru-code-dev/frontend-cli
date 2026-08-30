/**
 * TIER 1 — unit. `.env` loading against real temp directories (brief 3.3 deliverable 5).
 *
 * This is the one part of the CLI that cannot be tested with a fabricated value: the mechanism
 * IS `process.loadEnvFile`, a node built-in that reads a real path and writes into the real
 * `process.env`, and a fake would prove nothing about it. So the suite uses a real directory and
 * cleans up after itself — `makeTempDir`/`removeTempDir` from the dev-only testkit
 * (`packages/testkit/src/index.ts:22-29`), which is exactly what it exists for.
 *
 * No network, no subprocess: it stays tier 1.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { makeTempDir, removeTempDir } from "@smart-tools/fe-testkit";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { loadDotEnv } from "../src/dotenv.ts";
import { SETTING_KEYS, resolveSettings } from "../src/settings.ts";

/**
 * A key this repo does not otherwise use. `loadEnvFile` writes into the shared `process.env`,
 * and a test that wrote a REAL setting name could leak into a sibling suite; the round-trip into
 * `resolveSettings` is done with an explicit object instead, so nothing depends on the leak.
 */
const PROBE_KEY = "FE_CLI_DOTENV_PROBE";

const dirs: string[] = [];

function tempDirWith(files: Readonly<Record<string, string>>): string {
  const dir = makeTempDir("fe-dotenv-");
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) removeTempDir(dir);
  delete process.env[PROBE_KEY];
});

describe("./.env is loaded when it is there", () => {
  it("reports loaded and puts the values in the environment", () => {
    const dir = tempDirWith({ ".env": `${PROBE_KEY}=from-dotenv\n` });
    const result = loadDotEnv(dir);
    expect(result.loaded).toBe(true);
    expect(result.error).toBeUndefined();
    expect(process.env[PROBE_KEY]).toBe("from-dotenv");
  });

  it("a value loaded from .env then feeds the precedence chain as a tier-2 value", () => {
    const dir = tempDirWith({ ".env": `${SETTING_KEYS.token}=dotenv-token\n` });
    expect(loadDotEnv(dir).loaded).toBe(true);
    // Read back through the same door the CLI uses — an injected environment snapshot.
    const env = { ...process.env };
    expect(resolveSettings({}, env).token).toBe("dotenv-token");
    // ...and a flag still outranks it.
    expect(resolveSettings({ token: "flag" }, env).token).toBe("flag");
    delete process.env[SETTING_KEYS.token];
  });

  it("does NOT clobber a variable already in the environment", () => {
    // Verified behaviour of node v24.14.1's `loadEnvFile`, and the reason `.env` and the real
    // environment are ONE tier of the chain rather than two (design 2.1:110).
    process.env[PROBE_KEY] = "already-set";
    const dir = tempDirWith({ ".env": `${PROBE_KEY}=from-dotenv\n` });
    loadDotEnv(dir);
    expect(process.env[PROBE_KEY]).toBe("already-set");
  });

  it("skips junk lines rather than failing — node's parser is lenient", () => {
    const dir = tempDirWith({
      ".env": `this line has no equals sign\n=novalue\n${PROBE_KEY}=survived\n`,
    });
    const result = loadDotEnv(dir);
    expect(result.error).toBeUndefined();
    expect(process.env[PROBE_KEY]).toBe("survived");
  });
});

describe("no ./.env is not a problem", () => {
  it("reports not-loaded with no error, and says nothing", () => {
    const dir = tempDirWith({});
    const result = loadDotEnv(dir);
    expect(result.loaded).toBe(false);
    expect(result.error).toBeUndefined();
  });
});

describe("an unusable ./.env yields a localized error, never a stack trace", () => {
  it("a directory named .env is reported, in both languages, naming the path", () => {
    const dir = makeTempDir("fe-dotenv-");
    dirs.push(dir);
    mkdirSync(join(dir, ".env"));
    const result = loadDotEnv(dir);
    expect(result.loaded).toBe(false);
    expect(result.error).toBeDefined();
    if (result.error === undefined) return;
    expect(result.error.ru).not.toBe("");
    expect(result.error.en).not.toBe("");
    expect(result.error.ru).not.toBe(result.error.en);
    expect(result.error.ru).toContain(join(dir, ".env"));
    expect(result.error.en).toContain(join(dir, ".env"));
  });

  it("never throws", () => {
    const dir = makeTempDir("fe-dotenv-");
    dirs.push(dir);
    mkdirSync(join(dir, ".env"));
    expect(() => loadDotEnv(dir)).not.toThrow();
  });
});
