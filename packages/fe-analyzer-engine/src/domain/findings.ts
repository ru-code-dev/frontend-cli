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
 * `usageSchema` (source lines 147-220) and the kit half of `summarySchema` (222-252) are the
 * adapter-gated part of this contract. Every field of them — `adoption`, `tokenCoverage`,
 * `kitGaps`, `healthScore` (whose formula weights adoption,
 * `ds-analyzer/src/metrics/health.ts:20-24`) — measures *adoption of a design system*, and h5
 * §2d records that they read as 0/misleading with no kit behind them. So they are `optional()`
 * here and are emitted only when a {@link KitAdapter} is connected: with no adapter the payload
 * is byte-for-byte what it was before this file grew them.
 */

export const severitySchema = z.enum(["error", "warning", "info", "candidate"]);

/**
 * The hackathon's full category enum, restored verbatim
 * (`ds-analyzer/src/domain/findings.ts:25-34`).
 *
 * The engine's own eleven rules can only ever emit the last three; the other five belong to
 * rules a kit adapter contributes. Widening the *accepted* set changes no output — what
 * `summary.findings.byCategory` is seeded with is chosen per run in `summary.ts`, from
 * {@link GENERIC_CATEGORIES} without an adapter and from all eight with one, which is what
 * keeps the three-key object every existing test asserts.
 */
export const findingCategorySchema = z.enum([
  "token",
  "typography",
  "font",
  "api",
  "override",
  "component",
  "icon",
  "a11y",
]);

/** The categories the engine's own rules can emit — the seed set for an adapter-less run. */
export const GENERIC_CATEGORIES = ["component", "icon", "a11y"] as const;

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

/**
 * Rule groups a caller can select.
 *
 * `a11y`/`components`/`icons` are the engine's own; `tokens`/`api` exist for the rule families
 * only a kit adapter can contribute (the token/typography/font rules, and the import/prop/
 * override rules). `ALL_DOMAINS` — the default with no adapter — is still exactly the first
 * three, so widening the enum selects nothing new on its own.
 */
export const domainSchema = z.enum(["a11y", "components", "icons", "tokens", "api"]);

/**
 * Component and token usage — the half of the report that is not a complaint. Ported field for
 * field from `ds-analyzer/src/domain/findings.ts:147-220`.
 *
 * Present only when an adapter is connected: every counter here is relative to a design system
 * (`unusedComponents` is *the kit's* components nobody used), so without one the honest value
 * is not zero, it is absence.
 */
export const usageSchema = z.object({
  components: z.array(
    z.object({
      name: z.string(),
      usages: z.number().int().nonnegative(),
      files: z.number().int().nonnegative(),
      findings: z.number().int().nonnegative(),
      overrides: z.number().int().nonnegative(),
      /** prop → value → occurrences, for the variant histogram. */
      props: z.record(z.string(), z.record(z.string(), z.number().int().nonnegative())),
    }),
  ),
  /** Kit components the project never renders. */
  unusedComponents: z.array(z.string()),
  foreignComponents: z.array(
    z.object({
      name: z.string(),
      usages: z.number().int().nonnegative(),
      /** `true` when the component is declared in this project rather than imported. */
      local: z.boolean(),
      source: z.string().nullable(),
    }),
  ),
  customComponents: z.array(
    z.object({
      name: z.string(),
      file: z.string(),
      line: z.number().int().positive(),
      usages: z.number().int().nonnegative(),
      files: z.number().int().nonnegative(),
      props: z.array(z.string()),
      kitComponentsUsed: z.array(z.string()),
      hasInlineSvg: z.boolean(),
      snippet: z.string(),
      verdict: z.enum(["kit-like", "kit-candidate", "local"]),
      nameMatch: z
        .object({ component: z.string(), kind: z.enum(["exact", "contains", "similar"]) })
        .nullable(),
      tokenRefs: z.number().int().nonnegative(),
      hardcodedValues: z.number().int().nonnegative(),
      tokenVerdict: z.enum(["tokens", "mixed", "hardcode", "no-styles"]),
    }),
  ),
  /** One scale, one hundred per cent: every rendered component element lands in one bucket. */
  elementBreakdown: z.object({
    total: z.number().int().nonnegative(),
    kit: z.number().int().nonnegative(),
    kitClean: z.number().int().nonnegative(),
    customTokens: z.number().int().nonnegative(),
    customMixed: z.number().int().nonnegative(),
    customHardcode: z.number().int().nonnegative(),
    customUnstyled: z.number().int().nonnegative(),
    foreign: z.number().int().nonnegative(),
  }),
  /** Token id → how many times consumer code references it through a custom property. */
  tokenUsage: z.record(z.string(), z.number().int().nonnegative()),
});

