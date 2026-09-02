import { Node, SyntaxKind, type SourceFile } from "ts-morph";

import type { ComponentDetection, ReactComponentDto } from "../domain/components.ts";

import { readDoc } from "./jsdoc.ts";
import { toLocation, type LocationFactory } from "./location.ts";
import { compareStrings } from "@smart-tools/fe-analyzer-engine";

/**
 * Syntactic React-component detection.
 *
 * With no type checker available, "is this a component?" is answered from shape alone.
 * The rules below are ordered by confidence and cover every authoring style present in
 * the kit:
 *
 *   export const Button = React.forwardRef((props, ref) => …)   → forwardRef
 *   export const Chip = React.memo(ChipBase)                    → memo
 *   export function Grid(props) { return <div/> }               → functionWithJsx
 *   export const Icon = (props) => <svg/>                       → arrowWithJsx
 *   export const Input = PVInput                                → reExportedAlias
 *
 * A PascalCase name is required in every case. That is what separates a component from
 * a hook or a helper, and it matches the convention JSX itself enforces — a lowercase
 * tag is a DOM element, never a component.
 */

const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;

const JSX_KINDS = [
  SyntaxKind.JsxElement,
  SyntaxKind.JsxSelfClosingElement,
  SyntaxKind.JsxFragment,
] as const;

const FORWARD_REF_NAMES = ["forwardRef", "React.forwardRef"] as const;
const MEMO_NAMES = ["memo", "React.memo"] as const;

export const isComponentName = (name: string): boolean => PASCAL_CASE.test(name);

const containsJsx = (node: Node): boolean =>
  node.forEachDescendant((descendant, traversal) => {
    if ((JSX_KINDS as readonly SyntaxKind[]).includes(descendant.getKind())) {
      traversal.stop();
      return true;
    }
    return undefined;
  }) === true;

/** Strips `as X`, `<X>expr` and parentheses to reach the meaningful initializer. */
const unwrapExpression = (node: Node): Node => {
  let current = node;

  for (;;) {
    if (
      Node.isAsExpression(current) ||
      Node.isTypeAssertion(current) ||
      Node.isSatisfiesExpression(current)
    ) {
      current = current.getExpression();
      continue;
    }
    if (Node.isParenthesizedExpression(current)) {
      current = current.getExpression();
      continue;
    }
    return current;
  }
};

const calleeText = (call: Node): string | null =>
  Node.isCallExpression(call) ? call.getExpression().getText() : null;

const detectFromInitializer = (initializer: Node): ComponentDetection | null => {
  const expression = unwrapExpression(initializer);

  const callee = calleeText(expression);
  if (callee !== null) {
    if ((FORWARD_REF_NAMES as readonly string[]).includes(callee)) {
      return "forwardRef";
    }
    if ((MEMO_NAMES as readonly string[]).includes(callee)) {
      return "memo";
    }
    // `React.memo(React.forwardRef(…))` and similar nestings.
    if (
      Node.isCallExpression(expression) &&
      expression.getArguments().some((argument) => containsJsx(argument))
    ) {
      return "arrowWithJsx";
    }
  }

  if (Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)) {
    return containsJsx(expression) ? "arrowWithJsx" : null;
  }

  if (Node.isIdentifier(expression) && isComponentName(expression.getText())) {
    return "reExportedAlias";
  }

  return null;
};

interface DetectedComponent {
  readonly name: string;
  readonly detection: ComponentDetection;
  readonly node: Node;
}

const detectInFile = (file: SourceFile): DetectedComponent[] => {
  const detected: DetectedComponent[] = [];

  for (const declaration of file.getVariableDeclarations()) {
    const name = declaration.getName();
    const initializer = declaration.getInitializer();

    if (!isComponentName(name) || !initializer) {
      continue;
    }

    const detection = detectFromInitializer(initializer);
    if (detection !== null) {
      detected.push({ name, detection, node: declaration });
    }
  }

  for (const declaration of file.getFunctions()) {
    const name = declaration.getName();
    if (name !== undefined && isComponentName(name) && containsJsx(declaration)) {
      detected.push({ name, detection: "functionWithJsx", node: declaration });
    }
  }

  for (const declaration of file.getClasses()) {
    const name = declaration.getName();
    const heritage = declaration.getExtends()?.getText() ?? "";

    if (name !== undefined && isComponentName(name) && /(^|\.)(Pure)?Component\b/.test(heritage)) {
      detected.push({ name, detection: "classComponent", node: declaration });
    }
  }

  return detected;
};

/**
 * Finds `Parent.Child = …` assignments at module scope.
 *
 * The kit attaches sub-components this way (`Button.Icon = Icon`), and consumers use
 * them as `<Button.Icon/>`, so the analyser needs them to resolve such JSX names.
 */
const collectSubcomponents = (
  file: SourceFile,
  knownNames: ReadonlySet<string>,
): Map<string, string[]> => {
  const byParent = new Map<string, string[]>();

  for (const statement of file.getStatements()) {
    if (!Node.isExpressionStatement(statement)) {
      continue;
    }

    const expression = statement.getExpression();
    if (!Node.isBinaryExpression(expression)) {
      continue;
    }
    if (expression.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) {
      continue;
    }

    const target = expression.getLeft();
    if (!Node.isPropertyAccessExpression(target)) {
      continue;
    }

    const parent = target.getExpression().getText();
    const child = target.getName();

    if (!knownNames.has(parent) || !isComponentName(child)) {
      continue;
    }

    const bucket = byParent.get(parent);
    if (bucket) {
      if (!bucket.includes(child)) {
        bucket.push(child);
      }
    } else {
      byParent.set(parent, [child]);
    }
  }

  return byParent;
};

/** Detects every React component declared across `files`, with its sub-components. */
export const findReactComponents = (
  files: readonly SourceFile[],
  locate: LocationFactory,
): ReactComponentDto[] => {
  const results: ReactComponentDto[] = [];

  for (const file of files) {
    const detected = detectInFile(file);
    if (detected.length === 0) {
      continue;
    }

    const subcomponents = collectSubcomponents(file, new Set(detected.map((entry) => entry.name)));

    for (const entry of detected) {
      results.push({
        name: entry.name,
        detection: entry.detection,
        location: toLocation(locate, entry.node),
        subcomponents: [...(subcomponents.get(entry.name) ?? [])].sort(compareStrings),
        doc: readDoc(entry.node),
      });
    }
  }

  return results.sort((a, b) => compareStrings(a.name, b.name));
};
