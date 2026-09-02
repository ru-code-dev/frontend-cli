/**
 * Token keys the kit's own sources mark `@deprecated`.
 *
 * 28 of them, all inside `packages/base/src/theme/core/edsSys/styles/edsSys.ts` (S1 break V15,
 * `reports/s1-v2-facts.md:392`). They are invisible to the loader: a JSDoc comment leaves no
 * trace in the evaluated object, so the only way to see them is to read the syntax.
 *
 * `ts.createSourceFile` rather than ts-morph because the question is one file deep and needs no
 * program, no type checker and no resolution — and the compiler is already in the bundle for the
 * theme loader's sake.
 */
import { readFileSync } from "node:fs";

import ts from "typescript";

/** Dotted paths under the tier root that carry `@deprecated`, e.g. `Background.backInfoGrey`. */
export const readDeprecatedTokenPaths = (file: string, exportName: string): Set<string> => {
  const found = new Set<string>();

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    // A kit that moved this file loses the flag, not the extraction: `deprecated` is additive
    // metadata and no rule depends on it.
    return found;
  }

  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

  const isDeprecated = (node: ts.Node): boolean =>
    ts
      .getLeadingCommentRanges(text, node.getFullStart())
      ?.some((range) => text.slice(range.pos, range.end).includes("@deprecated")) ?? false;

  const walk = (node: ts.Node, path: readonly string[]): void => {
    if (!ts.isObjectLiteralExpression(node)) return;

    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;

      const name = ts.isIdentifier(property.name)
        ? property.name.text
        : ts.isStringLiteral(property.name)
          ? property.name.text
          : null;
      if (name === null) continue;

      const next = [...path, name];
      if (isDeprecated(property)) found.add(next.join("."));
      walk(property.initializer, next);
    }
  };

  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== exportName) continue;
      if (declaration.initializer !== undefined) walk(declaration.initializer, []);
    }
  }

  return found;
};
