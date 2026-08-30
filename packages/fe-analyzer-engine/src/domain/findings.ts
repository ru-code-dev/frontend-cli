import { z } from "zod";

import { limitationSchema } from "./profile.ts";

/**
 * The wire contract the report renderer consumes. `findingSchema` and everything it nests
 * are ported **field for field** from `hackathon2026/ds-analyzer/src/domain/findings.ts:23-145`
 * — h2 §4 established that this shape is generic over rules, and the dashboard reads it, so
 * it is not re-invented here.
 *
 * One shape for every rule. A report that had to special-case each rule would need changing
 * every time a rule is added, and the interesting rules are exactly the ones added last.
 *
 * Three fields deserve their reasoning stated, because they are what makes the report
 * actionable rather than merely correct:
 *
 *  - `expected` is `null` when there is genuinely nothing to offer. Inventing a suggestion
 *    is worse than admitting there is none.
 *  - `impact` carries occurrence counts so a deviation repeated forty times outranks a
 *    unique one. Severity alone sorts badly.
 *  - `rootCause` points at the declaration to fix when the finding is a symptom, so a Sass
 *    variable used in fourteen places reads as one problem.
 *
 * What is NOT ported: `usageSchema` (source lines 147-220) and `summarySchema` (222-252),
 * both of which are kit-adoption metrics — `adoption`, `tokenCoverage`, `kitGaps`,
 * `healthScore` (whose formula weights adoption, `ds-analyzer/src/metrics/health.ts:20-24`).
 * h5 §2d says those read as 0/misleading without a real kit. {@link analyzerSummarySchema}
 * below keeps exactly the rule-shaped half of the hackathon's summary.
 */

export const severitySchema = z.enum(["error", "warning", "info", "candidate"]);

/**
 * The hackathon's full category enum (`ds-analyzer/src/domain/findings.ts:25-34`) minus the
 * five no ported rule can emit (`token`, `typography`, `font`, `api`, `override`). Narrowing
 * rather than keeping them is what makes an exhaustive `switch` in the report renderer
 * complete instead of carrying five dead arms.
 */
export const findingCategorySchema = z.enum(["component", "icon", "a11y"]);

/**
 * Accessibility facet, present only on findings that carry one.
 *
 * A nested nullable object rather than three flat fields: `pattern` is meaningless on a
 * duplicated component, and widening the universal shape with one rule family's vocabulary
 * is how a wire contract turns into a junk drawer. Grouping also lets the facet grow without
 * touching `Finding` again.
 */
export const a11ySchema = z.object({
  /** WCAG success criteria the finding violates, e.g. `['1.4.3']`. Empty when none applies. */
  wcag: z.array(z.string()),
  /** APG pattern slug for pattern-conformance findings, e.g. `tabs`; `null` otherwise. */
  pattern: z.string().nullable(),
  /** What the user actually loses, in one sentence — not a restatement of the rule. */
  impact: z.string().min(1),
  /**
   * What to do about it, in one sentence.
   *
   * Deliberately separate from `expected`, which holds a replacement string ready to paste.
   * Most accessibility problems have no such string: "give the control an accessible name"
   * is correct advice that no patch can express, because the name depends on what the
   * control does. Prose in `expected.value` would be offered to the reader as copyable code
   * and produce broken edits.
   *
   * `null` where the remedy is not general enough to state in one sentence.
   */
  fix: z.string().nullable(),
});

export const expectedSchema = z.object({
  /** Token id. Always `null` here: no token artifact is loaded. */
  token: z.string().nullable(),
  /** CSS custom property for `token`, ready to paste. Always `null` here. */
  cssVar: z.string().nullable(),
  /** Component name, for `component.*` findings. */
  component: z.string().nullable(),
  /** The replacement string itself, in the syntax of the file it belongs to. */
  value: z.string(),
});

export const candidateSchema = z.object({
  component: z.string(),
  score: z.number(),
  /** Human-readable evidence, computed deterministically — not model output. */
  reasons: z.array(z.string()),
});

