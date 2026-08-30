import type { A11yFacet, Expected, FindingCategory, Severity } from "../domain/findings.ts";
import type { ImportRecord, JsxElement, Observations, StyleValue } from "../domain/observations.ts";
import type { Limitation, ProjectProfile } from "../domain/profile.ts";

/**
 * Stage C contracts. Ported from `hackathon2026/ds-analyzer/src/rules/types.ts:1-169`.
 *
 * A rule is a pure function from facts to findings. It receives no filesystem, no parser and
 * no network — everything it may know is in {@link RuleContext}. That constraint is what
 * makes the rules testable in isolation and what keeps a syntax change from rippling past the
 * collectors.
 *
 * {@link RuleContext} is where this port differs from the source, and every removed member
 * fed a rule that is not here: `kit` (a `KitSpec`, source line 91 — the unguarded artifact
 * load h2 §3 identified as the porting blocker), `icons`/`knowledge`/`a11y` (92-109, the
 * three optional kit specs), `svg` (101, read only by `icon.foreign-file`) and `spacing`
 * (114, the frequency index only `token.literal.dimension` consults). `overStyleValues`,
 * `overElements`, `overImports` and `isAnalysableStyleValue` are kept, `overDeclarations`'
 * type aliases with them.
 */

/**
 * What a rule emits.
 *
 * Deliberately smaller than a `Finding`: identity, source snippets and occurrence counts are
 * cross-cutting and are attached once by the runner, so no rule has to remember to compute
 * them and no two rules can compute them differently.
 */
export interface RawFinding {
  readonly rule: string;
  readonly subkind: string | null;
  readonly category: FindingCategory;
  readonly severity: Severity;
  readonly confidence: number;

  readonly file: string;
  readonly line: number;
  readonly column: number;

  readonly actual: string;
  readonly expected: Expected | null;

  readonly why: string;
  readonly note: string | null;

  readonly rootCause: {
    readonly file: string;
    readonly line: number;
    readonly name: string;
  } | null;
  readonly appliedTo: { readonly component: string; readonly slot: string | null } | null;

  /**
   * Accessibility consequence, for the rules that carry one.
   *
   * Optional here and `null`-filled by the runner, unlike every other field: it is a facet of
   * a minority of rules, and making the component and icon rules restate `a11y: null` would
   * be ceremony that teaches nothing. The wire contract stays strict — see `findingSchema`.
   */
  readonly a11y?: A11yFacet;

  readonly autoFixable: boolean;
  readonly needsAgent: boolean;

  readonly candidates: {
    readonly component: string;
    readonly score: number;
    readonly reasons: string[];
  }[];

  /**
   * Groups occurrences of the same underlying problem for the `impact` counters.
   * Two findings share a key when fixing one teaches you how to fix the other.
   */
  readonly impactKey: string;

  /**
   * Text to substitute for {@link RawFinding.actual} on the affected line when building the
   * `after` snippet. `null` when the fix is not a simple in-line replacement.
   */
  readonly replaceWith: string | null;

  /**
   * How {@link RawFinding.replaceWith} is applied. `value` (the default) substitutes it for
   * `actual` inside the line; `line` replaces the entire affected line, keeping its
   * indentation and trailing semicolon.
   */
  readonly replaceScope?: "value" | "line";
}

export interface RuleContext {
  readonly profile: ProjectProfile;
  readonly observations: Observations;
  /** File contents, project-relative, for snippet extraction. */
  readonly sources: ReadonlyMap<string, readonly string[]>;
  /** JSX elements grouped by file, so element rules do not rescan. */
  readonly elementsByFile: ReadonlyMap<string, readonly JsxElement[]>;
}

export interface Rule {
  readonly id: string;
  readonly category: FindingCategory;
  /** One line, shown in the report's rule list. */
  readonly description: string;
  readonly run: (context: RuleContext) => RawFinding[];
  /**
   * What this rule could not check, and why.
   *
   * A rule that returns no findings is saying "this code is clean". A rule that could not run
   * says nothing at all, and the two are indistinguishable in the output unless the second one
   * declares itself. This is how a rule declares itself — still a pure function, still no side
   * channel.
   */
  readonly limitations?: (context: RuleContext) => Limitation[];
}

/** A rule that walks style declarations. */
export type StyleRule = (styleValue: StyleValue, context: RuleContext) => RawFinding[];

/** A rule that walks rendered elements. */
export type ElementRule = (element: JsxElement, context: RuleContext) => RawFinding[];

/** A rule that walks import statements. */
export type ImportRule = (record: ImportRecord, context: RuleContext) => RawFinding[];

/** Lifts a per-declaration rule to a whole-project rule. */
export const overStyleValues =
  (rule: StyleRule) =>
  (context: RuleContext): RawFinding[] =>
    context.observations.styleValues.flatMap((styleValue) => rule(styleValue, context));

/** Lifts a per-element rule to a whole-project rule. */
export const overElements =
  (rule: ElementRule) =>
  (context: RuleContext): RawFinding[] =>
    context.observations.jsxElements.flatMap((element) => rule(element, context));

/** Lifts a per-import rule to a whole-project rule. */
export const overImports =
  (rule: ImportRule) =>
  (context: RuleContext): RawFinding[] =>
    context.observations.imports.flatMap((record) => rule(record, context));

/** Observations that carry no design decision and every style rule must skip. */
export const isAnalysableStyleValue = (
  styleValue: Pick<Observations["styleValues"][number], "value">,
): boolean => styleValue.value.trim().length > 0;
