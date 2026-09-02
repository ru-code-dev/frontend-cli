import { Node, ts } from "ts-morph";

import type { JsxRootKind, PolymorphicInfo, SnapshotRoot } from "./types.ts";

const MAX_RESOLUTION_DEPTH = 12;

/** Strip the wrappers that carry no meaning for "what does this evaluate to". */
export function unwrap(node: Node | undefined): Node | undefined {
  let current = node;
  while (current !== undefined) {
    if (
      Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isTypeAssertion(current) ||
      Node.isNonNullExpression(current)
    ) {
      current = current.getExpression();
      continue;
    }
    return current;
  }
  return undefined;
}

function aliasedDeclaration(node: Node): Node | undefined {
  const symbol = node.getSymbol();
  if (symbol === undefined) return undefined;
  const target = symbol.getAliasedSymbol() ?? symbol;
  return target.getDeclarations()[0] ?? target.getValueDeclaration();
}

export function isFunctionLike(node: Node | undefined): boolean {
  return (
    node !== undefined &&
    (Node.isFunctionDeclaration(node) ||
      Node.isFunctionExpression(node) ||
      Node.isArrowFunction(node))
  );
}

/**
 * Find the function body that actually renders.
 *
 * This is the step that makes factory-created components work WITHOUT knowing the factory's
 * name: an exported `const Widget = whateverTheKitCallsIt(...)` is followed to the callee's
 * declaration and then to the function that callee returns. The same walk covers
 * `forwardRef(fn)`, `memo(fn)` and any other wrapper that takes the render function as an
 * argument — the first function-shaped argument wins, otherwise the callee is opened up.
 */
export function resolveImplementation(node: Node | undefined, depth = 0): Node | undefined {
  const current = unwrap(node);
  if (current === undefined || depth > MAX_RESOLUTION_DEPTH) return undefined;

  if (isFunctionLike(current)) return current;

  if (Node.isVariableDeclaration(current)) {
    return resolveImplementation(current.getInitializer(), depth + 1);
  }

  if (Node.isIdentifier(current) || Node.isPropertyAccessExpression(current)) {
    const declaration = aliasedDeclaration(current);
    if (declaration === undefined || declaration === current) return undefined;
    return resolveImplementation(declaration, depth + 1);
  }

  if (Node.isExportSpecifier(current) || Node.isImportSpecifier(current)) {
    const declaration = aliasedDeclaration(current.getNameNode());
    return declaration === undefined ? undefined : resolveImplementation(declaration, depth + 1);
  }

  if (Node.isCallExpression(current)) {
    for (const argument of current.getArguments()) {
      const unwrapped = unwrap(argument);
      if (isFunctionLike(unwrapped)) return resolveImplementation(unwrapped, depth + 1);
    }
    for (const argument of current.getArguments()) {
      const unwrapped = unwrap(argument);
      if (unwrapped !== undefined && Node.isIdentifier(unwrapped)) {
        const resolved = resolveImplementation(unwrapped, depth + 1);
        if (resolved !== undefined) return resolved;
      }
    }
    const callee = resolveImplementation(current.getExpression(), depth + 1);
    if (callee === undefined) return undefined;
    for (const returned of returnExpressions(callee)) {
      const resolved = resolveImplementation(returned, depth + 1);
      if (resolved !== undefined) return resolved;
    }
  }

  return undefined;
}

/** Return expressions of THIS function only — nested functions are their own scope. */
export function returnExpressions(fn: Node): Node[] {
  const body =
    Node.isFunctionDeclaration(fn) || Node.isFunctionExpression(fn) || Node.isArrowFunction(fn)
      ? fn.getBody()
      : undefined;
  if (body === undefined) return [];
  if (!Node.isBlock(body)) {
    const expression = unwrap(body);
    return expression === undefined ? [] : [expression];
  }

  const out: Node[] = [];
  const walk = (node: Node): void => {
    node.forEachChild((child) => {
      if (isFunctionLike(child) || Node.isClassDeclaration(child) || Node.isClassExpression(child))
        return;
      if (Node.isReturnStatement(child)) {
        const expression = unwrap(child.getExpression());
        if (expression !== undefined) out.push(expression);
        return;
      }
      walk(child);
    });
  };
  walk(body);
  return out;
}

export function isJsxNode(node: Node): boolean {
  return Node.isJsxElement(node) || Node.isJsxSelfClosingElement(node) || Node.isJsxFragment(node);
}

const SHORT_CIRCUIT = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

/** Every value a return expression can evaluate to, with conditionals split into branches. */
function candidateRoots(expression: Node, out: Node[]): void {
  const node = unwrap(expression);
  if (node === undefined) return;

  if (Node.isConditionalExpression(node)) {
    candidateRoots(node.getWhenTrue(), out);
    candidateRoots(node.getWhenFalse(), out);
    return;
  }
  if (Node.isBinaryExpression(node) && SHORT_CIRCUIT.has(node.getOperatorToken().getKind())) {
    candidateRoots(node.getLeft(), out);
    candidateRoots(node.getRight(), out);
    return;
  }
  // Renders nothing — not a competing root.
  if (Node.isNullLiteral(node)) return;
  if (node.getKind() === ts.SyntaxKind.FalseKeyword) return;
  if (Node.isIdentifier(node) && node.getText() === "undefined") return;

  out.push(node);
}

/** Does the implementation reachable from this export return JSX at all? */
export function returnsJsx(component: Node): boolean {
  const implementation = resolveImplementation(component);
  if (implementation === undefined) return false;
  const candidates: Node[] = [];
  for (const returned of returnExpressions(implementation)) candidateRoots(returned, candidates);
  return candidates.some((candidate) => isJsxNode(candidate));
}

