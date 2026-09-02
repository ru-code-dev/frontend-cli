import type { KitAdapter } from "../adapter.ts";
import { findingCategorySchema, type FindingCategory } from "../domain/findings.ts";
import { registryFor, RULES } from "../rules/index.ts";
import type { Rule } from "../rules/types.ts";
import { compareStrings } from "../shared/sort.ts";
import type { RuleCatalogEntry } from "./types.ts";

/**
 * The list of everything a config file may address, DERIVED from the registry that will run.
 *
 * A hand-kept list is the failure this file exists to prevent: `--init-config` would offer a
 * rule that no longer exists, the generated JSON Schema would reject a key that does, and the
 * dashboard's panel would show a row that can never light up. All three read this function,
 * and this function reads {@link registryFor} — the same call `analyzeProject` makes — so the
 * catalog and the run cannot disagree.
 *
 * Two facts about a rule cannot be read off `Rule.run` and so are DECLARED on the rule object
 * (`rules/types.ts`): the ids it emits when they are not its own id, and the severity it
 * assigns when it always assigns the same one. Both are optional; a rule that declares
 * neither appears under its own id at `"mixed"`, which is the honest answer rather than a
 * guessed one.
 */

const CATEGORY_ORDER: readonly FindingCategory[] = findingCategorySchema.options;

/** Engine rules are identified by identity: an adapter builds fresh objects for its own. */
const originOf = (rule: Rule, adapter?: KitAdapter): "engine" | string =>
  RULES.includes(rule) ? "engine" : (adapter?.id ?? "engine");

const entriesForRule = (rule: Rule, adapter?: KitAdapter): RuleCatalogEntry[] => {
  const origin = originOf(rule, adapter);
  const emits = rule.emits;

  if (emits === undefined) {
    return [
      {
        id: rule.id,
        category: rule.category,
        description: rule.description,
        label: rule.label,
        builtinSeverity: rule.severity ?? "mixed",
        subkindLabels: rule.subkindLabels ?? {},
        subrules: rule.subrules ?? [],
        origin,
      },
    ];
  }

  // A rule that emits ids other than its own is listed under THOSE ids, because they are what
  // a finding carries and therefore what a config key has to match (design D4). The rule id
  // still works as a config key — it is a dot-prefix of each emitted id — but it is not a
  // thing the report can count, so it is not a catalog row.
  return emits.map((emitted) => ({
    id: emitted.id,
    category: rule.category,
    description: emitted.description,
    // The EMITTED id's own label. Falling back to the parent rule's would put one name on
    // four rows of the console (`style.override.*`), which is exactly the ambiguity the
    // finding-level ids exist to remove.
    label: emitted.label,
    builtinSeverity: emitted.severity,
    // The PARENT rule's, because the subkinds are the parent's: `icon.inline-svg` and
    // `icon.foreign-file` are two emitted ids of one rule that grades both `kit-icon` /
    // `no-match`. A rule whose emitted ids graded different shades would declare none.
    subkindLabels: rule.subkindLabels ?? {},
    subrules: [],
    origin,
  }));
};

/**
 * Every controllable rule id for a given run, sorted by category (in the enum's own order,
 * which is the order the report shows) and then by id.
 */
export const ruleCatalog = (adapter?: KitAdapter): readonly RuleCatalogEntry[] =>
  registryFor(adapter)
    .flatMap((rule) => entriesForRule(rule, adapter))
    .sort(
      (left, right) =>
        CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category) ||
        compareStrings(left.id, right.id),
    );
