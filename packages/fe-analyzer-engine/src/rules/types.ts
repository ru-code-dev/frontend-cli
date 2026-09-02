import type { KitBinding } from "../adapter.ts";
import type { A11yFacet, Expected, FindingCategory, Severity } from "../domain/findings.ts";
import type {
  Declaration,
  ImportRecord,
  JsxElement,
  Observations,
  StyleValue,
} from "../domain/observations.ts";
import type { Limitation, ProjectProfile } from "../domain/profile.ts";

/**
 * Stage C contracts. Ported from `hackathon2026/ds-analyzer/src/rules/types.ts:1-169`.
 *
 * A rule is a pure function from facts to findings. It receives no filesystem, no parser and no
 * network — everything it may know is in {@link RuleContext}. That constraint is what makes the
 * rules testable in isolation and what keeps a syntax change from rippling past the collectors.
 *
 * {@link RuleContext} differs from the source in exactly one way, and it is the whole seam. The
 * source held four concrete kit classes — `kit: KitSpec` (line 91), `icons`/`knowledge`/`a11y`
 * (92-109) — each loaded from a directory of JSON on disk. Here there is one nullable
 * {@link KitBinding}, an object the caller passed in, and `null` is a first-class state rather
 * than a crash. A kit adapter's own rules do not read it at all: they close over their own
 * artifacts, which is why the engine can stay ignorant of what those artifacts contain.
 *
 * `svg` (source line 101) and `spacing` (114) are back verbatim and are *not* kit-shaped: one
 * reads `.svg` files out of the analysed project, the other counts that project's own pixel
 * values. Both are computed for every run, adapter or not — they are project facts, and a rule
 * that wants them should not have to ask whether a design system is connected.
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

/** Frequency of raw pixel values across the project, for properties no scale governs. */
export interface FrequencyIndex {
  /** Pixel value → number of occurrences. */
  readonly counts: ReadonlyMap<number, number>;
  readonly total: number;
  /** `true` when the value is rare enough against the project's own habits to look magic. */
  readonly isMagic: (px: number) => boolean;
}

export interface RuleContext {
  readonly profile: ProjectProfile;
  readonly observations: Observations;
  /** File contents, project-relative, for snippet extraction. */
  readonly sources: ReadonlyMap<string, readonly string[]>;
  /** JSX elements grouped by file, so element rules do not rescan. */
  readonly elementsByFile: ReadonlyMap<string, readonly JsxElement[]>;
  /** Project's own distribution of raw pixel values on scaleless properties. */
  readonly spacing: FrequencyIndex;
  /**
   * Contents of an `.svg` file referenced from `fromFile` by a relative or root-absolute path;
   * `null` when unresolvable. Reading happens in the context builder — rules stay pure and
   * never open files.
   */
  readonly svg: (fromFile: string, reference: string) => string | null;
  /**
   * The connected design system, or `null`.
   *
   * `null` is not a degraded object pretending to know nothing — it is the absence itself, so a
   * rule that forgets to check it fails to compile rather than silently reporting a clean bill
   * of health for code nobody looked at.
   */
  readonly kit: KitBinding | null;
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

/** A rule that walks local component declarations. */
export type DeclarationRule = (declaration: Declaration, context: RuleContext) => RawFinding[];

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
