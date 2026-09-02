import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { analyzeProject, type AnalyzerResult } from "@smart-tools/fe-analyzer-engine";

import { edsAdapter } from "../src/index.ts";

/**
 * Fixture plumbing for the parity suites.
 *
 * The fixtures are committed mini React projects under `tests/fixtures/`, each with its own
 * `package.json` so the scanner's root detection anchors on the fixture. They import `@sds-eng/*`
 * and `@v-uik/*` **without those packages existing** — deliberately, because it is the property
 * this whole analyzer is built on: nothing is installed, built or executed, and every fact comes
 * from reading source text. A fixture that needed `npm install` would be testing npm.
 *
 * Between them the four projects trigger all 32 of the hackathon's rule ids.
 */

export type FixtureName = "kit-api" | "kit-tokens" | "kit-icons" | "kit-components";

export const FIXTURES: readonly FixtureName[] = [
  "kit-api",
  "kit-tokens",
  "kit-icons",
  "kit-components",
];

export const fixturePath = (name: FixtureName): string =>
  fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url));

/** One of the three JSON artifacts the hackathon's `analyze` writes for a project. */
export type GoldenKind = "findings" | "usage" | "summary";

/**
 * The `.golden` extension is not decoration.
 *
 * These files are the reference tool's bytes, captured; they are evidence, not source, and the
 * repository formatter would reflow them the moment they were named `.json` — which is the one
 * edit that would quietly destroy what they prove. The extension is what keeps
 * `pnpm fmt` away from them.
 */
export const goldenPath = (name: FixtureName, kind: GoldenKind): string =>
  fileURLToPath(new URL(`./golden/${name}.${kind}.golden`, import.meta.url));

/**
 * The reference output, verbatim.
 *
 * Produced by `node <hackathon>/skills/ds-audit/scripts/ds.mjs analyze <fixture> --out <dir>`
 * and committed unedited — see `tests/parity.integration.test.ts`, which re-runs that command
 * and fails if these files have drifted from what it produces.
 *
 * **Editing a fixture invalidates them, and so does `pnpm fmt`**: findings carry line and column
 * numbers, so re-wrapping a fixture moves them. That is the intended behaviour rather than a
 * fragility — both suites go red together and the fix is to re-run the command above and copy
 * `findings.json`, `usage.json` and `summary.json` back over `tests/golden/<fixture>.<kind>.golden`.
 * A golden that could survive a fixture edit would not be evidence of anything.
 */
export const readGolden = (name: FixtureName, kind: GoldenKind): string =>
  readFileSync(goldenPath(name, kind), "utf8");

const cache = new Map<FixtureName, Promise<AnalyzerResult>>();

/** Analyses a fixture with the EDS adapter connected, memoised per fixture. */
export const analyzeWithAdapter = (name: FixtureName): Promise<AnalyzerResult> => {
  const cached = cache.get(name);
  if (cached !== undefined) {
    return cached;
  }

  const pending = analyzeProject({ dir: fixturePath(name), adapter: edsAdapter });
  cache.set(name, pending);

  return pending;
};

/**
 * Serialisation used by both sides of the comparison.
 *
 * Two spaces and a trailing newline, matching `writeJsonFile`
 * (`hackathon2026/ds-analyzer/src/shared/fs.ts`), so "byte-identical" means the bytes of the
 * file the reference tool wrote — not a normalised re-print of it. Key order is preserved by
 * `JSON.stringify` and is therefore part of what is being asserted.
 */
export const serialise = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
