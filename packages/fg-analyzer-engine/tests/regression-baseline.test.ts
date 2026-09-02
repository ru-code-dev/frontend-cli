import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { analyzeFixture, BASELINE_FIXTURE_NAMES } from "./fixtures.ts";

/**
 * THE ADDITIVITY PROOF (design E5/E7).
 *
 * `analyzeProject` on every fixture that existed before the vanilla-extract work must
 * serialise to **the same bytes** it did before it. Not "the same findings": the same JSON,
 * key order included, because key order is what a schema change silently rewrites — zod
 * rebuilds a parsed object in schema order, so one field appended to `expectedSchema` would
 * move through every finding in the payload without a single assertion noticing.
 *
 * The goldens under `tests/golden/` were generated from the tree as it stood before the
 * collector was added and are regenerated only by hand. They carry the `.golden` extension
 * the EDS adapter's parity set already uses (`packages/fg-eds-adapter/tests/golden/`) and for
 * the same reason: a `.json` byte snapshot is a file the repository formatter would rewrite —
 * it collapses short arrays onto one line — and a snapshot a formatter edits proves nothing.
 *
 *     UPDATE_ENGINE_GOLDEN=1 pnpm --filter @smart-tools/fg-analyzer-engine test
 *
 * A regeneration is a deliberate act with a reason written next to it in the change ledger.
 * Nothing in the normal test path writes these files.
 *
 * The payload is machine-independent by construction: every path in it is project-relative
 * (`AnalyzerResult` carries no `root` — see `domain/findings.ts:309-327`), and there are no
 * timestamps or durations in it.
 */

const goldenDir = fileURLToPath(new URL("./golden/", import.meta.url));

const serialise = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

describe("byte-identical regression over the pre-existing fixtures", () => {
  for (const fixture of BASELINE_FIXTURE_NAMES) {
    it(`${fixture}: analyzeProject output is unchanged`, async () => {
      const actual = serialise(await analyzeFixture(fixture));
      const path = `${goldenDir}${fixture}.golden`;

      if (process.env["UPDATE_ENGINE_GOLDEN"] === "1") {
        mkdirSync(goldenDir, { recursive: true });
        writeFileSync(path, actual, "utf8");
      }

      expect(actual).toBe(readFileSync(path, "utf8"));
    });
  }
});
