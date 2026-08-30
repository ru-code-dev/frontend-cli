import type { AnalyzerSummary, Finding, FindingCategory, Severity } from "./domain/findings.ts";
import { findingCategorySchema, severitySchema } from "./domain/findings.ts";
import type { Observations } from "./domain/observations.ts";
import type { Limitation } from "./domain/profile.ts";

/**
 * The counting half of `hackathon2026/ds-analyzer/src/metrics/health.ts:87-113,197-227`, kept
 * and nothing else: `countBy` with its seeded buckets, the clean-file count, and the six
 * `findings.*` totals.
 *
 * What that file's `buildSummary` also produced is deliberately absent — `healthScore` and
 * its formula (source lines 22-39,204-208), `adoption` (42-58) and `tokenCoverage` (61-78),
 * plus `positives` and `kitGaps`. The first three are the kit-adoption terms h5 §2d flags as
 * "0/misleading on a project with no real KitSpec": `computeAdoption` counts elements whose
 * `kitComponent` is set, which is never, so it would report 0% adoption for every project and
 * drag a published score down by thirty points for a reason the reader cannot act on. Half a
 * score is worse than no score.
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
}): AnalyzerSummary => {
  const { observations, findings, limitations } = input;

  const filesWithFindings = new Set(findings.map((finding) => finding.file));
  const cleanFiles = observations.files.filter((file) => !filesWithFindings.has(file)).length;

  return {
    files: { scanned: observations.files.length, clean: cleanFiles },
    findings: {
      total: findings.length,
      bySeverity: countBy(findings, (finding) => finding.severity, ALL_SEVERITIES),
      byRule: countBy(findings, (finding) => finding.rule),
      byCategory: countBy(findings, (finding) => finding.category, ALL_CATEGORIES),
      autoFixable: findings.filter((finding) => finding.autoFixable).length,
      needsAgent: findings.filter((finding) => finding.needsAgent).length,
    },
    limitations: [...limitations],
  };
};
