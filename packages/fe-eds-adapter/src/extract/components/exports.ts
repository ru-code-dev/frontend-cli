import { Node, type ExportDeclaration, type SourceFile } from "ts-morph";

import type { KitPaths } from "../paths.ts";
import type { ExportedSymbolDto, ExportKind } from "../domain/components.ts";

import { readDoc } from "./jsdoc.ts";
import { toLocation, type LocationFactory } from "./location.ts";
import { nodeFileProbe, resolveSpecifier, type FileProbe } from "./resolve.ts";
import { compareStrings } from "@smart-tools/fe-analyzer-engine";

/**
 * Public-surface resolution for a module.
 *
 * `packages/base/src/components/index.ts` is a barrel of barrels: it star-re-exports 40
 * local directories and 15 `@v-uik` packages, and each local directory's `index.ts`
 * re-exports further. Answering "is `Chip` public?" therefore requires walking the
 * whole graph rather than reading one file.
 *
 * The walk is done here rather than through ts-morph's `getExportedDeclarations()`
 * because that API needs a resolved programme, which is unavailable without the kit's
 * `node_modules`. The trade-off is explicit: star re-exports from `@v-uik` cannot be
 * expanded into names and are surfaced as unresolved edges instead of being dropped.
 */

export interface UnresolvedStar {
  readonly specifier: string;
  readonly packageName: string;
  /** Kit-relative path of the file that re-exports it. */
  readonly from: string;
}

export interface ModuleExports {
  readonly symbols: ExportedSymbolDto[];
  readonly unresolvedStars: UnresolvedStar[];
}

export interface ExportWalkContext {
  readonly paths: KitPaths;
  readonly locate: LocationFactory;
  /** Absolute file path → names of React components declared in it. */
  readonly componentsByFile: ReadonlyMap<string, ReadonlySet<string>>;
  /** Absolute file path → source file, for local re-export traversal. */
  readonly filesByPath: ReadonlyMap<string, SourceFile>;
  /** File-existence probe backing module resolution; defaults to the real filesystem. */
  readonly probe?: FileProbe;
}

/** Guards against pathological or cyclic barrel graphs. */
const MAX_DEPTH = 8;

const kindOfLocalDeclaration = (
  node: Node,
  componentNames: ReadonlySet<string>,
  name: string,
): ExportKind => {
  if (Node.isInterfaceDeclaration(node) || Node.isTypeAliasDeclaration(node)) {
    return "type";
  }
  return componentNames.has(name) ? "component" : "value";
};

/**
 * Locally declared `export …` statements, excluding re-exports.
 *
 * Read purely syntactically: ts-morph's `getExportedDeclarations()` needs a resolved
 * programme, which is unavailable here, so the `export` modifier on each declaration is
 * inspected directly.
 */
const collectLocalDeclarations = (
  file: SourceFile,
  context: ExportWalkContext,
): ExportedSymbolDto[] => {
  const componentNames = context.componentsByFile.get(file.getFilePath()) ?? new Set<string>();
  const symbols: ExportedSymbolDto[] = [];

  const add = (name: string, node: Node): void => {
    symbols.push({
      name,
      localName: null,
      kind: kindOfLocalDeclaration(node, componentNames, name),
      origin: "local",
      from: null,
      location: toLocation(context.locate, node),
      doc: readDoc(node),
    });
  };

  for (const statement of file.getVariableStatements()) {
    if (!statement.isExported()) {
      continue;
    }
    for (const declaration of statement.getDeclarations()) {
      add(declaration.getName(), declaration);
    }
  }

  for (const declaration of file.getFunctions()) {
    const name = declaration.getName();
    if (name !== undefined && declaration.isExported()) {
      add(name, declaration);
    }
  }

  for (const declaration of file.getClasses()) {
    const name = declaration.getName();
    if (name !== undefined && declaration.isExported()) {
      add(name, declaration);
    }
  }

  for (const declaration of [...file.getInterfaces(), ...file.getTypeAliases()]) {
    if (declaration.isExported()) {
      add(declaration.getName(), declaration);
    }
  }

  for (const declaration of file.getEnums()) {
    if (declaration.isExported()) {
      add(declaration.getName(), declaration);
    }
  }

  return symbols;
};

