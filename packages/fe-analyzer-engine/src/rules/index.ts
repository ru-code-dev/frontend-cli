import type { Domain, Finding, FindingCategory } from "../domain/findings.ts";
import type { Limitation } from "../domain/profile.ts";
import { compareStrings } from "../shared/sort.ts";
import { invalidAriaRule, redundantRoleRule, requiredAriaRule } from "./a11y/aria.ts";
import { textContrastRule } from "./a11y/contrast.ts";
import { dialogFocusRule } from "./a11y/dialog.ts";
import { suppressedFocusRule } from "./a11y/focus.ts";
import { jsxA11yLintRule } from "./a11y/lint.ts";
import { missingAccessibleNameRule } from "./a11y/name.ts";
import { ariaRelationsRule } from "./a11y/relations.ts";
import { duplicateComponentRule } from "./components/duplicate.ts";
import { foreignIconPackRule } from "./icons/foreign-pack.ts";
import { buildSnippet } from "./snippet.ts";
import type { RawFinding, Rule, RuleContext } from "./types.ts";

/**
 * The rule registry and the one place findings become findings. Ported from
 * `hackathon2026/ds-analyzer/src/rules/index.ts:1-135`; the registry itself is the eleven
 * rules this package carries instead of that file's twenty-six, and rule selection is by
 * `domains` rather than by a `ds.config.json` `disabledRules` set (source lines 76-95).
 *
 * Identity, source context and occurrence counts are attached here rather than in the rules.
 * Every rule would otherwise have to remember to compute them, and any two rules that
 * computed them differently would produce a report that contradicts itself.
 *
 * Ordering is by source position, not by severity. The report sorts for display; the payload
 * is diffable, so it has to be stable and human-readable in file order.
 */

export const RULES: readonly Rule[] = [
  jsxA11yLintRule,
  suppressedFocusRule,
  invalidAriaRule,
  requiredAriaRule,
  redundantRoleRule,
  ariaRelationsRule,
  dialogFocusRule,
  missingAccessibleNameRule,
  textContrastRule,
  foreignIconPackRule,
  duplicateComponentRule,
];

/** Which domain a rule belongs to, derived from the category it already declares. */
const DOMAIN_OF_CATEGORY: Readonly<Record<FindingCategory, Domain>> = {
  a11y: "a11y",
  component: "components",
  icon: "icons",
};

export const domainOf = (rule: Rule): Domain => DOMAIN_OF_CATEGORY[rule.category];

/** Stable, zero-padded so that lexical order matches numeric order in the report. */
const findingId = (index: number): string => `f_${String(index + 1).padStart(4, "0")}`;

const compareFindings = (left: RawFinding, right: RawFinding): number =>
  compareStrings(left.file, right.file) ||
  left.line - right.line ||
  left.column - right.column ||
  compareStrings(left.rule, right.rule) ||
  compareStrings(left.actual, right.actual);

export interface RunOptions {
  /** Domains to run; every rule runs when omitted. */
  readonly domains?: readonly Domain[];
}

const selectRules = (options: RunOptions): readonly Rule[] => {
  const domains = options.domains;

  return domains === undefined ? RULES : RULES.filter((rule) => domains.includes(domainOf(rule)));
};

/** Everything the enabled rules declare they could not check. */
export const collectRuleLimitations = (
  context: RuleContext,
  options: RunOptions = {},
): Limitation[] => selectRules(options).flatMap((rule) => rule.limitations?.(context) ?? []);

/** Runs every enabled rule and materialises the results. */
export const runRules = (context: RuleContext, options: RunOptions = {}): Finding[] => {
  const raw = selectRules(options)
    .flatMap((rule) => rule.run(context))
    .sort(compareFindings);

  // Occurrences are counted across the whole project so that a deviation repeated forty times
  // outranks a unique one, whatever their severities.
  const occurrences = new Map<string, { count: number; files: Set<string> }>();
  for (const finding of raw) {
    const entry = occurrences.get(finding.impactKey) ?? { count: 0, files: new Set<string>() };
    entry.count += 1;
    entry.files.add(finding.file);
    occurrences.set(finding.impactKey, entry);
  }

  return raw.map((finding, index) => {
    const impact = occurrences.get(finding.impactKey) ?? {
      count: 1,
      files: new Set([finding.file]),
    };

    return {
      id: findingId(index),
      rule: finding.rule,
      subkind: finding.subkind,
      category: finding.category,
      severity: finding.severity,
      confidence: finding.confidence,
      file: finding.file,
      line: finding.line,
      column: finding.column,
      snippet: buildSnippet(finding, context.sources.get(finding.file)),
      actual: finding.actual,
      expected: finding.expected,
      why: finding.why,
      note: finding.note,
      rootCause: finding.rootCause,
      appliedTo: finding.appliedTo,
      a11y: finding.a11y ?? null,
      autoFixable: finding.autoFixable,
      needsAgent: finding.needsAgent,
      candidates: finding.candidates,
      impact: { occurrences: impact.count, files: impact.files.size },
      impactKey: finding.impactKey,
    };
  });
};
