import { Node, type SourceFile, type VariableDeclaration } from "ts-morph";

import type { VariantSetDto } from "../domain/components.ts";

import { readDoc } from "./jsdoc.ts";
import { toLocation, type LocationFactory } from "./location.ts";
import { compareStrings } from "@smart-tools/fe-analyzer-engine";

/**
 * Variant extraction — the allowed values of enumerable props.
 *
 * The kit encodes these as `as const` objects that map the *public* value a consumer
 * writes to the *internal* value forwarded to `@v-uik`:
 *
 *   export const views = { primary: 'primary', secondary: 'secondary', negative: 'error' } as const
 *   export const sizes = { xs: 'sm', sm: 'md', md: 'lg' } as const
 *
 * Only the keys are part of the consumer-facing contract — `<Button view="error"/>` is
 * invalid even though `'error'` appears on the right-hand side. Both sides are kept:
 * keys drive prop validation, values let the analyser recognise a raw `@v-uik` usage
 * that bypassed the kit's mapping.
 *
 * String-literal unions (`type Size = 'sm' | 'md'`) are collected as a second form.
 */

const isAsConst = (node: Node): boolean =>
  Node.isAsExpression(node) && node.getTypeNode()?.getText() === "const";

const literalValueOf = (node: Node): string | number | boolean | null => {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralValue();
  }
  if (Node.isNumericLiteral(node)) {
    return node.getLiteralValue();
  }
  if (Node.isTrueLiteral(node) || Node.isFalseLiteral(node)) {
    return node.getLiteralValue();
  }
  if (Node.isPrefixUnaryExpression(node)) {
    const operand = literalValueOf(node.getOperand());
    return typeof operand === "number" ? -operand : null;
  }
  return null;
};

interface ObjectVariant {
  readonly keys: string[];
  readonly values: Record<string, string | number | boolean>;
  readonly deprecatedKeys: string[];
}

/**
 * Reads a flat `as const` object. Nested objects (`ButtonIconSize = { xs: { size: 'sm' } }`)
 * still contribute their keys — those keys are the public prop values — but have no
 * scalar value to record.
 */
const readObjectVariant = (declaration: VariableDeclaration): ObjectVariant | null => {
  const initializer = declaration.getInitializer();
  if (!initializer || !isAsConst(initializer) || !Node.isAsExpression(initializer)) {
    return null;
  }

  const literal = initializer.getExpression();
  if (!Node.isObjectLiteralExpression(literal)) {
    return null;
  }

  const keys: string[] = [];
  const values: Record<string, string | number | boolean> = {};
  const deprecatedKeys: string[] = [];

  for (const property of literal.getProperties()) {
    if (!Node.isPropertyAssignment(property)) {
      continue;
    }

    const name = property.getName().replace(/^['"]|['"]$/g, "");
    keys.push(name);

    const value = literalValueOf(property.getInitializer() ?? property);
    if (value !== null) {
      values[name] = value;
    }
    if (readDoc(property).deprecated) {
      deprecatedKeys.push(name);
    }
  }

  return keys.length > 0 ? { keys, values, deprecatedKeys } : null;
};

/** Reads a string-literal union type alias, e.g. `type Size = 'sm' | 'md'`. */
const readLiteralUnion = (typeNode: Node): string[] | null => {
  if (!Node.isUnionTypeNode(typeNode)) {
    return null;
  }

  const values: string[] = [];

  for (const part of typeNode.getTypeNodes()) {
    if (!Node.isLiteralTypeNode(part)) {
      return null;
    }
    const literal = part.getLiteral();
    if (!Node.isStringLiteral(literal)) {
      return null;
    }
    values.push(literal.getLiteralValue());
  }

  return values.length > 0 ? values : null;
};

const isExported = (node: Node): boolean =>
  Node.isExportable(node) ? node.isExported() || node.isDefaultExport() : false;

/** Collects every exported variant set — `as const` objects and string-literal unions. */
export const findVariantSets = (
  files: readonly SourceFile[],
  locate: LocationFactory,
): VariantSetDto[] => {
  const results: VariantSetDto[] = [];

  for (const file of files) {
    for (const declaration of file.getVariableDeclarations()) {
      const statement = declaration.getVariableStatement();
      if (!statement || !isExported(statement)) {
        continue;
      }

      const variant = readObjectVariant(declaration);
      if (!variant) {
        continue;
      }

      results.push({
        name: declaration.getName(),
        location: toLocation(locate, declaration),
        kind: "constObject",
        keys: variant.keys,
        values: variant.values,
        deprecatedKeys: variant.deprecatedKeys,
      });
    }

    for (const alias of file.getTypeAliases()) {
      if (!isExported(alias)) {
        continue;
      }

      const typeNode = alias.getTypeNode();
      const values = typeNode ? readLiteralUnion(typeNode) : null;
      if (!values) {
        continue;
      }

      results.push({
        name: alias.getName(),
        location: toLocation(locate, alias),
        kind: "literalUnion",
        keys: values,
        values: {},
        deprecatedKeys: readDoc(alias).deprecated ? values : [],
      });
    }
  }

  return results.sort((a, b) => compareStrings(a.name, b.name));
};
