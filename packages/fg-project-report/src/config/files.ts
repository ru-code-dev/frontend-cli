/**
 * THE TWO DOCUMENTS `fg --init-config` WRITES — built here, written there.
 *
 * Pure: a catalog and a language in, two JavaScript objects out, no `node:fs` and no clock. That
 * split is what
 * lets the tier-1 suite assert the SHAPE of both files — every catalog id present, every
 * `a11y.lint` sub-rule present, the schema's `enum`s agreeing with the engine's own — without a
 * temporary directory, and lets `init-config.ts` be about the three things only it can do:
 * choosing a design system, refusing to overwrite, and reporting absolute paths.
 *
 * ── WHY THE FILE LISTS EVERY RULE INSTEAD OF BEING EMPTY ─────────────────────────────────────
 *
 * A config file that says `{}` is correct and useless: the point of the feature is "leave only
 * icons and see 0 other crap" (`rc-design.md:8-10`), and a user cannot switch off what they
 * cannot see. So the generated file is the full inventory — every finding-level rule id the
 * selected kit can produce, at the level it produces it, plus `a11y.lint`'s sub-rules spelled
 * out as `a11y.lint/<name>` keys — and turning something off is editing one line rather than
 * discovering an id from a report.
 *
 * ── WHY EVERY ROW IS WRITTEN `"inherit"` (design D13) ───────────────────────────────────────
 *
 * An earlier revision of this file wrote each rule at its BUILT-IN severity, on the reasoning
 * that a user re-grading a rule needs to see what it currently does. That reasoning was right
 * and the consequence was fatal: D7 puts a `rules` row above `categories` and above `default`,
 * so a file naming all 62 rows made `"categories": { "a11y": "off" }` a no-op — the owner's core
 * workflow ("leave only icons and see 0 other crap") could not be expressed in the file the tool
 * itself produced. Verified on the built bundle before the amendment; recorded as A2's D-5.
 *
 * D13's answer keeps both halves. Every category and every rule/sub-rule row is written
 * `"inherit"` — present, discoverable, autocompleted, and SILENT — so `default` and `categories`
 * decide until the user gives a row an opinion. The built-in severity did not disappear: it
 * moved into the generated schema's per-key `description` («встроенный уровень: error — …»),
 * which is where an editor shows it on hover, next to the enum of levels to choose from. The
 * loader drops every `inherit` before the engine ever sees the config (`./load.ts`).
 *
 * `mixed` has no single severity to name, so its description says «зависит от находки» /
 * «depends on the finding» — because THE SCHEMA IS LOCALIZED. Its `title` and every
 * `description` are what an editor shows while somebody edits the config, so they are
 * `Localized {ru,en}` in `../strings.ts` and picked with the run's `--lang`, exactly like the
 * console output (PROTOCOL §4; V4 audit finding 1). The one thing that stays in one language is
 * each rule's own `description`, which is the engine catalog's text, not this package's.
 *
 * ── THE SCHEMA ───────────────────────────────────────────────────────────────────────────────
 *
 * Draft-07, because that is the dialect every editor's JSON language service supports without
 * being told. Its whole job is autocomplete and a red squiggle in the editor: `rules` names every
 * id as a `property` WITH the rule's description, so hovering a key explains it, while
 * `additionalProperties` keeps accepting any string, because a dot-prefix (`style.override`) and
 * a `<rule>/<subkind>` key for a kit this file was not generated for are both legal (D4/D5/D8).
 */
import type { FindingCategory, RuleCatalogEntry, Severity } from "@smart-tools/fg-analyzer-engine";
import { findingCategorySchema } from "@smart-tools/fg-analyzer-engine";
import type { Lang } from "@smart-tools/fg-cli-kit";
import { pick } from "@smart-tools/fg-cli-kit";

import {
  schemaAnalyzer,
  schemaCategories,
  schemaDefault,
  schemaIgnore,
  schemaKeyDescription,
  schemaMixedSeverity,
  schemaRules,
  schemaTitle,
  schemaUiKit,
} from "../strings.ts";
import { CONFIG_SCHEMA_FILE, FILE_LEVELS, INHERIT_LEVEL } from "./names.ts";

/** JSON with 2-space indentation and a trailing newline — what an editor and `git diff` expect. */
export const serialise = (document: unknown): string => `${JSON.stringify(document, null, 2)}\n`;

/** What a catalog entry can claim as its built-in level: a severity, or "it decides per finding". */
export type BuiltinLevel = Severity | "mixed";

/**
 * A rule's built-in severity as the generated SCHEMA states it — the fact D13 moved out of the
 * file's values and into its hover text.
 *
 * `"mixed"` is not a severity anyone can act on, so it is spelled as what it means: the rule
 * grades each finding for itself. That spelling is a sentence, so it follows `--lang`; the four
 * severity names are the vocabulary of the config file itself and are the same in both
 * languages, exactly as they are in `FILE_LEVELS`.
 */
export const builtinLabelOf = (builtin: BuiltinLevel, lang: Lang): string =>
  builtin === "mixed" ? pick(schemaMixedSeverity, lang) : builtin;

/**
 * «встроенный уровень: error — Кнопка без доступного имени…» — one line, for an editor's hover.
 *
 * The WRAPPER follows `--lang`; `description` is the rule's own text from the engine's catalog,
 * which exists in one language only (`../strings.ts`, schema section).
 */
export const describeKey = (builtin: BuiltinLevel, description: string, lang: Lang): string =>
  pick(schemaKeyDescription(builtinLabelOf(builtin, lang), description), lang);

