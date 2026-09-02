import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { SourceFile } from "ts-morph";

import { toKitRelativePath, type KitPaths } from "../paths.ts";
import {
  componentsArtifactSchema,
  type ComponentsArtifact,
  type ExternalReExportDto,
  type PublicSymbolDto,
  type UiKitComponentDto,
} from "../domain/components.ts";
import { validateArtifact } from "../domain/validate.ts";
import { ExtractionError } from "../shared/errors.ts";
import { listDirectories } from "../shared/fs.ts";
import { isPlainRecord } from "../shared/object.ts";

import { collectComponentAssets } from "./assets.ts";
import { readBarrel } from "./barrel.ts";
import { collectExternalDependencies, filterWrappedPackages } from "./dependencies.ts";
import { buildComponentDiagnostics } from "./diagnostics.ts";
import { collectModuleExports, type ExportWalkContext, type UnresolvedStar } from "./exports.ts";
import type { LocationFactory } from "./location.ts";
import { createComponentsProject } from "./project.ts";
import { findPropsTypes, findSlotSets } from "./props.ts";
import { findReactComponents } from "./react.ts";
import { findVariantSets } from "./variants.ts";
import { compareStrings } from "@smart-tools/fe-analyzer-engine";

/** Directories under `components/` that are not components. */
const NON_COMPONENT_DIRECTORIES = new Set<string>([]);

const readPackageVersion = async (packageJsonPath: string): Promise<string | null> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(packageJsonPath, "utf8"));
    if (isPlainRecord(parsed) && typeof parsed["version"] === "string") {
      return parsed["version"];
    }
  } catch {
    // Version is metadata; absence must not fail the extraction.
  }
  return null;
};

/** Groups loaded source files by the component directory they belong to. */
const groupFilesByComponent = (
  sourceFiles: readonly SourceFile[],
  componentsDir: string,
): Map<string, SourceFile[]> => {
  const grouped = new Map<string, SourceFile[]>();
  const prefix = `${componentsDir.split(/[\\/]/).join("/")}/`;

  for (const file of sourceFiles) {
    const normalised = file.getFilePath().split(/[\\/]/).join("/");
    if (!normalised.startsWith(prefix)) {
      continue;
    }

    const componentName = normalised.slice(prefix.length).split("/")[0] ?? "";
    if (
      componentName.length === 0 ||
      componentName.endsWith(".ts") ||
      componentName.endsWith(".tsx")
    ) {
      continue;
    }

    const bucket = grouped.get(componentName);
    if (bucket) {
      bucket.push(file);
    } else {
      grouped.set(componentName, [file]);
    }
  }

  return grouped;
};

const findEntryFile = (files: readonly SourceFile[], componentDir: string): SourceFile | null => {
  const normalisedDir = componentDir.split(/[\\/]/).join("/");

  return (
    files.find((file) => {
      const path = file.getFilePath().split(/[\\/]/).join("/");
      return path === `${normalisedDir}/index.ts` || path === `${normalisedDir}/index.tsx`;
    }) ?? null
  );
};

/** Aggregates unresolved star re-exports into one entry per package. */
const aggregateExternalReExports = (stars: readonly UnresolvedStar[]): ExternalReExportDto[] => {
  const byPackage = new Map<string, { star: boolean; from: Set<string> }>();

  for (const entry of stars) {
    const existing = byPackage.get(entry.packageName);
    if (existing) {
      existing.star = true;
      existing.from.add(entry.from);
    } else {
      byPackage.set(entry.packageName, { star: true, from: new Set([entry.from]) });
    }
  }

  return [...byPackage]
    .map(([packageName, value]) => ({
      package: packageName,
      star: value.star,
      names: [],
      resolved: false,
      reExportedFrom: [...value.from].sort(compareStrings),
    }))
    .sort((a, b) => compareStrings(a.package, b.package));
};

/**
 * Extracts the UI kit's component specification.
 *
 * The pass is single-threaded and syntactic: one ts-morph load of `packages/base/src`,
 * then per-directory sweeps. Nothing depends on the kit's `node_modules`, so the result
 * is reproducible on a clean checkout.
 */
