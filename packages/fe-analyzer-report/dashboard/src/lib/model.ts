import { SEVERITY_WEIGHT, type Finding, type FindingCategory, type Severity } from "../data.js";
import { SEVERITY_RANK } from "./severity.js";
import type { ViewState } from "./url-state.js";

/**
 * Derived views over the findings list.
 *
 * The analyzer emits findings one per occurrence, which is right for the artifact and
 * wrong for a reader: a colour repeated eight hundred times is one decision, not eight
 * hundred rows. Both foldings the screens need — by underlying problem and by file — are
 * computed here once, so every screen ranks and counts identically.
 */

export { SEVERITY_RANK };

export const worstSeverity = (findings: readonly Finding[]): Severity =>
  findings.reduce<Severity>(
    (worst, finding) =>
      SEVERITY_RANK[finding.severity] < SEVERITY_RANK[worst] ? finding.severity : worst,
    "candidate",
  );

/** One decision: every occurrence of the same impactKey, ranked by total consequence. */
export interface Problem {
  key: string;
  rule: string;
  subkind: string | null;
  category: FindingCategory;
  severity: Severity;
  /** Representative value — occurrences of one key share it for token rules by construction. */
  actual: string;
  expected: Finding["expected"];
  why: string;
  note: string | null;
  rootCause: Finding["rootCause"];
  /** Every occurrence can be fixed by a line replacement. */
  autoFixable: boolean;
  occurrences: number;
  files: number;
  /** Σ severity weight over occurrences — the sort key, same weights as the health score. */
  weight: number;
  findings: Finding[];
}

const compareLocation = (left: Finding, right: Finding): number =>
  left.file < right.file
    ? -1
    : left.file > right.file
      ? 1
      : left.line - right.line || left.column - right.column;

export const buildProblems = (findings: readonly Finding[]): Problem[] => {
  const byKey = new Map<string, Finding[]>();

  for (const finding of findings) {
    const bucket = byKey.get(finding.impactKey);
    if (bucket === undefined) {
      byKey.set(finding.impactKey, [finding]);
    } else {
      bucket.push(finding);
    }
  }

  const problems: Problem[] = [];

  for (const [key, group] of byKey.entries()) {
    const sorted = [...group].sort(compareLocation);
    const first = sorted.reduce((best, finding) =>
      SEVERITY_RANK[finding.severity] < SEVERITY_RANK[best.severity] ? finding : best,
    );

    problems.push({
      key,
      rule: first.rule,
      subkind: first.subkind,
      category: first.category,
      severity: first.severity,
      actual: first.actual,
      expected: sorted.find((finding) => finding.expected !== null)?.expected ?? null,
      why: first.why,
      note: first.note,
      rootCause: sorted.find((finding) => finding.rootCause !== null)?.rootCause ?? null,
      autoFixable: sorted.every((finding) => finding.autoFixable),
      occurrences: sorted.length,
      files: new Set(sorted.map((finding) => finding.file)).size,
      weight: sorted.reduce((sum, finding) => sum + SEVERITY_WEIGHT[finding.severity], 0),
      findings: sorted,
    });
  }

  // Consequence first: an error repeated forty times outranks everything; among equals the
  // one touching more files wins, because fixing it closes more of the report at once.
  return problems.sort(
    (left, right) =>
      right.weight - left.weight ||
      right.occurrences - left.occurrences ||
      (left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
  );
};

/** One file: its findings in line order, so it reads as an edit plan for that file. */
export interface FileGroup {
  file: string;
  findings: Finding[];
  counts: Record<Severity, number>;
  worst: Severity;
  weight: number;
  autoFixable: number;
}

export const buildFileGroups = (findings: readonly Finding[]): FileGroup[] => {
  const byFile = new Map<string, Finding[]>();

  for (const finding of findings) {
    const bucket = byFile.get(finding.file);
    if (bucket === undefined) {
      byFile.set(finding.file, [finding]);
    } else {
      bucket.push(finding);
    }
  }

  const groups: FileGroup[] = [];

  for (const [file, group] of byFile.entries()) {
    const sorted = [...group].sort(
      (left, right) => left.line - right.line || left.column - right.column,
    );
    const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0, candidate: 0 };
    for (const finding of sorted) {
      counts[finding.severity] += 1;
    }

    groups.push({
      file,
      findings: sorted,
      counts,
      worst: worstSeverity(sorted),
      weight: sorted.reduce((sum, finding) => sum + SEVERITY_WEIGHT[finding.severity], 0),
      autoFixable: sorted.filter((finding) => finding.autoFixable).length,
    });
  }

  return groups.sort(
    (left, right) =>
      right.weight - left.weight || (left.file < right.file ? -1 : left.file > right.file ? 1 : 0),
  );
};

/** The filter predicate every screen shares; `except` powers faceted counts. */
export const matchesFilters = (
  finding: Finding,
  state: ViewState,
  except?: keyof ViewState,
): boolean => {
  if (except !== "severity" && state.severity !== null && finding.severity !== state.severity)
    return false;
  if (except !== "category" && state.category !== null && finding.category !== state.category)
    return false;
  if (except !== "rule" && state.rule !== null && finding.rule !== state.rule) return false;
  if (except !== "subkind" && state.subkind !== null && finding.subkind !== state.subkind)
    return false;
  if (except !== "value" && state.value !== null && finding.actual !== state.value) return false;
  if (except !== "file" && state.file !== null && finding.file !== state.file) return false;
  if (
    except !== "component" &&
    state.component !== null &&
    finding.appliedTo?.component !== state.component
  )
    return false;
  if (except !== "autoFixableOnly" && state.autoFixableOnly && !finding.autoFixable) return false;

  if (except !== "query" && state.query.length > 0) {
    const needle = state.query.toLowerCase();
    const haystack = `${finding.file} ${finding.actual} ${finding.rule} ${finding.why} ${finding.expected?.token ?? ""}`;
    if (!haystack.toLowerCase().includes(needle)) return false;
  }

  return true;
};
