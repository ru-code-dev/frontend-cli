/**
 * The variant groups of an EDS 2.x component, read off its `recipe({ variants })` calls.
 *
 * WHY NOT the `as const` constant objects the v1 extractor reads
 * (`extract/components/variants.ts:14-22`). Because v2 INVERTED them: `BUTTON_KIND =
 * { CONTAINED: 'contained', GHOST: 'ghost', … }` (S1 break V6,
 * `reports/s1-v2-facts.md:387`), so the public values are the object's VALUES and reading its
 * keys would offer a consumer `CONTAINED|GHOST|OUTLINED` — three spellings the component
 * rejects. `prop.invalid` would then be wrong in both directions at once.
 *
 * `recipe({ variants })` is the authority instead: it is what the component's class actually
 * switches on, and 57 of them cover every variant-bearing component in the kit (S1 §2b).
 *
 * `compoundVariants[].variants` is deliberately NOT read: it names combinations of values
 * declared above, and folding it in would add nothing while risking a value that only ever
 * appears in a compound.
 */
import {
  SyntaxKind,
  type CallExpression,
  type ObjectLiteralExpression,
  type SourceFile,
} from "ts-morph";

import { compareStrings, sortStrings } from "@smart-tools/fg-analyzer-engine";

/** One variant group: the prop a consumer writes, and the values it accepts. */
export interface RecipeVariantSet {
  name: string;
  location: { file: string; line: number };
  kind: "recipe";
  keys: string[];
  values: Record<string, string | number | boolean>;
  deprecatedKeys: string[];
}

const propertyNameOf = (node: { getName?: () => string }): string | null => {
  try {
    const raw = node.getName?.() ?? null;
    return raw === null ? null : raw.replace(/^['"`]|['"`]$/g, "");
  } catch {
    return null;
  }
};

/** The object literal a `recipe(...)` call is configured with, or `null`. */
const configOf = (call: CallExpression): ObjectLiteralExpression | null => {
  const callee = call.getExpression().getText();
  // `recipe(…)`, `createRecipe(…)` and the `makeStyles(...)`-bound `recipe` all spell the
  // last segment the same way; anything else is not a recipe.
  if (!/(^|\.)(recipe|createRecipe)$/.test(callee)) return null;

  return call.getArguments()[0]?.asKind(SyntaxKind.ObjectLiteralExpression) ?? null;
};

/** Every variant group declared by every recipe in `files`, merged and sorted. */
export const findRecipeVariantSets = (
  files: readonly SourceFile[],
  locate: (absolutePath: string) => string,
): RecipeVariantSet[] => {
  const groups = new Map<string, { keys: Set<string>; file: string; line: number }>();

  for (const file of files) {
    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const config = configOf(call);
      if (config === null) continue;

      const variants = config
        .getProperty("variants")
        ?.asKind(SyntaxKind.PropertyAssignment)
        ?.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
      if (variants === undefined) continue;

      for (const group of variants.getProperties()) {
        const assignment = group.asKind(SyntaxKind.PropertyAssignment);
        if (assignment === undefined) continue;

        const name = propertyNameOf(assignment);
        const values = assignment.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
        if (name === null || values === undefined) continue;

        const bucket = groups.get(name) ?? {
          keys: new Set<string>(),
          file: locate(file.getFilePath()),
          line: assignment.getStartLineNumber(),
        };
        for (const value of values.getProperties()) {
          const key = propertyNameOf(value.asKind(SyntaxKind.PropertyAssignment) ?? {});
          // `true` is a boolean variant's only key — a real value a consumer writes as
          // `withIcon` rather than `withIcon="true"`, and keeping it costs nothing while
          // dropping it would make `variantValues` claim the group has no values at all.
          if (key !== null) bucket.keys.add(key);
        }
        groups.set(name, bucket);
      }
    }
  }

  return [...groups.entries()]
    .toSorted(([left], [right]) => compareStrings(left, right))
    .map(([name, group]) => ({
      name,
      location: { file: group.file, line: group.line },
      kind: "recipe" as const,
      keys: sortStrings([...group.keys]),
      // A recipe group has no internal mapping and no per-key JSDoc: the keys ARE the API.
      values: {},
      deprecatedKeys: [],
    }));
};