export const extractComponents = async (paths: KitPaths): Promise<ComponentsArtifact> => {
  const { sourceFiles, apiFiles } = createComponentsProject(paths);

  const locate: LocationFactory = (absolutePath) => toKitRelativePath(paths, absolutePath);
  const filesByPath = new Map(sourceFiles.map((file) => [file.getFilePath() as string, file]));

  // Component detection runs per file so each file's own declarations can be attributed
  // to it; the flat list is only used for the summary count.
  const componentsByFile = new Map<string, Set<string>>(
    apiFiles.map((file) => [
      file.getFilePath(),
      new Set(findReactComponents([file], locate).map((component) => component.name)),
    ]),
  );
  const reactComponentCount = [...componentsByFile.values()].reduce(
    (sum, names) => sum + names.size,
    0,
  );

  const walkContext: ExportWalkContext = { paths, locate, componentsByFile, filesByPath };

  const barrelFile = filesByPath.get(paths.componentsBarrel);
  if (!barrelFile) {
    throw new ExtractionError(`Component barrel not loaded: ${paths.componentsBarrel}`);
  }

  const barrel = readBarrel(barrelFile, paths, locate);
  const barrelExports = collectModuleExports(barrelFile, walkContext);

  const packageBarrelFile = filesByPath.get(paths.baseBarrel);
  const packageExports = packageBarrelFile
    ? collectModuleExports(packageBarrelFile, walkContext)
    : { symbols: [], unresolvedStars: [] };

  const publicDirectories = new Set(
    barrel
      .filter((entry) => entry.origin === "local" && entry.specifier.startsWith("./"))
      .map((entry) => entry.specifier.slice(2).split("/")[0] ?? ""),
  );

  const filesByComponent = groupFilesByComponent(apiFiles, paths.componentsDir);
  const directories = (await listDirectories(paths.componentsDir)).filter(
    (name) => !NON_COMPONENT_DIRECTORIES.has(name),
  );

  const components: UiKitComponentDto[] = [];

  for (const name of directories) {
    const componentDir = join(paths.componentsDir, name);
    const files = filesByComponent.get(name) ?? [];
    const entryFile = findEntryFile(files, componentDir);

    const moduleExports = entryFile
      ? collectModuleExports(entryFile, walkContext)
      : { symbols: [], unresolvedStars: [] };

    const externalDependencies = collectExternalDependencies(files);
    const reactComponents = findReactComponents(files, locate);

    components.push({
      name,
      directory: toKitRelativePath(paths, componentDir),
      entryFile: entryFile ? locate(entryFile.getFilePath()) : null,
      public: publicDirectories.has(name),
      deprecated:
        moduleExports.symbols.length > 0 &&
        moduleExports.symbols.every((symbol) => symbol.doc.deprecated),
      exports: moduleExports.symbols,
      components: reactComponents,
      props: findPropsTypes(files, locate),
      variants: findVariantSets(files, locate),
      slots: findSlotSets(files, locate),
      assets: await collectComponentAssets(componentDir),
      externalDependencies,
      wraps: filterWrappedPackages(externalDependencies),
    });
  }

  const componentByFile = new Map<string, string>();
  for (const component of components) {
    for (const file of filesByComponent.get(component.name) ?? []) {
      componentByFile.set(locate(file.getFilePath()), component.name);
    }
  }

  const publicSymbolsByName = new Map<string, PublicSymbolDto>();
  for (const symbol of [...barrelExports.symbols, ...packageExports.symbols]) {
    if (publicSymbolsByName.has(symbol.name)) {
      continue;
    }
    publicSymbolsByName.set(symbol.name, {
      name: symbol.name,
      kind: symbol.kind,
      origin: symbol.origin,
      component: symbol.location ? (componentByFile.get(symbol.location.file) ?? null) : null,
      from: symbol.from,
      deprecated: symbol.doc.deprecated,
      deprecationNote: symbol.doc.deprecationNote,
    });
  }
  const publicSymbols: PublicSymbolDto[] = [...publicSymbolsByName.values()].sort((left, right) =>
    compareStrings(left.name, right.name),
  );

  const externalReExports = aggregateExternalReExports([
    ...barrelExports.unresolvedStars,
    ...packageExports.unresolvedStars,
  ]);

  const artifact: ComponentsArtifact = {
    $schema: "ds-analyzer/components@1",
    meta: {
      sourceRoot: toKitRelativePath(paths, paths.baseSrcDir),
      basePackageVersion: await readPackageVersion(
        join(paths.uiKitRoot, "packages", "base", "package.json"),
      ),
      barrels: [locate(paths.componentsBarrel), locate(paths.baseBarrel)],
      typeCheckerAvailable: false,
      counts: {
        componentDirectories: components.length,
        publicComponentDirectories: components.filter((component) => component.public).length,
        reactComponents: reactComponentCount,
        propsTypes: components.reduce((sum, component) => sum + component.props.length, 0),
        props: components.reduce(
          (sum, component) =>
            sum + component.props.reduce((inner, type) => inner + type.members.length, 0),
          0,
        ),
        variantSets: components.reduce((sum, component) => sum + component.variants.length, 0),
        slotSets: components.reduce((sum, component) => sum + component.slots.length, 0),
        slots: components.reduce(
          (sum, component) =>
            sum + component.slots.reduce((inner, set) => inner + set.slots.length, 0),
          0,
        ),
        publicSymbols: publicSymbols.length,
        externalReExports: externalReExports.length,
        deprecatedSymbols: publicSymbols.filter((symbol) => symbol.deprecated).length,
      },
    },
    barrel,
    components,
    externalReExports,
    publicSymbols,
    diagnostics: buildComponentDiagnostics({
      components,
      publicSymbols,
      externalReExports,
      barrel,
    }),
  };

  return validateArtifact(componentsArtifactSchema, artifact, "components artifact");
};