const collectNamedReExports = (
  declaration: ExportDeclaration,
  context: ExportWalkContext,
  file: SourceFile,
): ExportedSymbolDto[] => {
  const specifier = declaration.getModuleSpecifierValue() ?? null;
  const typeOnly = declaration.isTypeOnly();

  return declaration.getNamedExports().map((namedExport) => {
    const exportedName = namedExport.getAliasNode()?.getText() ?? namedExport.getName();
    const localName = namedExport.getAliasNode() ? namedExport.getName() : null;
    const isTypeOnly = typeOnly || namedExport.isTypeOnly();

    const resolved =
      specifier === null
        ? null
        : resolveSpecifier(
            context.paths,
            file.getFilePath(),
            specifier,
            context.probe ?? nodeFileProbe,
          );

    // A re-export of a local binding, or of a module that resolved locally, is a real
    // runtime value; one pointing at an uninstalled package cannot be classified further.
    let kind: ExportKind = "unresolved";
    if (isTypeOnly) {
      kind = "type";
    } else if (resolved === null) {
      kind = "value";
    } else if (resolved.file !== null) {
      kind = "value";
    }

    return {
      name: exportedName,
      localName,
      kind,
      origin: resolved?.kind === "external" ? ("external" as const) : ("local" as const),
      from: specifier,
      location: toLocation(context.locate, namedExport),
      doc: readDoc(namedExport),
    };
  });
};

const mergeSymbols = (
  into: Map<string, ExportedSymbolDto>,
  symbols: readonly ExportedSymbolDto[],
): void => {
  for (const symbol of symbols) {
    // A later declaration shadows an earlier star re-export, matching TypeScript semantics.
    into.set(symbol.name, symbol);
  }
};

/**
 * Walks a module's exports, following local star and named re-exports transitively.
 *
 * @returns the flattened symbol set plus every external star re-export encountered,
 *          which cannot be expanded into names.
 */
export const collectModuleExports = (
  file: SourceFile,
  context: ExportWalkContext,
  depth = 0,
  visited: Set<string> = new Set(),
): ModuleExports => {
  const filePath = file.getFilePath();

  if (depth > MAX_DEPTH || visited.has(filePath)) {
    return { symbols: [], unresolvedStars: [] };
  }
  visited.add(filePath);

  const byName = new Map<string, ExportedSymbolDto>();
  const unresolvedStars: UnresolvedStar[] = [];

  // Star re-exports first, so locally declared names win on collision.
  for (const declaration of file.getExportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (specifier === undefined || declaration.getNamedExports().length > 0) {
      continue;
    }

    const resolved = resolveSpecifier(
      context.paths,
      filePath,
      specifier,
      context.probe ?? nodeFileProbe,
    );

    if (resolved.file === null) {
      // Cannot be expanded into names — recorded as an edge in `externalReExports`
      // rather than fabricated as symbols.
      unresolvedStars.push({
        specifier,
        packageName: resolved.packageName ?? specifier,
        from: context.locate(filePath),
      });
      continue;
    }

    const target = context.filesByPath.get(resolved.file);
    if (!target) {
      unresolvedStars.push({ specifier, packageName: specifier, from: context.locate(filePath) });
      continue;
    }

    const nested = collectModuleExports(target, context, depth + 1, visited);
    mergeSymbols(byName, nested.symbols);
    unresolvedStars.push(...nested.unresolvedStars);
  }

  for (const declaration of file.getExportDeclarations()) {
    if (declaration.getNamedExports().length > 0) {
      mergeSymbols(byName, collectNamedReExports(declaration, context, file));
    }
  }

  mergeSymbols(byName, collectLocalDeclarations(file, context));

  return {
    symbols: [...byName.values()].sort((a, b) => compareStrings(a.name, b.name)),
    unresolvedStars,
  };
};