/**
 * The rule-shaped half of the hackathon's `summarySchema`
 * (`ds-analyzer/src/domain/findings.ts:230-241,251`), kept verbatim in shape, plus that
 * schema's kit half (222-229,242-250) as optional fields.
 *
 * The optionality is the point. With no adapter the object has exactly the four keys it always
 * had; with one it has the hackathon's ten.
 */
export const analyzerSummarySchema = z.object({
  /**
   * Field order below is the hackathon's (`ds-analyzer/src/metrics/health.ts:209-226`), not a
   * grouping of required-then-optional, because zod rebuilds a parsed object in *schema* order
   * and the parity suite compares the serialised result byte for byte. With no adapter the six
   * optional keys are simply absent and the object is the three-key one it has always been.
   */
  /** 0-100. Adapter-gated: the formula weights kit adoption, which needs a kit. */
  healthScore: z.number().int().min(0).max(100).optional(),
  /** Published next to the number, because a hidden derivation gets argued with. */
  healthFormula: z.string().optional(),
  /** Share of component elements that come from the kit. */
  adoption: z.number().min(0).max(1).optional(),
  /** Share of style values expressed through a token rather than a literal. */
  tokenCoverage: z.number().min(0).max(1).optional(),
  files: z.object({
    scanned: z.number().int().nonnegative(),
    /** Files the run produced no finding for. */
    clean: z.number().int().nonnegative(),
  }),
  findings: z.object({
    total: z.number().int().nonnegative(),
    bySeverity: z.record(severitySchema, z.number().int().nonnegative()),
    byRule: z.record(z.string(), z.number().int().nonnegative()),
    /**
     * A *partial* record over the category enum, unlike `bySeverity`.
     *
     * The seed set is chosen per run — three categories with no adapter, eight with one — so an
     * exhaustive record would reject the very payload this engine emits without a kit. What the
     * exhaustive form bought (a category added to the enum but forgotten in the seed list fails
     * its own validation) is bought instead by `GENERIC_CATEGORIES` and `.options` being the
     * only two seed lists, both derived rather than restated.
     */
    byCategory: z.partialRecord(findingCategorySchema, z.number().int().nonnegative()),
    autoFixable: z.number().int().nonnegative(),
    needsAgent: z.number().int().nonnegative(),
  }),
  positives: z.array(z.object({ label: z.string(), detail: z.string() })).optional(),
  /** Colours that exist in the kit but not as a role for the property they were used on. */
  kitGaps: z
    .array(
      z.object({
        value: z.string(),
        token: z.string(),
        role: z.string(),
        occurrences: z.number().int().positive(),
      }),
    )
    .optional(),
  /** Everything the run could not check, scanner and rules alike. */
  limitations: z.array(limitationSchema),
});

export const analyzerResultSchema = z.object({
  $schema: z.literal("fe-analyzer-engine/analysis@1"),
  /** Domains that actually ran. */
  domains: z.array(domainSchema),
  findings: z.array(findingSchema),
  summary: analyzerSummarySchema,
  /** Adapter-gated; see {@link usageSchema}. */
  usage: usageSchema.optional(),
});

export type Severity = z.infer<typeof severitySchema>;
export type FindingCategory = z.infer<typeof findingCategorySchema>;
export type A11yFacet = z.infer<typeof a11ySchema>;
export type Expected = z.infer<typeof expectedSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type Snippet = z.infer<typeof snippetSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type Domain = z.infer<typeof domainSchema>;
export type Usage = z.infer<typeof usageSchema>;
export type AnalyzerSummary = z.infer<typeof analyzerSummarySchema>;
export type AnalyzerResult = z.infer<typeof analyzerResultSchema>;
