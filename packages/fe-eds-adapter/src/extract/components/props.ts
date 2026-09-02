import { Node, type SourceFile } from "ts-morph";

import type { PropsTypeDto, SlotSetDto } from "../domain/components.ts";

import { readDoc } from "./jsdoc.ts";
import { toLocation, type LocationFactory } from "./location.ts";
import { readInterfaceShape, readTypeAliasShape, type TypeShape } from "./type-members.ts";
import { compareStrings } from "@smart-tools/fe-analyzer-engine";

/**
 * Props and style-slot extraction.
 *
 * Both are found by naming convention, which the kit follows without exception:
 * `<Component>Props` for the prop contract and `<Component>Classes` for the slot map.
 * A convention-based sweep is the only option without a type checker, and it is the
 * same convention consumers rely on, so a component that broke it would be broken for
 * consumers too.
 */

const PROPS_TYPE_SUFFIX = "Props";
const CLASSES_TYPE_SUFFIX = "Classes";

type NamedTypeDeclaration =
  | { readonly kind: "interface"; readonly node: ReturnType<SourceFile["getInterfaces"]>[number] }
  | { readonly kind: "alias"; readonly node: ReturnType<SourceFile["getTypeAliases"]>[number] };

const namedTypeDeclarations = (file: SourceFile): NamedTypeDeclaration[] => [
  ...file.getInterfaces().map((node) => ({ kind: "interface" as const, node })),
  ...file.getTypeAliases().map((node) => ({ kind: "alias" as const, node })),
];

const shapeOf = (declaration: NamedTypeDeclaration): TypeShape =>
  declaration.kind === "interface"
    ? readInterfaceShape(declaration.node)
    : readTypeAliasShape(declaration.node);

const isExported = (node: Node): boolean =>
  Node.isExportable(node) ? node.isExported() || node.isDefaultExport() : false;

/** Collects every `*Props` type declared in `files`. */
export const findPropsTypes = (
  files: readonly SourceFile[],
  locate: LocationFactory,
): PropsTypeDto[] => {
  const results: PropsTypeDto[] = [];

  for (const file of files) {
    for (const declaration of namedTypeDeclarations(file)) {
      const name = declaration.node.getName();
      if (!name.endsWith(PROPS_TYPE_SUFFIX) || !isExported(declaration.node)) {
        continue;
      }

      const shape = shapeOf(declaration);

      results.push({
        name,
        location: toLocation(locate, declaration.node),
        extends: shape.bases,
        members: shape.members.map((member) => ({
          name: member.name,
          optional: member.optional,
          type: member.type,
          doc: member.doc,
        })),
        doc: readDoc(declaration.node),
      });
    }
  }

  return results.sort((a, b) => compareStrings(a.name, b.name));
};

/** Collects every `*Classes` type declared in `files` — the overridable style slots. */
export const findSlotSets = (
  files: readonly SourceFile[],
  locate: LocationFactory,
): SlotSetDto[] => {
  const results: SlotSetDto[] = [];

  for (const file of files) {
    for (const declaration of namedTypeDeclarations(file)) {
      const name = declaration.node.getName();
      if (!name.endsWith(CLASSES_TYPE_SUFFIX) || !isExported(declaration.node)) {
        continue;
      }

      const shape = shapeOf(declaration);

      results.push({
        name,
        location: toLocation(locate, declaration.node),
        slots: shape.members.map((member) => ({ name: member.name, doc: member.doc })),
        unresolvedBases: shape.bases,
      });
    }
  }

  return results.sort((a, b) => compareStrings(a.name, b.name));
};
