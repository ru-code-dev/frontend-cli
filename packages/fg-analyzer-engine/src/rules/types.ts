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

/**
 * A rule's SHORT NAME, in both output languages — three or four words a terminal row can carry
 * next to the offending value.
 *
 * Distinct from {@link Rule.description}, and the distinction is the point. `description` is
 * one line explaining what the rule checks and is written for someone reading a rule list;
 * `label` names the PROBLEM and is written for someone reading a finding — «Цвет литералом
 * вместо токена» against a `#FFFFFF` that is right there on the line. The compact formatter
 * prints the label and never the description (UX design §2.4/U5), which is why one is not
 * derivable from the other by truncation.
 *
 * REQUIRED, so a new rule cannot reach a user's terminal nameless: a missing label is a
 * compile error at the rule, not an `?? rule.id` fallback discovered in the output.
 *
 * The `ru` side is the same string the dashboard's `RULE_LABEL`
 * (`packages/fg-analyzer-report/dashboard/src/data.ts`) already showed for that id, pinned by
 * `packages/fg-analyzer-report/tests/rule-labels-parity.test.ts`: the console and the HTML
 * report name the same finding the same way, or the parity test fails.
 */
export interface RuleLabel {
  readonly ru: string;
  readonly en: string;
}

export interface Rule {
  readonly id: string;
  readonly category: FindingCategory;
  /** One line, shown in the report's rule list. */
  readonly description: string;
  /** Short name of the problem, for one terminal row. See {@link RuleLabel}. */
  readonly label: RuleLabel;
  readonly run: (context: RuleContext) => RawFinding[];
  /**
   * The severity this rule always assigns, or `"mixed"` when it grades case by case.
   *
   * PURELY DESCRIPTIVE — nothing reads it at run time. It exists so the rule catalog
   * (`config/catalog.ts`) can tell a user what turning a rule to `"on"` will mean, without a
   * hand-kept table that drifts the first time a rule is re-graded. Omitting it reads as
   * `"mixed"`, which is the honest default: the catalog would otherwise have to guess.
   */
  readonly severity?: Severity | "mixed";
  /**
   * The finding-level ids this rule emits, when they are not its own {@link Rule.id}.
   *
   * Config keys are the `rule` field of a finding (design D4), so a rule like EDS's
   * `style.override` — which emits `style.override.repaint` / `.size` / `.inner` /
   * `.important` — is four controllable things, not one. Declared here rather than derived,
   * because the ids are chosen inside `run` and no static analysis of a closure will find
   * them. The rule id still addresses all of them as a dot-prefix.
   */
  readonly emits?: readonly {
    readonly id: string;
    readonly description: string;
    /**
     * Its OWN label, not the parent rule's: `style.override.repaint` and
     * `style.override.important` are two different problems to a reader, and a row that named
     * both «Стилизация компонента кита снаружи» would say nothing the rule id had not.
     */
    readonly label: RuleLabel;
    readonly severity: Severity | "mixed";
  }[];
  /**
   * The `subkind` values this rule's findings carry, when they are a fixed, addressable set.
   *
   * Only `a11y.lint` has one today: every `eslint-plugin-jsx-a11y` rule it relays is a
   * sub-rule a user must be able to switch off on its own (`"a11y.lint/alt-text"`, design
   * D5), and there are thirty of them. A rule whose `subkind` is an open value — a component
   * name, a token id — declares nothing here, because a config cannot enumerate those.
   */
  /**
   * WHAT EACH `subkind` MEANS, in one short phrase per value — design §2.4's worked example.
   *
   * A finding's `subkind` is the shade of the problem: `token.literal.color` grades a literal as
   * `exact` / `near` / `shade` / `foreign`, and §2.4 gives those three DIFFERENT console
   * messages. With only {@link Rule.label} to print, `compact` rendered up to seven visually
   * identical rows — «Цвет литералом вместо токена» seven times, differing only in the actual
   * (V5 finding #6). `--verbose` restored the distinction at the cost of a third line per
   * finding, which is not the same thing.
   *
   * DISTINCT FROM {@link Rule.subrules}: a sub-rule is separately CONFIGURABLE (`a11y.lint/
   * alt-text`, addressable in `fg.config.json`); a subkind label is only a NAME for a shade of
   * one rule, and adding one changes no config surface. The `ru` side is the dashboard's own
   * `SUBKIND_LABEL` (`packages/fg-analyzer-report/dashboard/src/data.ts`), pinned by
   * `packages/fg-analyzer-report/tests/rule-labels-parity.test.ts` so the console and the HTML
   * report name a shade the same way; the `en` side is authored here.
   *
   * A rule whose `subkind` is an OPEN value — a role name, a component name — declares nothing,
   * and the lookup simply misses.
   */
  readonly subkindLabels?: Readonly<Record<string, RuleLabel>>;
  readonly subrules?: readonly {
    readonly id: string;
    readonly severity: Severity;
    readonly description: string;
    /**
     * The sub-rule's own short name. `a11y.lint`'s label — «Базовое правило доступности» —
     * is true of all thirty and useful for none, so a finding that carries a `subkind` is
     * named by the sub-rule (compact's `labelOf`).
     */
    readonly label: RuleLabel;
  }[];
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
