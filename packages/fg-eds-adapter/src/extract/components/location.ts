import type { Node } from "ts-morph";

import type { SourceLocationDto } from "../domain/components.ts";

/** Maps an absolute file path to the kit-relative path stored in artifacts. */
export type LocationFactory = (absolutePath: string) => string;

/** Builds the artifact location record for an AST node. */
export const toLocation = (locate: LocationFactory, node: Node): SourceLocationDto => ({
  file: locate(node.getSourceFile().getFilePath()),
  line: node.getStartLineNumber(),
});
