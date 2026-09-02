import { Node, SyntaxKind } from "ts-morph";

import type { StyleValue, TokenReference } from "../../domain/observations.ts";
import type { StyleSyntax } from "../../domain/profile.ts";
import { cssPropertyFromStyleKey } from "../../css/properties.ts";
import { customPropertyReference } from "../../css/value.ts";

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
 * Keys that hold a MAP OF NESTED BLOCKS rather than a declaration.
 *
 * vanilla-extract puts pseudo-selectors under `selectors` and conditions under the at-rule
 * that names them, so `{ selectors: { '&:hover': {…} } }` has two levels of object before a
 * single property appears. Treated as ordinary nested objects — which is what the React
 * branch does with them — the word `selectors` would be recorded as a CSS selector and
 * `'&:hover'` as a second one nested inside it.
 *
 * The two lists differ in what they do to the selector, which is the whole reason they are two
 * lists: a child of `selectors` IS the selector; a child of `@media` is a *condition* under
 * which the enclosing selector still applies, so the selector passes through unchanged.
 */
const SELECTOR_MAP_KEYS: ReadonlySet<string> = new Set(["selectors"]);

/**
 * The `property` a spread is recorded under.
 *
 * A spread has no CSS property — it stands for however many the group expands to — and the
 * schema requires one, so it gets the three characters it is written with. Deliberately not a
 * plausible property name: a reader and a rule alike must be unable to mistake it for one.
 */
export const SPREAD_PROPERTY = "...";
const CONDITION_MAP_KEYS: ReadonlySet<string> = new Set([
  "@media",
  "@supports",
  "@container",
  "@layer",
]);

/**
 * What a non-literal value expression turned out to be, from a caller that can tell.
 *
 * `collectStyleObject` knows CSS and nothing else: to it, `tokens.sys.color.textPrimary`
 * is an expression that yields no literal, i.e. dynamic. Only the caller holding the file's
 * import list can say that it is a resolved token reference — so that judgement is a hook
 * rather than a branch here, and this module stays free of any notion of a token.
 */
export interface ExpressionResolution {
  /** Text to record as `StyleValue.value`. */
  readonly value: string;
  /** Source text, when it differs from `value`. */
  readonly authored: string | null;
  readonly dynamic: boolean;
  readonly reference: TokenReference | null;
  /** Why the expression could not be resolved, when it is a reference-shaped one. */
  readonly unresolved: string | null;
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
  readonly source: Extract<StyleSyntax, "inline-style" | "jss" | "emotion" | "vanilla-extract">;
  /** Selector to display; for JSS this is the rule key, for inline styles `null`. */
  readonly selector: string | null;
  /** CSS classes the object maps to, for JSS rule objects. */
  readonly classNames: readonly string[];
  /**
   * How nested objects are read. `react` (the default) is the behaviour this collector has
   * always had: every nested object is a rule body named by its key. `vanilla-extract` adds
   * the two container keys above, and stops inventing class names — a `.css.ts` class is
   * hashed at build time and never appears in the source, so there is nothing for the linking
   * pass to match against and claiming otherwise would attach declarations to the wrong JSX.
   */
  readonly nesting?: "react" | "vanilla-extract";
  /** @see ExpressionResolution */
  readonly resolveExpression?: (node: Node, property: string) => ExpressionResolution | null;
}

export interface StyleObjectResult {
  readonly styleValues: StyleValue[];
  /** Properties whose value could not be reduced to a literal. */
  readonly dynamicProperties: { readonly property: string; readonly line: number }[];
  /**
   * Reference-shaped values the caller's resolver refused to guess at.
   *
   * Separate from `dynamicProperties` because they are a different fact and get a different
   * limitation reason: `padding: gap` is a value nobody can check, while
   * `color: tokens.sys.color[role]` is a TOKEN REFERENCE that exists and was not resolved
   * — counted and shown (design E5), not folded into the general dynamic bucket.
   */
  readonly unresolvedReferences: {
    readonly property: string;
    readonly line: number;
    readonly detail: string;
  }[];
}

