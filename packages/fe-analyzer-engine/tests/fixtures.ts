import { fileURLToPath } from "node:url";

import { analyzeProject, type AnalyzerResult, type Domain, type Finding } from "../src/index.ts";

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

export type FixtureName =
  | "plain-css"
  | "css-modules"
  | "styled-components"
  | "emotion"
  | "dialog"
  | "duplicates"
  | "foreign-icons"
  | "clean";

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