/** One row of both generated documents: the key it is written under, and what the schema says. */
export interface RuleEntry {
  readonly key: string;
  /** The rule's own level, RAW — turned into hover text, in a language, only by the schema. */
  readonly builtin: BuiltinLevel;
  /** The engine catalog's Russian description of the rule, verbatim. */
  readonly description: string;
}

/**
 * Every key the generated `analyzer.rules` holds, in catalog order, each sub-rule directly under
 * the rule it belongs to.
 *
 * Exported because it is the thing both generated documents agree on — the config's keys and the
 * schema's `properties` are this list — and because the tier-1 suite counts it against the
 * catalog rather than against a number typed into a test.
 */
export function ruleEntriesOf(catalog: readonly RuleCatalogEntry[]): readonly RuleEntry[] {
  const entries: { key: string; builtin: BuiltinLevel; description: string }[] = [];
  for (const entry of catalog) {
    // The built-in level is carried RAW — a `Severity` or `"mixed"`, not a sentence — because
    // this list is language-free (it is the config's keys) and only the schema turns it into
    // hover text, in the language the run was invoked with.
    entries.push({
      key: entry.id,
      builtin: entry.builtinSeverity,
      description: entry.description,
    });
    for (const sub of entry.subrules) {
      entries.push({
        key: `${entry.id}/${sub.id}`,
        // A sub-rule always has exactly one severity.
        builtin: sub.severity,
        description: sub.description,
      });
    }
  }
  return entries;
}

/** The generated `fg.config.json`, as an object. */
export function configDocumentOf(options: {
  readonly catalog: readonly RuleCatalogEntry[];
  /** The design system the file is for, or `null` when only the generic rules are listed. */
  readonly uiKit: string | null;
}): Record<string, unknown> {
  // EVERY row `inherit` — see the header. The keys are the inventory; the levels are silence.
  const categories: Record<string, string> = {};
  for (const category of findingCategorySchema.options) categories[category] = INHERIT_LEVEL;

  const rules: Record<string, string> = {};
  for (const entry of ruleEntriesOf(options.catalog)) rules[entry.key] = INHERIT_LEVEL;

  return {
    // Relative, so the pair travels together: a config copied into another repository beside its
    // schema keeps working, and one copied without it degrades to "no autocomplete" rather than
    // to an editor error about a URL it cannot fetch.
    $schema: `./${CONFIG_SCHEMA_FILE}`,
    analyzer: {
      ...(options.uiKit === null ? {} : { uiKit: options.uiKit }),
      // The one row that is NOT `inherit`: `default` is the last scope, so it has nothing to
      // fall through to, and it is the row a user changes to `"off"` for the "leave only icons"
      // workflow. Written out even though it is the built-in value, because a key that is not in
      // the file is a key nobody finds.
      default: "on",
      categories,
      rules,
    },
  };
}

/** One `rules` property in the schema: the seven file levels, plus the hover text for this key. */
const levelProperty = (description: string): Record<string, unknown> => ({
  description,
  enum: [...FILE_LEVELS],
});

/**
 * The generated `fg.config.schema.json`, as an object, in the language the run was invoked with.
 *
 * `lang` is a REQUIRED parameter rather than a defaulted one: a default would let a new call
 * site drop the user's `--lang` silently, which is exactly the bug this signature exists to
 * make impossible (the schema shipped Russian-only until the V4 audit found it, finding 1).
 */
export function schemaDocumentOf(options: {
  readonly catalog: readonly RuleCatalogEntry[];
  /** Every `--ui-kit` spelling this build knows, `none` included. */
  readonly kitNames: readonly string[];
  /** `--lang`. Every sentence the schema states is written in it. */
  readonly lang: Lang;
}): Record<string, unknown> {
  const { lang } = options;
  const ruleProperties: Record<string, unknown> = {};
  for (const entry of ruleEntriesOf(options.catalog)) {
    ruleProperties[entry.key] = levelProperty(describeKey(entry.builtin, entry.description, lang));
  }

  const categoryProperties: Record<string, unknown> = {};
  for (const category of findingCategorySchema.options as readonly FindingCategory[]) {
    categoryProperties[category] = { enum: [...FILE_LEVELS] };
  }

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: pick(schemaTitle, lang),
    type: "object",
    properties: {
      $schema: { type: "string" },
      analyzer: {
        type: "object",
        description: pick(schemaAnalyzer, lang),
        properties: {
          uiKit: {
            description: pick(schemaUiKit, lang),
            enum: [...options.kitNames],
          },
          ignore: {
            description: pick(schemaIgnore, lang),
            type: "array",
            items: { type: "string" },
          },
          default: {
            description: pick(schemaDefault, lang),
            enum: [...FILE_LEVELS],
          },
          categories: {
            description: pick(schemaCategories, lang),
            type: "object",
            properties: categoryProperties,
            additionalProperties: false,
          },
          rules: {
            description: pick(schemaRules, lang),
            type: "object",
            properties: ruleProperties,
            // Open on purpose: a dot-prefix and a rule from a design system this file was not
            // generated for are both legal keys (design D4/D8), and a closed schema would put a
            // red squiggle under a config that works.
            additionalProperties: { enum: [...FILE_LEVELS] },
          },
        },
        additionalProperties: false,
      },
    },
    // The file is `fg.config.json`, not `analyzer.config.json`: the other `fg` commands are
    // expected to grow sections of their own in it (design §2), so the document stays open.
    additionalProperties: true,
  };
}