/** Converts one object literal into style values. */
export const collectStyleObject = (input: StyleObjectInput): StyleObjectResult => {
  const { file, object, source, selector, classNames } = input;
  const nesting = input.nesting ?? "react";
  const resolveExpression = input.resolveExpression;
  const styleValues: StyleValue[] = [];
  const dynamicProperties: { property: string; line: number }[] = [];
  const unresolvedReferences: { property: string; line: number; detail: string }[] = [];

  if (!Node.isObjectLiteralExpression(object)) {
    return { styleValues, dynamicProperties, unresolvedReferences };
  }

  /** Recurses into a nested block, carrying every option of this call through unchanged. */
  const descend = (
    nested: Node,
    nestedSelector: string | null,
    nestedClassNames: readonly string[],
  ): void => {
    const result = collectStyleObject({
      file,
      object: nested,
      source,
      selector: nestedSelector,
      classNames: nestedClassNames,
      nesting,
      ...(resolveExpression === undefined ? {} : { resolveExpression }),
    });
    styleValues.push(...result.styleValues);
    dynamicProperties.push(...result.dynamicProperties);
    unresolvedReferences.push(...result.unresolvedReferences);
  };

  for (const property of object.getProperties()) {
    // `{ ...tokens.sys.typography.body }` — a spread carries no literal, but it can carry a
    // whole GROUP of declarations, and an object that looks half-written because the other
    // half arrived through one is exactly the false finding this branch prevents.
    if (Node.isSpreadAssignment(property)) {
      const spread = resolveExpression?.(property.getExpression(), SPREAD_PROPERTY) ?? null;

      if (spread === null) {
        continue;
      }

      if (spread.unresolved !== null) {
        unresolvedReferences.push({
          property: SPREAD_PROPERTY,
          line: property.getStartLineNumber(),
          detail: spread.unresolved,
        });
      }

      styleValues.push({
        property: SPREAD_PROPERTY,
        value: spread.value,
        authored: spread.authored,
        file,
        line: property.getStartLineNumber(),
        column: property.getStart() - property.getStartLinePos() + 1,
        source,
        selector,
        classNames: [...classNames],
        important: false,
        dynamic: spread.dynamic,
        reference:
          spread.reference === null || spread.reference.kind !== "js-path"
            ? spread.reference
            : { ...spread.reference, spread: true },
        rootCause: null,
        appliedTo: null,
      });
      continue;
    }

    if (!Node.isPropertyAssignment(property)) {
      // A shorthand assignment carries no literal of its own.
      continue;
    }

    const nameNode = property.getNameNode();
    const key = Node.isStringLiteral(nameNode) ? nameNode.getLiteralValue() : nameNode.getText();
    const cssProperty = cssPropertyFromStyleKey(key);
    const initializer = property.getInitializer();

    if (!initializer) {
      continue;
    }

    // `selectors: { '&:hover': {…} }` / `'@media': { '(hover: hover)': {…} }` — one level of
    // map before the rule bodies. Only in vanilla-extract mode: in a JSS object the same word
    // would be an ordinary rule name.
    if (
      nesting === "vanilla-extract" &&
      Node.isObjectLiteralExpression(initializer) &&
      (SELECTOR_MAP_KEYS.has(key) || CONDITION_MAP_KEYS.has(key))
    ) {
      const keepsSelector = CONDITION_MAP_KEYS.has(key);

      for (const entry of initializer.getProperties()) {
        if (!Node.isPropertyAssignment(entry)) {
          continue;
        }
        const entryName = entry.getNameNode();
        const entryKey = Node.isStringLiteral(entryName)
          ? entryName.getLiteralValue()
          : entryName.getText();
        const body = entry.getInitializer();
        if (body) {
          descend(body, keepsSelector ? selector : entryKey, classNames);
        }
      }
      continue;
    }

    // Nested objects are JSS rule bodies or `&:hover` blocks; recurse with the key as the
    // selector so the coordinates and attribution stay correct.
    if (Node.isObjectLiteralExpression(initializer)) {
      descend(
        initializer,
        key,
        // A vanilla-extract class name is hashed at build time and is nowhere in the source,
        // so there is no class for the linking pass to match on and inventing one would
        // attribute the declaration to whatever JSX happened to use that word.
        nesting === "vanilla-extract" || key.startsWith("&") || key.startsWith("@")
          ? classNames
          : [key],
      );
      continue;
    }

    const values = literalValuesOf(initializer);

    if (values.length === 0) {
      const resolution = resolveExpression?.(initializer, cssProperty) ?? null;

      if (resolution === null) {
        dynamicProperties.push({ property: cssProperty, line: property.getStartLineNumber() });
        continue;
      }

      if (resolution.unresolved !== null) {
        unresolvedReferences.push({
          property: cssProperty,
          line: property.getStartLineNumber(),
          detail: resolution.unresolved,
        });
      }

      styleValues.push({
        property: cssProperty,
        value: resolution.value,
        authored: resolution.authored,
        file,
        line: initializer.getStartLineNumber(),
        column: initializer.getStart() - initializer.getStartLinePos() + 1,
        source,
        selector,
        classNames: [...classNames],
        important: false,
        dynamic: resolution.dynamic,
        reference: resolution.reference,
        rootCause: null,
        appliedTo: null,
      });
      continue;
    }

    for (const value of values) {
      const text = withUnit(cssProperty, value.text);

      styleValues.push({
        property: cssProperty,
        value: text,
        authored: null,
        file,
        line: value.node.getStartLineNumber(),
        column: value.node.getStart() - value.node.getStartLinePos() + 1,
        source,
        selector,
        classNames: [...classNames],
        important: false,
        dynamic: false,
        // A literal can still BE a reference: `color: 'var(--brand)'` is written as a string
        // in every object dialect, and the histogram must see it there too.
        reference: customPropertyReference(text),
        rootCause: null,
        appliedTo: null,
      });
    }
  }

  return { styleValues, dynamicProperties, unresolvedReferences };
};
