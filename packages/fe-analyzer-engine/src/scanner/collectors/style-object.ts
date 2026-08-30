import { Node, SyntaxKind } from "ts-morph";

import type { StyleValue } from "../../domain/observations.ts";
import type { StyleSyntax } from "../../domain/profile.ts";
import { cssPropertyFromStyleKey } from "../../css/properties.ts";

/**
 * Style objects: `style={{ … }}`, JSS, emotion's object syntax. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/scanner/collectors/style-object.ts:1-212`.
 *
 * Two things differ from CSS text and both matter.
 *
 * **Numbers are pixels.** React appends `px` to a numeric value unless the property is
 * unitless, so `padding: 21` is `21px` and `fontWeight: 500` is not `500px`. The unitless set
 * is React's own; getting it wrong would either invent lengths or lose them.
 *
 * **Values are expressions.** `borderBottom: active ? '2px solid #2969e3' : 'none'` holds a
 * real design decision in each branch, so both are walked. Anything that is neither a literal
 * nor a conditional over literals is recorded as dynamic rather than dropped.
 */

/**
 * Properties React does not suffix with `px`.
 *
 * Taken from React's `isUnitlessNumber`, minus the vendor-prefixed duplicates, which are
 * normalised away before the lookup.
 */
const UNITLESS_PROPERTIES: ReadonlySet<string> = new Set([
  "animation-iteration-count",
  "aspect-ratio",
  "border-image-outset",
  "border-image-slice",
  "border-image-width",
  "box-flex",
  "box-flex-group",
  "box-ordinal-group",
  "column-count",
  "columns",
  "flex",
  "flex-grow",
  "flex-positive",
  "flex-shrink",
  "flex-negative",
  "flex-order",
  "grid-area",
  "grid-row",
  "grid-row-end",
  "grid-row-span",
  "grid-row-start",
  "grid-column",
  "grid-column-end",
  "grid-column-span",
  "grid-column-start",
  "font-weight",
  "line-clamp",
  "line-height",
  "opacity",
  "order",
  "orphans",
  "tab-size",
  "widows",
  "z-index",
  "zoom",
  "fill-opacity",
  "flood-opacity",
  "stop-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
]);

interface LiteralValue {
  readonly text: string;
  readonly node: Node;
}

/**
 * Literal values an expression can take.
 *
 * A conditional yields both branches; nested conditionals flatten. An empty result means the
 * expression is dynamic.
 */
const literalValuesOf = (node: Node): LiteralValue[] => {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return [{ text: node.getLiteralValue(), node }];
  }

  if (Node.isNumericLiteral(node)) {
    return [{ text: node.getText(), node }];
  }

  if (Node.isPrefixUnaryExpression(node) && node.getOperatorToken() === SyntaxKind.MinusToken) {
    const operand = node.getOperand();
    if (Node.isNumericLiteral(operand)) {
      return [{ text: `-${operand.getText()}`, node }];
    }
    return [];
  }

  if (Node.isConditionalExpression(node)) {
    return [...literalValuesOf(node.getWhenTrue()), ...literalValuesOf(node.getWhenFalse())];
  }

  if (Node.isParenthesizedExpression(node)) {
    return literalValuesOf(node.getExpression());
  }

  // `a ?? '#fff'` and `a || '#fff'`: the right-hand side is a real authored default.
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (operator === SyntaxKind.QuestionQuestionToken || operator === SyntaxKind.BarBarToken) {
      return literalValuesOf(node.getRight());
    }
  }

  return [];
};

/** Applies React's number-means-pixels rule. */
const withUnit = (property: string, text: string): string => {
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) {
    return text;
  }

  return UNITLESS_PROPERTIES.has(property) || text === "0" ? text : `${text}px`;
};

export interface StyleObjectInput {
  readonly file: string;
  readonly object: Node;
  readonly source: Extract<StyleSyntax, "inline-style" | "jss" | "emotion">;
  /** Selector to display; for JSS this is the rule key, for inline styles `null`. */
  readonly selector: string | null;
  /** CSS classes the object maps to, for JSS rule objects. */
  readonly classNames: readonly string[];
}

export interface StyleObjectResult {
  readonly styleValues: StyleValue[];
  /** Properties whose value could not be reduced to a literal. */
  readonly dynamicProperties: { readonly property: string; readonly line: number }[];
}

/** Converts one object literal into style values. */
export const collectStyleObject = (input: StyleObjectInput): StyleObjectResult => {
  const { file, object, source, selector, classNames } = input;
  const styleValues: StyleValue[] = [];
  const dynamicProperties: { property: string; line: number }[] = [];

  if (!Node.isObjectLiteralExpression(object)) {
    return { styleValues, dynamicProperties };
  }

  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) {
      // Spreads and shorthand assignments carry no literal of their own.
      continue;
    }

    const nameNode = property.getNameNode();
    const key = Node.isStringLiteral(nameNode) ? nameNode.getLiteralValue() : nameNode.getText();
    const cssProperty = cssPropertyFromStyleKey(key);
    const initializer = property.getInitializer();

    if (!initializer) {
      continue;
    }

    // Nested objects are JSS rule bodies or `&:hover` blocks; recurse with the key as the
    // selector so the coordinates and attribution stay correct.
    if (Node.isObjectLiteralExpression(initializer)) {
      const nested = collectStyleObject({
        file,
        object: initializer,
        source,
        selector: key,
        classNames: key.startsWith("&") || key.startsWith("@") ? classNames : [key],
      });
      styleValues.push(...nested.styleValues);
      dynamicProperties.push(...nested.dynamicProperties);
      continue;
    }

    const values = literalValuesOf(initializer);

    if (values.length === 0) {
      dynamicProperties.push({ property: cssProperty, line: property.getStartLineNumber() });
      continue;
    }

    for (const value of values) {
      styleValues.push({
        property: cssProperty,
        value: withUnit(cssProperty, value.text),
        authored: null,
        file,
        line: value.node.getStartLineNumber(),
        column: value.node.getStart() - value.node.getStartLinePos() + 1,
        source,
        selector,
        classNames: [...classNames],
        important: false,
        dynamic: false,
        rootCause: null,
        appliedTo: null,
      });
    }
  }

  return { styleValues, dynamicProperties };
};