export interface RootAnalysis {
  /** The single static JSX root, when there is exactly one. */
  root: Node | null;
  tag: string | null;
  kind: JsxRootKind;
  /** Declaration the tag identifier resolves to, for `component`/`dynamic` roots. */
  target: Node | undefined;
  /** Machine-stable reason when the root is not a single static JSX element. */
  reason: string | null;
}

function tagNameNode(node: Node): Node | undefined {
  if (Node.isJsxElement(node)) return node.getOpeningElement().getTagNameNode();
  if (Node.isJsxSelfClosingElement(node)) return node.getTagNameNode();
  return undefined;
}

function classifyTag(tagNode: Node): { kind: JsxRootKind; target: Node | undefined } {
  const text = tagNode.getText();
  // JSX's own rule: a lowercase-initial plain identifier is an intrinsic element.
  if (Node.isIdentifier(tagNode) && /^[a-z]/u.test(text))
    return { kind: "intrinsic", target: undefined };

  const declaration = aliasedDeclaration(tagNode);
  if (declaration === undefined) return { kind: "dynamic", target: undefined };
  // A tag bound by destructuring or by a parameter is chosen at runtime, not here.
  if (Node.isBindingElement(declaration) || Node.isParameterDeclaration(declaration)) {
    return { kind: "dynamic", target: declaration };
  }
  return { kind: "component", target: declaration };
}

/** Resolve the root JSX element of a component's own implementation. */
export function analyzeRoot(component: Node): RootAnalysis {
  const implementation = resolveImplementation(component);
  if (implementation === undefined) {
    return {
      root: null,
      tag: null,
      kind: "none",
      target: undefined,
      reason: "no-resolvable-implementation",
    };
  }

  const candidates: Node[] = [];
  for (const returned of returnExpressions(implementation)) candidateRoots(returned, candidates);

  if (candidates.length === 0) {
    return { root: null, tag: null, kind: "none", target: undefined, reason: "no-jsx-returned" };
  }
  if (candidates.some((candidate) => !isJsxNode(candidate))) {
    return { root: null, tag: null, kind: "none", target: undefined, reason: "non-literal-return" };
  }

  const distinct = new Set(
    candidates.map((candidate) => tagNameNode(candidate)?.getText() ?? "#fragment"),
  );
  if (distinct.size > 1) {
    return { root: null, tag: null, kind: "none", target: undefined, reason: "conditional-root" };
  }

  const root = candidates[0]!;
  if (Node.isJsxFragment(root)) {
    return { root, tag: null, kind: "fragment", target: undefined, reason: "fragment-root" };
  }
  const tagNode = tagNameNode(root)!;
  const { kind, target } = classifyTag(tagNode);
  return {
    root,
    tag: tagNode.getText(),
    kind,
    target,
    reason: kind === "dynamic" ? "dynamic-tag" : null,
  };
}

/**
 * Polymorphism, read off the code rather than off a name list: when the root tag is a binding
 * destructured out of the props object, THAT prop is the polymorphic one and its destructuring
 * default is the recorded default. The name fallback below only fires when the root could not
 * be traced, and it is the pair the owner named.
 */
export function analyzePolymorphic(
  analysis: RootAnalysis,
  propNames: readonly string[],
): PolymorphicInfo | null {
  const target = analysis.target;
  if (target !== undefined && Node.isBindingElement(target)) {
    const propertyName = target.getPropertyNameNode()?.getText() ?? target.getNameNode().getText();
    const initializer = unwrap(target.getInitializer());
    const fallback =
      initializer === undefined
        ? null
        : Node.isStringLiteral(initializer)
          ? initializer.getLiteralValue()
          : initializer.getText();
    return { prop: propertyName, default: fallback };
  }
  for (const name of ["as", "forwardedAs"]) {
    if (propNames.includes(name)) return { prop: name, default: null };
  }
  return null;
}

function childKind(child: Node): string | null {
  if (Node.isJsxText(child)) return child.getText().trim().length === 0 ? null : "text";
  if (Node.isJsxExpression(child)) return "expression";
  if (Node.isJsxElement(child) || Node.isJsxSelfClosingElement(child)) return "element";
  if (Node.isJsxFragment(child)) return "fragment";
  return null;
}

/**
 * The stable shape used to compare a custom component against a kit one. It records structure
 * (tag, attribute names, kinds of children) and never raw source text, so reformatting the kit
 * cannot change it.
 */
export function snapshotRoot(analysis: RootAnalysis): SnapshotRoot {
  const root = analysis.root;
  if (root === null) {
    return { tag: null, kind: analysis.kind, attributes: [], children: [] };
  }

  const attributes = new Set<string>();
  const attributeNodes = Node.isJsxElement(root)
    ? root.getOpeningElement().getAttributes()
    : Node.isJsxSelfClosingElement(root)
      ? root.getAttributes()
      : [];
  for (const attribute of attributeNodes) {
    attributes.add(
      Node.isJsxSpreadAttribute(attribute) ? "..." : attribute.getNameNode().getText(),
    );
  }

  const children = new Set<string>();
  if (Node.isJsxElement(root) || Node.isJsxFragment(root)) {
    for (const child of root.getJsxChildren()) {
      const kind = childKind(child);
      if (kind !== null) children.add(kind);
    }
  }

  return {
    tag: analysis.tag,
    kind: analysis.kind,
    attributes: [...attributes].sort(),
    children: [...children].sort(),
  };
}
