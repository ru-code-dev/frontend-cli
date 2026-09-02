import { z } from "zod";

import {
  findingCategorySchema,
  severitySchema,
  type FindingCategory,
  type Severity,
} from "../domain/findings.ts";
import type { RuleLabel } from "../rules/types.ts";

/**
 * The rule-configuration contract: what a user may say about a rule, and what the analyser
 * hands the report so the dashboard can say the same thing back.
 *
 * This is the ESLint-shaped half of the engine. It replaces the hackathon's
 * `ds.config.json` `disabledRules` set (`hackathon2026/ds-analyzer/src/rules/index.ts:76-95`),
 * which could only delete a rule from the registry, with a VIEW applied after every rule has
 * run: rules are never switched off, their findings are dropped or re-graded. Two consequences
 * make the difference worth the indirection:
 *
 *  - the payload still carries every raw finding, so the dashboard can turn a rule back ON in
 *    the browser without re-running the analysis (design D3/D11);
 *  - a rule's own severity is still available to display next to an override, because nothing
 *    in the rule was changed to produce the override.
 *
 * Nothing here reads a file. Discovery of `fg.config.json` and its parse errors belong to the
 * CLI (`packages/fg-project-report`); this module owns only the RESOLVED shape and the pure
 * functions over it, which is why the dashboard can carry a structural copy and check it
 * against this one in a parity test.
 */

/**
 * Every level order derived from {@link severitySchema}, never restated.
 *
 * `off` hides the finding; `on` keeps whatever severity the rule assigned (which for
 * `a11y.lint` varies per subrule, so `on` is not a synonym for any single severity); the four
 * severities force one.
 */
export const RULE_LEVELS = ["off", "on", ...severitySchema.options] as const;

export const ruleLevelSchema = z.enum(RULE_LEVELS);

export type RuleLevel = "off" | "on" | Severity;

/** Where the config came from — the dashboard shows it in the panel header. */
export const ruleConfigSourceSchema = z.union([
  z.object({ kind: z.literal("file"), path: z.string() }),
  z.object({ kind: z.literal("defaults") }),
]);

export const ruleConfigSchema = z.object({
  default: ruleLevelSchema,
  /**
   * A *partial* record over the category enum: a config that mentions two categories must not
   * be forced to spell the other six.
   */
  categories: z.partialRecord(findingCategorySchema, ruleLevelSchema),
  /**
   * Keys are finding-level rule ids (design D4), a dot-prefix of one (`style.override` covers
   * `style.override.repaint`), or `<rule>/<subkind>` (design D5). Free-form on purpose: one
   * file has to serve projects analysed with different kit adapters, so a key this run knows
   * nothing about is a warning at the edge, never a parse failure (design D8).
   */
  rules: z.record(z.string(), ruleLevelSchema),
  source: ruleConfigSourceSchema,
});

/**
 * The RESOLVED config — what {@link applyRuleConfig} consumes and what the payload embeds.
 *
 * Written as an interface rather than `z.infer` because the dashboard mirrors it structurally
 * (the same rule the report package's `contract.ts` already follows) and a hand-written shape
 * is what that mirror is diffed against. {@link ruleConfigSchema} is checked against it below,
 * so the two cannot drift.
 */
export interface RuleConfig {
  readonly default: RuleLevel;
  readonly categories: Readonly<Partial<Record<FindingCategory, RuleLevel>>>;
  readonly rules: Readonly<Record<string, RuleLevel>>;
  readonly source: { readonly kind: "file"; readonly path: string } | { readonly kind: "defaults" };
}

/** Compile-time proof that the schema and the interface describe the same object. */
const _schemaMatchesInterface: RuleConfig = undefined as unknown as z.infer<
  typeof ruleConfigSchema
>;
void _schemaMatchesInterface;

/**
 * No file, no overrides: every rule keeps the severity it assigned itself.
 *
 * Frozen because it is a module-level constant a caller could otherwise spread INTO and
 * mutate by accident — and the mutation would be invisible until a second run in the same
 * process disagreed with the first.
 */
export const DEFAULT_RULE_CONFIG: RuleConfig = Object.freeze({
  default: "on",
  categories: Object.freeze({}),
  rules: Object.freeze({}),
  source: Object.freeze({ kind: "defaults" as const }),
});

/**
 * One controllable thing.
 *
 * Feeds `--init-config`, the generated JSON Schema, the SARIF `rules` table and the
 * dashboard's rule panel — four consumers that would otherwise each keep their own list of
 * rule ids and each drift from the registry at their own pace.
 */
export interface RuleCatalogEntry {
  /** Finding-level rule id (design D4) — the `rule` field a finding actually carries. */
  readonly id: string;
  readonly category: FindingCategory;
  /** One line, ru. */
  readonly description: string;
  /**
   * Short name of the problem in both languages — see {@link RuleLabel}.
   *
   * This is what makes the catalog the ONE place a console row gets its wording from: the
   * compact formatter is handed `ruleCatalog(adapter)` already (it needs it for SARIF), so a
   * label added to a rule reaches the terminal without a second table to keep in step.
   */
  readonly label: RuleLabel;
  /** `"mixed"` when the rule grades its own findings differently per case. */
  readonly builtinSeverity: Severity | "mixed";
  /**
   * One short phrase per `subkind` value this id's findings can carry; `{}` when they carry an
   * open value or none. See `rules/types.ts`'s `Rule.subkindLabels` — this is that map, carried
   * to the one place `compact` reads (V5 finding #6).
   */
  readonly subkindLabels: Readonly<Record<string, RuleLabel>>;
  /** Addressable as `<id>/<subrule id>`; `[]` for every rule but `a11y.lint`. */
  readonly subrules: readonly {
    readonly id: string;
    readonly severity: Severity;
    readonly description: string;
    readonly label: RuleLabel;
  }[];
  /** `"engine"` for this package's own rules, otherwise the adapter's `id`. */
  readonly origin: "engine" | string;
}
