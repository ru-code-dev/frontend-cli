import type { SourceFile } from "ts-morph";

import type { KitPaths } from "../paths.ts";
import type { BarrelEntryDto } from "../domain/components.ts";

import { toLocation, type LocationFactory } from "./location.ts";
import { nodeFileProbe, resolveSpecifier, type FileProbe } from "./resolve.ts";

/**
 * Flat, verbatim reading of a barrel file's `export … from '…'` statements.
 *
 * Unlike {@link collectModuleExports}, this does not follow edges. It answers a
 * different question: *what did the kit authors write in the public entry point* —
 * which local directories are exported, which `@v-uik` packages are passed through,
 * and which symbols are explicitly renamed or type-only.
 *
 * The list is what a reviewer reads to understand the kit's API policy; the flattened
 * symbol set is what a machine matches against.
 */
export const readBarrel = (
  file: SourceFile,
  paths: KitPaths,
  locate: LocationFactory,
  probe: FileProbe = nodeFileProbe,
): BarrelEntryDto[] => {
  const entries: BarrelEntryDto[] = [];

  for (const declaration of file.getExportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (specifier === undefined) {
      // `export { X }` with no `from` re-exports a local binding; covered by the symbol walk.
      continue;
    }

    const resolved = resolveSpecifier(paths, file.getFilePath(), specifier, probe);
    const namedExports = declaration.getNamedExports();

    entries.push({
      specifier,
      resolvedFile: resolved.file === null ? null : locate(resolved.file),
      origin: resolved.kind === "external" ? "external" : "local",
      star: namedExports.length === 0,
      names: namedExports.map((named) => named.getAliasNode()?.getText() ?? named.getName()),
      typeOnly: declaration.isTypeOnly(),
      location: toLocation(locate, declaration),
    });
  }

  return entries;
};
