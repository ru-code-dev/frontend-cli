import { fileURLToPath } from "node:url";

import {
  analyzeProject,
  scanProject,
  type AnalyzerResult,
  type Domain,
  type Finding,
  type ScanOptions,
  type ScanResult,
  type StyleValue,
} from "../src/index.ts";

/**
 * Fixture plumbing for the tier-1 lane.
 *
 * The fixtures are committed mini React projects under `tests/fixtures/`, each with its own
 * `package.json` so the scanner's root detection anchors on the fixture rather than on this
 * repository. Nothing is generated at test time and nothing touches the network: a rule test
 * that had to build its own input would be testing the builder.
 *
 * Every fixture is analysed once per test file and the result is cached, because a run parses
 * the whole fixture with ts-morph and ESLint — cheap for one project, not cheap thirty times.
 */

/**
 * The fixtures that existed before the vanilla-extract work, in one list.
 *
 * A list rather than a bare union type because `regression-baseline.test.ts` has to iterate
 * it: these eight are what design E5/E7's "byte-identical" is measured over, and each has a
 * golden beside it. Anything added to this list needs a golden generated from a tree that
 * predates the change being proved additive, which no later change can produce — so new
 * fixtures go in {@link EXTRA_FIXTURE_NAMES} instead, and the proof stays a proof.
 */
export const BASELINE_FIXTURE_NAMES = [
  "plain-css",
  "css-modules",
  "styled-components",
  "emotion",
  "dialog",
  "duplicates",
  "foreign-icons",
  "clean",
] as const;

/** Fixtures added with the vanilla-extract collector; asserted on directly, not by golden. */
export const EXTRA_FIXTURE_NAMES = ["vanilla-extract", "token-refs"] as const;

export type FixtureName =
  | (typeof BASELINE_FIXTURE_NAMES)[number]
  | (typeof EXTRA_FIXTURE_NAMES)[number];

export const fixturePath = (name: FixtureName): string =>
  fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url));

const cache = new Map<string, Promise<AnalyzerResult>>();

/** Analyses a fixture, memoised per (fixture, domains) pair. */
export const analyzeFixture = async (
  name: FixtureName,
  domains?: readonly Domain[],
): Promise<AnalyzerResult> => {
  const key = `${name}::${domains?.join(",") ?? "all"}`;
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const pending = analyzeProject({
    dir: fixturePath(name),
    ...(domains === undefined ? {} : { domains }),
  });
  cache.set(key, pending);

  return pending;
};

/**
 * The raw observations of a fixture — what the collectors recorded, before any rule saw them.
 *
 * The collector suites assert here rather than on findings, and the distinction matters: the
 * engine's own eleven rules say nothing about a style value's property, unit or token
 * reference, so a findings-level assertion about `padding: 21 → 21px` would be asserting
 * against silence. `scanProject` is the public entry point for exactly this reason
 * (`src/index.ts:174-190`).
 */
export const scanFixture = (name: FixtureName, kit?: ScanOptions["kit"]): ScanResult =>
  scanProject({ path: fixturePath(name), ...(kit === undefined ? {} : { kit }) });

/** Style values a fixture recorded for one file, in collection order. */
export const styleValuesOf = (scan: ScanResult, file: string): readonly StyleValue[] =>
  scan.observations.styleValues.filter((styleValue) => styleValue.file === file);

/** One style value by file and CSS property; `undefined` when the collector recorded none. */
export const styleValueAt = (
  scan: ScanResult,
  file: string,
  property: string,
): StyleValue | undefined =>
  scan.observations.styleValues.find(
    (styleValue) => styleValue.file === file && styleValue.property === property,
  );

/** Findings of one rule, in the engine's own (file, line, column) order. */
export const findingsOf = (result: AnalyzerResult, rule: string): Finding[] =>
  result.findings.filter((finding) => finding.rule === rule);

/** `rule → count`, for asserting a whole fixture's output in one comparison. */
export const countsByRule = (result: AnalyzerResult): Record<string, number> => {
  const counts: Record<string, number> = {};

  for (const finding of result.findings) {
    counts[finding.rule] = (counts[finding.rule] ?? 0) + 1;
  }

  return counts;
};

/** `${file}:${line}` for each finding of a rule — the coordinate assertions read off this. */
export const locationsOf = (result: AnalyzerResult, rule: string): string[] =>
  findingsOf(result, rule).map((finding) => `${finding.file}:${String(finding.line)}`);
