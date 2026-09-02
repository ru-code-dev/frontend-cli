import { Node, ts, type Type } from "ts-morph";

import type { PropEntry } from "./types.ts";
import { toRelative, typeText } from "./type-text.ts";

/**
 * "Kit-authored" is decided by WHERE a property is declared, never by what it is called.
 *
 * A prop the kit wrote lives in a real source file inside the kit root. Everything else — the
 * ~250 attributes of `React.ComponentPropsWithoutRef<'button'>`, `RefAttributes`, `lib.dom.d.ts`
 * — arrives from a declaration file or from outside the kit, and is collapsed rather than
 * enumerated. That rule needs no list of React type names and no list of kit factory names.
 */
export function isExternalDeclaration(declaration: Node, kitRoot: string): boolean {
  const file = declaration.getSourceFile();
  if (file.isDeclarationFile()) return true;
  const path = file.getFilePath();
  if (path.includes("/node_modules/")) return true;
  return toRelative(kitRoot, path).startsWith("..");
}

/** Nearest named type container, used as the `from.name` of a property. */
function declaringTypeName(declaration: Node): string {
  let current: Node | undefined = declaration;
  while (current !== undefined) {
    if (
      Node.isInterfaceDeclaration(current) ||
      Node.isTypeAliasDeclaration(current) ||
      Node.isClassDeclaration(current)
    ) {
      return current.getName() ?? "(anonymous)";
    }
    current = current.getParent();
  }
  return "(anonymous)";
}

export interface FlattenedProps {
  props: PropEntry[];
  /** Number of properties that came from outside the kit and were therefore collapsed. */
  externalCount: number;
  /** Properties the checker gave no declaration for at all. */
  undeclared: string[];
}

/**
 * Flatten a props type through the checker. `extends` chains, `Omit`/`Pick`/`Partial` and
 * intersections are already resolved by the time `getProperties()` answers — what this adds is
 * the provenance, which survives those utilities because a mapped type's property symbols keep
 * pointing at the declaration they were derived from.
 */
export function flattenProps(propsType: Type, at: Node, kitRoot: string): FlattenedProps {
  const props: PropEntry[] = [];
  const undeclared: string[] = [];
  let externalCount = 0;

  for (const property of propsType.getProperties()) {
    const declaration = property.getDeclarations()[0];
    if (declaration === undefined) {
      undeclared.push(property.getName());
      continue;
    }
    if (isExternalDeclaration(declaration, kitRoot)) {
      externalCount += 1;
      continue;
    }
    const optional = property.hasFlags(ts.SymbolFlags.Optional);
    props.push({
      name: property.getName(),
      type: typeText(property.getTypeAtLocation(at), at, kitRoot, { stripUndefined: optional }),
      required: !optional,
      from: {
        name: declaringTypeName(declaration),
        file: toRelative(kitRoot, declaration.getSourceFile().getFilePath()),
      },
    });
  }

  props.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  undeclared.sort();
  return { props, externalCount, undeclared };
}

export interface ExternalBase {
  /** The heritage/intersection member exactly as written. */
  text: string;
  /** First string-literal type argument, e.g. `"button"` — the collapsed DOM element. */
  element: string | null;
}

function allPropertiesExternal(type: Type, kitRoot: string): boolean {
  // Only an object-ish type can BE a prop set. Without this guard a literal type argument such
  // as the `"tone"` in `Omit<InnerProps, "tone">` would qualify, because every apparent member
  // of a string literal comes from `lib.es5.d.ts` and is therefore "external".
  if (!type.isObject() && !type.isIntersection()) return false;
  const properties = type.getProperties();
  if (properties.length === 0) return false;
  return properties.every((property) => {
    const declaration = property.getDeclarations()[0];
    return declaration !== undefined && isExternalDeclaration(declaration, kitRoot);
  });
}

function literalTypeArgument(node: Node): string | null {
  const args =
    Node.isExpressionWithTypeArguments(node) || Node.isTypeReference(node)
      ? node.getTypeArguments()
      : [];
  for (const arg of args) {
    if (Node.isLiteralTypeNode(arg)) {
      const literal = arg.getLiteral();
      if (Node.isStringLiteral(literal)) return literal.getLiteralValue();
    }
  }
  return null;
}

function typeArgumentNodes(node: Node): Node[] {
  if (Node.isExpressionWithTypeArguments(node) || Node.isTypeReference(node)) {
    return [...node.getTypeArguments()];
  }
  return [];
}

/**
 * Walk the props type's *syntax* to find which written base contributed the external property
 * set, so the collapse can name an element.
 *
 * The discriminator is structural, not nominal: a base whose properties are ALL externally
 * declared is a raw prop set and collapses; `Omit<InnerProps, "tone">` is not, because its
 * properties still resolve back to the kit's own interface — so it is descended into instead.
 */
export function collectExternalBases(propsType: Type, kitRoot: string): ExternalBase[] {
  const found = new Map<string, ExternalBase>();
  const seenTypes = new Set<Type>();
  const seenNodes = new Set<Node>();

  const visitType = (type: Type): void => {
    if (seenTypes.has(type)) return;
    seenTypes.add(type);

    if (type.isIntersection()) {
      for (const member of type.getIntersectionTypes()) visitType(member);
      return;
    }
    for (const declaration of type.getSymbol()?.getDeclarations() ?? []) {
      if (Node.isInterfaceDeclaration(declaration)) {
        for (const clause of declaration.getHeritageClauses()) {
          for (const node of clause.getTypeNodes()) visitNode(node);
        }
        continue;
      }
      if (Node.isTypeAliasDeclaration(declaration)) {
        const typeNode = declaration.getTypeNode();
        if (typeNode === undefined) continue;
        if (Node.isIntersectionTypeNode(typeNode)) {
          for (const node of typeNode.getTypeNodes()) visitNode(node);
        } else {
          visitNode(typeNode);
        }
      }
    }
  };

  const visitNode = (node: Node): void => {
    if (seenNodes.has(node)) return;
    seenNodes.add(node);

    const type = node.getType();
    if (allPropertiesExternal(type, kitRoot)) {
      const text = node.getText();
      if (!found.has(text)) found.set(text, { text, element: literalTypeArgument(node) });
      return;
    }
    // Not a raw external set — descend, both into the type it resolves to and into its type
    // arguments, so `Omit<BaseWithDomProps, "x">` still reaches the DOM set inside.
    visitType(type);
    for (const arg of typeArgumentNodes(node)) visitNode(arg);
  };

  visitType(propsType);

  return [...found.values()].sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
}

/** The props type of a component: parameter 0 of its first call signature. */
export function propsTypeOf(declaration: Node, componentType: Type): Type | null {
  const signature = componentType.getCallSignatures()[0];
  if (signature === undefined) return null;
  const parameter = signature.getParameters()[0];
  if (parameter === undefined) return null;
  return parameter.getTypeAtLocation(declaration);
}
