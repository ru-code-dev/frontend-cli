import type { Finding, Severity, Summary } from "../contract.js";
import { SEVERITY_RANK, SEVERITY_WEIGHT } from "./severity.js";

/**
 * Everything the accessibility screen decides before it draws anything.
 *
 * Split out of the screen so it can be tested from the analyzer's suite, the way
 * `lib/diff.ts` and `lib/shares.ts` already are — types only, no DOM, no React. The
 * arrangement here is the substance of that screen: which findings fold together, in what
 * order the sections read, and what counts as "not checked" rather than "clean". Each of
 * those is a decision that can be wrong without the page looking broken.
 */

/**
 * Distinct accessibility checks that ship: eight written here, twenty-nine run from
 * `eslint-plugin-jsx-a11y`.
 *
 * Pinned rather than derived — the dashboard is a static bundle with no access to the rule
 * registry, and threading a count through the payload to render one sentence would be a
 * contract change to save a constant. One lower than the source dashboard's 38: this build
 * does not port `a11y.pattern.keyboard`, the one kit-gated a11y rule (h5 §1a).
 */
export const A11Y_CHECK_COUNT = 37;

/** One decision: every occurrence sharing an `impactKey`, with its accessibility facet. */
export interface A11yGroup {
  key: string;
  rule: string;
  subkind: string | null;
  severity: Severity;
  /** What the user loses — the heading. */
  impact: string;
  /** What to do about it, when the rule can say it in one sentence; `null` when it cannot. */
  fix: string | null;
  /** Why the rule fired — the small print. */
  why: string;
  wcag: string[];
  /** Representative occurrence, for the contrast pair preview. */
  actual: string;
  occurrences: number;
  files: number;
  autoFixable: number;
  weight: number;
  findings: Finding[];
}

/**
 * Folds occurrences onto `impactKey`.
 *
 * That key is what makes the screen readable at all. `a11y.lint` is a single rule carrying
 * most of the findings, and its key is `a11y.lint:<plugin rule>` — so folding on it resolves
 * "fifty accessibility problems" into the six or seven distinct ones it actually is,
 * without the screen needing to know that this one rule is special.
 */