export const snippetSchema = z.object({
  /** Source lines around the finding, joined with newlines. */
  before: z.string(),
  /** `before` with the fix applied; `null` when no fix is known. */
  after: z.string().nullable(),
  /** 1-based line within `before` that the finding sits on. */
  highlightLine: z.number().int().positive(),
  /** Absolute line number of the first line of `before`. */
  startLine: z.number().int().positive(),
});

export const findingSchema = z.object({
  /** Stable within a run, derived from source position so links survive reruns. */
  id: z.string().min(1),
  rule: z.string().min(1),
  /** Sub-classification within a rule, e.g. `unknownRole` / `iconOnly` / `blanket`. */
  subkind: z.string().nullable(),
  category: findingCategorySchema,
  severity: severitySchema,
  /** 0–1. */
  confidence: z.number().min(0).max(1),

  file: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),

  snippet: snippetSchema,

  /** What is in the code. */
  actual: z.string(),
  expected: expectedSchema.nullable(),

  /** One sentence naming the consequence, not just the rule. */
  why: z.string().min(1),
  /** A caveat the reader must see before applying the fix. */
  note: z.string().nullable(),

  /** Declaration to repair when this finding is a symptom of one. */
  rootCause: z
    .object({ file: z.string(), line: z.number().int().positive(), name: z.string() })
    .nullable(),

  /** Component this declaration lands on, when it lands on one. */
  appliedTo: z.object({ component: z.string(), slot: z.string().nullable() }).nullable(),

  /** Accessibility consequence, for the rules and screens that reason about it. */
  a11y: a11ySchema.nullable(),

  autoFixable: z.boolean(),
  needsAgent: z.boolean(),

  candidates: z.array(candidateSchema),

  impact: z.object({
    /** How many findings across the project share this rule and value. */
    occurrences: z.number().int().positive(),
    files: z.number().int().positive(),
  }),

  /**
   * Groups occurrences of one underlying decision: findings share a key when fixing one
   * teaches you how to fix the rest. The report's problem view folds on it.
   */
  impactKey: z.string().min(1),
});

/** The analysis domains a caller may ask for; all three by default. */
export const domainSchema = z.enum(["a11y", "components", "icons"]);

/**
 * The rule-shaped half of the hackathon's `summarySchema`
 * (`ds-analyzer/src/domain/findings.ts:230-241,251`), kept verbatim in shape. Nothing here
 * needs a design-system artifact to compute.
 */
export const analyzerSummarySchema = z.object({
  files: z.object({
    scanned: z.number().int().nonnegative(),
    /** Files the run produced no finding for. */
    clean: z.number().int().nonnegative(),
  }),
  findings: z.object({
    total: z.number().int().nonnegative(),
    bySeverity: z.record(severitySchema, z.number().int().nonnegative()),
    byRule: z.record(z.string(), z.number().int().nonnegative()),
    byCategory: z.record(findingCategorySchema, z.number().int().nonnegative()),
    autoFixable: z.number().int().nonnegative(),
    needsAgent: z.number().int().nonnegative(),
  }),
  /** Everything the run could not check, scanner and rules alike. */
  limitations: z.array(limitationSchema),
});

export const analyzerResultSchema = z.object({
  $schema: z.literal("fe-analyzer-engine/analysis@1"),
  /** Domains that actually ran. */
  domains: z.array(domainSchema),
  findings: z.array(findingSchema),
  summary: analyzerSummarySchema,
});

export type Severity = z.infer<typeof severitySchema>;
export type FindingCategory = z.infer<typeof findingCategorySchema>;
export type A11yFacet = z.infer<typeof a11ySchema>;
export type Expected = z.infer<typeof expectedSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type Snippet = z.infer<typeof snippetSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type Domain = z.infer<typeof domainSchema>;
export type AnalyzerSummary = z.infer<typeof analyzerSummarySchema>;
export type AnalyzerResult = z.infer<typeof analyzerResultSchema>;
