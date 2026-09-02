import type { AnalyzerSummary, Finding, FindingCategory, Severity } from "./domain/findings.ts";
import { findingCategorySchema, GENERIC_CATEGORIES, severitySchema } from "./domain/findings.ts";
import type { Observations } from "./domain/observations.ts";
import type { Limitation } from "./domain/profile.ts";

/**
 * The counting half of `hackathon2026/ds-analyzer/src/metrics/health.ts:87-113,197-227`:
 * `countBy` with its seeded buckets, the clean-file count, and the six `findings.*` totals.
 *
 * What that file's `buildSummary` also produced — `healthScore` and its formula (source lines
 * 22-39,204-208), `adoption` (42-58), `tokenCoverage` (61-78), `positives` and `kitGaps` — is
 * merged in from the adapter's `summaryExtras`, and only when one is connected. h5 §2d is the
 * reason it cannot be computed here: `computeAdoption` counts elements whose `kitComponent` is
 * set, so with no design system every project would publish 0% adoption and a score thirty
 * points lower for a reason the reader cannot act on. Half a score is worse than no score.
 *
 * `byCategory`'s seed is the other adapter-gated piece. Eight buckets are meaningful when
 * eight categories of rule ran; three when three did. Seeding from the full enum regardless
 * would publish five permanently-zero counters to every kit-less caller.
 */

/**
 * Counts findings per bucket, seeding every known bucket with zero.
 *
 * An explicit `"candidate": 0` is more useful than a missing key: the report renders the full
 * set of severities without having to know which ones can be absent, and a diffable payload
 * stays stable when a category first appears.
 */
const countBy = <T extends string>(
  items: readonly Finding[],
  key: (finding: Finding) => T,
  known: readonly T[] = [],
): Record<T, number> => {
  const counts = Object.fromEntries(known.map((bucket) => [bucket, 0])) as Record<T, number>;

  for (const item of items) {
    const bucket = key(item);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }

  return counts;
};

/**
 * Read off the schemas, never restated.
 *
 * `byCategory` is a `z.record` keyed by the enum, and zod requires every key to be present —
 * so a category added to the schema but forgotten here produces a payload that fails its own
 * validation at runtime. A hand-written list typed as `Severity[]` cannot catch that, because
 * a subset satisfies the type. Deriving removes the failure mode instead of documenting it.
 */
const ALL_SEVERITIES: readonly Severity[] = severitySchema.options;

const ALL_CATEGORIES: readonly FindingCategory[] = findingCategorySchema.options;

export const buildSummary = (input: {
  readonly observations: Observations;
  readonly findings: readonly Finding[];
  readonly limitations: readonly Limitation[];
  /** `true` when a kit adapter contributed rules, which widens the `byCategory` seed. */
  readonly withAdapter?: boolean;
  /** The adapter's adoption half, merged in verbatim. */
  readonly extras?: Partial<AnalyzerSummary>;
}): AnalyzerSummary => {
  const { observations, findings, limitations } = input;

  const filesWithFindings = new Set(findings.map((finding) => finding.file));
  const cleanFiles = observations.files.filter((file) => !filesWithFindings.has(file)).length;

  const categories: readonly FindingCategory[] = input.withAdapter
    ? ALL_CATEGORIES
    : GENERIC_CATEGORIES;

  const extras = input.extras;

  // Key order is load-bearing, which is unusual enough to say out loud. The parity suite
  // compares this object against the hackathon's own `summary.json` byte for byte, and
  // `JSON.stringify` preserves insertion order — so the adoption fields are inserted around the
  // core ones in the source's order (`ds-analyzer/src/metrics/health.ts:209-226`) rather than
  // appended. With no adapter both spreads are empty and the object is the three-key one every
  // existing test asserts, in the order it always had.
  return {
    ...(extras === undefined
      ? {}
      : {
          ...(extras.healthScore === undefined ? {} : { healthScore: extras.healthScore }),
          ...(extras.healthFormula === undefined ? {} : { healthFormula: extras.healthFormula }),
          ...(extras.adoption === undefined ? {} : { adoption: extras.adoption }),
          ...(extras.tokenCoverage === undefined ? {} : { tokenCoverage: extras.tokenCoverage }),
        }),
    files: { scanned: observations.files.length, clean: cleanFiles },
    findings: {
      total: findings.length,
      bySeverity: countBy(findings, (finding) => finding.severity, ALL_SEVERITIES),
      byRule: countBy(findings, (finding) => finding.rule),
      byCategory: countBy(findings, (finding) => finding.category, categories),
      autoFixable: findings.filter((finding) => finding.autoFixable).length,
      needsAgent: findings.filter((finding) => finding.needsAgent).length,
    },
    ...(extras === undefined
      ? {}
      : {
          ...(extras.positives === undefined ? {} : { positives: extras.positives }),
          ...(extras.kitGaps === undefined ? {} : { kitGaps: extras.kitGaps }),
        }),
    limitations: [...limitations],
  };
};

/** Clean-file count, so a caller building `summaryExtras` input does not recompute it. */
export const countCleanFiles = (
  observations: Observations,
  findings: readonly Finding[],
): number => {
  const filesWithFindings = new Set(findings.map((finding) => finding.file));

  return observations.files.filter((file) => !filesWithFindings.has(file)).length;
};