export const groupA11y = (findings: readonly Finding[]): A11yGroup[] => {
  const byKey = new Map<string, Finding[]>();

  for (const finding of findings) {
    const bucket = byKey.get(finding.impactKey);
    if (bucket === undefined) {
      byKey.set(finding.impactKey, [finding]);
    } else {
      bucket.push(finding);
    }
  }

  const groups: A11yGroup[] = [];

  for (const [key, bucket] of byKey.entries()) {
    const sorted = [...bucket].sort((left, right) =>
      left.file < right.file ? -1 : left.file > right.file ? 1 : left.line - right.line,
    );
    // The worst occurrence speaks for the group: it decides whether this is worth doing
    // before lunch or before the release.
    const lead = sorted.reduce((worst, finding) =>
      SEVERITY_RANK[finding.severity] < SEVERITY_RANK[worst.severity] ? finding : worst,
    );

    groups.push({
      key,
      rule: lead.rule,
      subkind: lead.subkind,
      severity: lead.severity,
      // Falling back to `why` rather than to an empty heading: a rule that forgot its
      // consequence should read as clumsy, not as a blank card.
      impact: lead.a11y?.impact ?? lead.why,
      fix: lead.a11y?.fix ?? null,
      why: lead.why,
      wcag: [...new Set(sorted.flatMap((finding) => finding.a11y?.wcag ?? []))].sort(),
      actual: lead.actual,
      occurrences: sorted.length,
      files: new Set(sorted.map((finding) => finding.file)).size,
      autoFixable: sorted.filter((finding) => finding.autoFixable).length,
      weight: sorted.reduce((sum, finding) => sum + SEVERITY_WEIGHT[finding.severity], 0),
      findings: sorted,
    });
  }

  return groups.sort(
    (left, right) =>
      right.weight - left.weight ||
      right.occurrences - left.occurrences ||
      (left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
  );
};

export interface A11ySection {
  id: string;
  title: string;
  hint: string;
  /** Rule ids this section owns; empty means "everything no other section claimed". */
  rules: readonly string[];
}

/**
 * The reading order, and it is deliberately not the rule registry's order.
 *
 * Keyboard leads because it is the failure that stops somebody using the product at all,
 * and the one no other tool in this space reports. The plugin's rules come last: there are
 * more of them than of everything else combined, and putting that list first buries the
 * four findings that matter most under thirty that matter less.
 */
export const A11Y_SECTIONS: readonly A11ySection[] = [
  {
    id: "keyboard",
    title: "Клавиатура и фокус",
    hint: "Управление без мыши. Ни один снапшот-чекер этого не видит — нужно нажать клавишу.",
    rules: ["a11y.pattern.keyboard", "a11y.pattern.focus", "a11y.focus.suppressed"],
  },
  {
    id: "semantics",
    title: "Имена и семантика",
    hint: "Что скринридер объявит вслух: имя контрола, его роль, связи между элементами.",
    rules: [
      "a11y.name.missing",
      "a11y.aria.invalid",
      "a11y.aria.required",
      "a11y.aria.redundant",
      "a11y.pattern.relations",
    ],
  },
  {
    id: "contrast",
    title: "Контраст",
    hint: "Пары «текст на фоне», посчитанные там, где обе величины заданы в одном блоке.",
    rules: ["a11y.contrast.text"],
  },
  {
    id: "lint",
    title: "Базовые правила",
    hint: "eslint-plugin-jsx-a11y — эталонная реализация базовых проверок разметки.",
    rules: ["a11y.lint"],
  },
];

const OTHER: A11ySection = {
  id: "other",
  title: "Прочее",
  hint: "Правила, появившиеся после того, как этот экран разложили по разделам.",
  rules: [],
};

/**
 * Groups assigned to sections, with a catch-all that is dropped when empty.
 *
 * The catch-all is the point: a rule added to the registry and forgotten here still appears
 * on the screen instead of silently vanishing from the report — the same reason the lint
 * adapter reports rules it has not classified.
 */
export const sectionsFor = (
  groups: readonly A11yGroup[],
): { section: A11ySection; groups: A11yGroup[] }[] => {
  const claimed = new Set(A11Y_SECTIONS.flatMap((section) => section.rules));
  const assigned = A11Y_SECTIONS.map((section) => ({
    section,
    groups: groups.filter((group) => section.rules.includes(group.rule)),
  }));
  const orphans = groups.filter((group) => !claimed.has(group.rule));

  return orphans.length === 0 ? assigned : [...assigned, { section: OTHER, groups: orphans }];
};

/**
 * Checks that did not run, as opposed to checks that found nothing.
 *
 * Both reasons are emitted only by the accessibility rules — `spec-unavailable` by the
 * keyboard rule when `kit-a11y.json` was never built, `unsupported-syntax` by the focus rule
 * when a style dialect loses its selectors — so the whole list belongs to this screen. If a
 * collector ever starts emitting either, an unrelated row appears here; that is a cosmetic
 * error, and the opposite arrangement would risk the one error this screen must never make,
 * which is presenting an unrun check as a pass.
 */
export const notCheckedFor = (limitations: Summary["limitations"]): Summary["limitations"] =>
  limitations.filter(
    (limitation) =>
      limitation.reason === "spec-unavailable" || limitation.reason === "unsupported-syntax",
  );

/** Colour pair as the contrast rule wrote it: `"#8b8b8b на #ffffff"`. */
export const contrastPair = (actual: string): [string, string] | null => {
  const parts = actual.split(" на ");
  const [foreground, background] = parts;

  if (parts.length !== 2 || foreground === undefined || background === undefined) {
    return null;
  }

  // Only what a browser can paint directly. A `var()` reference resolves against the
  // dashboard's own theme, not the audited project's, so it would paint the wrong colour —
  // or nothing — while looking like a measurement.
  const paintable = (value: string): boolean => /^(#|rgba?\(|hsla?\(|oklch\()/i.test(value.trim());

  return paintable(foreground) && paintable(background)
    ? [foreground.trim(), background.trim()]
    : null;
};
