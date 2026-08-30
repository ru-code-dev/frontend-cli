/**
 * TIER 1 — unit. The FEATURE SEAM.
 *
 * The design's cost test for adding a feature is "a new package plus one import line"
 * (design 2.1:79-81). These assertions pin the properties that claim rests on, and they are
 * written to keep holding as features land rather than to describe today's contents: nothing
 * here names a pixso command or a count, so `pnpm test` will not need editing when brief 3.2
 * fills `pixsoCommands`.
 */
import { pick } from "@smart-tools/fe-cli-kit";
import { describe, expect, it } from "vite-plus/test";

import { COMMANDS } from "../src/main.ts";
import { optionName } from "../src/parse.ts";
import { COMMANDS as REGISTRY } from "../src/registry.ts";

describe("the registry is assembled from the feature packages", () => {
  it("is a flat array", () => {
    expect(Array.isArray(REGISTRY)).toBe(true);
  });

  it("is re-exported by main unchanged — one list, no second copy to drift", () => {
    expect(COMMANDS).toBe(REGISTRY);
  });
});

describe("whatever the registry holds is well-formed", () => {
  it("every flag is a long flag, and every alias is a distinct spelling", () => {
    for (const command of REGISTRY) {
      expect(command.flag.startsWith("--")).toBe(true);
      expect(optionName(command.flag)).not.toBe("");
      if (command.alias !== undefined) {
        expect(command.alias.startsWith("-")).toBe(true);
        expect(command.alias).not.toBe(command.flag);
      }
    }
  });

  it("no two commands claim the same spelling", () => {
    const spellings = REGISTRY.flatMap((c) =>
      [c.flag, c.alias].filter((s): s is string => s !== undefined).map(optionName),
    );
    expect(new Set(spellings).size).toBe(spellings.length);
  });

  it("no command collides with a global — those are the CLI's own surface", () => {
    const globals = new Set(["out", "token", "endpoint", "lang", "help", "version", "debug"]);
    for (const command of REGISTRY) {
      expect(globals.has(optionName(command.flag))).toBe(false);
      if (command.alias !== undefined) {
        expect(globals.has(optionName(command.alias))).toBe(false);
      }
    }
  });

  it("every command ships BOTH languages — for its summary and every argument", () => {
    // The contract types this (`packages/cli-kit/src/index.ts:25-28`), but the type cannot stop
    // a feature package pasting the English string into the `ru` field.
    for (const command of REGISTRY) {
      expect(pick(command.summary, "ru")).not.toBe("");
      expect(pick(command.summary, "en")).not.toBe("");
      for (const arg of command.args) {
        expect(pick(arg.description, "ru")).not.toBe("");
        expect(pick(arg.description, "en")).not.toBe("");
        expect(arg.name).not.toBe("");
      }
    }
  });
});
