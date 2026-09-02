import { Node, type InterfaceDeclaration, type TypeAliasDeclaration } from "ts-morph";

import type { DocDto } from "../domain/components.ts";

import { readDoc } from "./jsdoc.ts";

/**
 * Member extraction shared by the props and slots readers.
 *
 * Both `ButtonProps` and `ButtonClasses` are declared as an intersection of a type
 * literal with one or more types the extractor cannot resolve:
 *
 *   type ButtonClasses = ButtonProps['classes'] & { spinner?: string; … }
 *
 * The literal part yields real members; the rest is recorded verbatim in `bases` so the
 * artifact states plainly that its member list is partial rather than implying the
 * component has only four props.
 */

export interface TypeMember {
  readonly name: string;
  readonly optional: boolean;
  /** Type as written; `unknown` when the member has no explicit type node. */
  readonly type: string;
  readonly doc: DocDto;
}

export interface TypeShape {
  readonly members: TypeMember[];
  /** Extended/intersected types that were not inlined, verbatim. */
  readonly bases: string[];
}

/** Collapses a multi-line type annotation into a single readable line. */
const normaliseTypeText = (text: string): string => text.replace(/\s+/g, " ").trim();

const readPropertySignature = (node: Node): TypeMember | null => {
  if (!Node.isPropertySignature(node)) {
    return null;
  }

  return {
    name: node.getName(),
    optional: node.hasQuestionToken(),
    type: normaliseTypeText(node.getTypeNode()?.getText() ?? "unknown"),
    doc: readDoc(node),
  };
};

const readTypeLiteral = (node: Node, shape: { members: TypeMember[]; bases: string[] }): void => {
  if (!Node.isTypeLiteral(node)) {
    shape.bases.push(normaliseTypeText(node.getText()));
    return;
  }

  for (const member of node.getMembers()) {
    const parsed = readPropertySignature(member);
    if (parsed) {
      shape.members.push(parsed);
    } else {
      // Index signatures, call signatures and methods are structural facts worth keeping.
      shape.bases.push(normaliseTypeText(member.getText()));
    }
  }
};

/** Reads the members and unresolved bases of an interface declaration. */
export const readInterfaceShape = (declaration: InterfaceDeclaration): TypeShape => {
  const members: TypeMember[] = [];

  for (const member of declaration.getMembers()) {
    const parsed = readPropertySignature(member);
    if (parsed) {
      members.push(parsed);
    }
  }

  return {
    members,
    bases: declaration.getExtends().map((clause) => normaliseTypeText(clause.getText())),
  };
};

/** Reads the members and unresolved bases of a type alias declaration. */
export const readTypeAliasShape = (declaration: TypeAliasDeclaration): TypeShape => {
  const shape: { members: TypeMember[]; bases: string[] } = { members: [], bases: [] };
  const typeNode = declaration.getTypeNode();

  if (!typeNode) {
    return shape;
  }

  if (Node.isIntersectionTypeNode(typeNode)) {
    for (const part of typeNode.getTypeNodes()) {
      readTypeLiteral(part, shape);
    }
    return shape;
  }

  readTypeLiteral(typeNode, shape);

  return shape;
};
