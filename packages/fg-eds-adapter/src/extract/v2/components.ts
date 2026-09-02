/**
 * `components.json` for EDS 2.x — the v1 extractor, run twice, merged.
 *
 * The v1 pass (`extract/components/extract.ts`) never named EDS 1.x: it takes a component
 * directory, two barrels and a package root, and reports what it finds. EDS 2.x is that same
 * shape TWICE — `packages/base` (headless parts) and `packages/kit` (assembled components,
 * S1 §2a) — so this file resolves a `KitPaths` per package, runs the pass on each and merges.
 * Re-implementing the sweep would have meant a second definition of what a public symbol, a
 * prop type or a slot is, and the two would have drifted the first time either changed.
 *
 * THREE THINGS ARE THEN OVERRIDDEN, each for a break S1 measured:
 *  - VARIANTS come from `recipe({ variants })`, not from the inverted `as const` objects
 *    (break V6) — see `recipe-variants.ts`;
 *  - `meta.exports` carries each package's declared subpaths (break V2), so `import.internal`
 *    can tell `@sds-eng/base-exp/Button` from `@sds-eng/base-exp/dist/…`;
 *  - `meta.styleLayers` carries the 30 `@layer` names (break V12), which is the only stable
 *    part of a v2 class name.
 *
 * WHEN A NAME EXISTS IN BOTH PACKAGES the `kit-exp` entry wins (S1 §6): it is the assembled
 * component the kit's own Quick Start tells consumers to import, and the `base-exp` one is
 * usually the same symbol re-exported. The loser is not dropped — it stays reachable under its
 * own `package`, so the merge never loses a fact.
 */
import { readFile } from "node:fs/promises";

import { compareStrings } from "@smart-tools/fg-analyzer-engine";
import { Project, ScriptTarget, type SourceFile } from "ts-morph";

import { extractComponents } from "../components/extract.ts";
import {
  componentsArtifactSchema,
  type ComponentsArtifact,
  type UiKitComponentDto,
} from "../domain/components.ts";
import { validateArtifact } from "../domain/validate.ts";
import type { KitPaths } from "../paths.ts";
import { isPlainRecord } from "../shared/object.ts";

import { toKitRelativePathV2, type KitPathsV2 } from "./paths.ts";
import { findRecipeVariantSets } from "./recipe-variants.ts";

/** The two packages that together are EDS 2.x, in merge order (later wins on a name clash). */
export const V2_PACKAGES = [
  { name: "@sds-eng/base-exp", dir: "base" },
  { name: "@sds-eng/kit-exp", dir: "kit" },
] as const;

/**
 * A v1 `KitPaths` pointed at one v2 package.
 *
 * `themeSrcDir`/`themePackageJson`/`upstreamDir` are filled with values the component pass never
 * reads (it uses `baseSrcDir`, the two barrels, `componentsDir` and `uiKitRoot`); they are
 * present because the type requires them, and pointing them at the v2 theme rather than at a
 * fabricated path keeps the object honest if a future reader looks.
 */
const asKitPaths = (paths: KitPathsV2, which: "base" | "kit"): KitPaths => {
  const src = which === "base" ? paths.baseSrcDir : paths.kitSrcDir;
  const components = which === "base" ? paths.baseComponentsDir : paths.kitComponentsDir;

  return {
    uiKitRoot: paths.uiKitRoot,
    themeSrcDir: paths.themeDir,
    themePackageJson: paths.basePackageJson,
    baseSrcDir: src,
    componentsDir: components,
    componentsBarrel: which === "base" ? paths.baseComponentsBarrel : paths.kitComponentsBarrel,
    baseBarrel: which === "base" ? paths.baseBarrel : paths.kitBarrel,
    upstreamDir: null,
  };
};

/** The `exports` keys a package manifest declares, without the leading `./`. */
const declaredExports = async (manifestPath: string): Promise<string[]> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    const exported = isPlainRecord(parsed) ? parsed["exports"] : undefined;
    if (!isPlainRecord(exported)) return [];
    return Object.keys(exported)
      .map((key) => key.replace(/^\.\/?/, ""))
      .filter((key) => key.length > 0)
      .toSorted(compareStrings);
  } catch {
    return [];
  }
};

/** The `layers` object's own keys — `base`, `button`, `text-field`, … */
const readStyleLayers = (layersFile: string): string[] => {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { target: ScriptTarget.ES2022, noResolve: true },
  });

  let file: SourceFile;
  try {
    file = project.addSourceFileAtPath(layersFile);
  } catch {
    return [];
  }

  const declaration = file.getVariableDeclaration("layers");
  const literal = declaration?.getInitializer();
  if (literal === undefined) return [];

  const names = literal
    .getText()
    .split("\n")
    .map((line) => /^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/.exec(line))
    .map((match) => match?.[1] ?? match?.[2] ?? match?.[3])
    .filter((name): name is string => name !== undefined);

  return [...new Set(names)].toSorted(compareStrings);
};

/** A ts-morph project over one component directory, for the recipe sweep. */
const recipeFilesOf = (componentDir: string): readonly SourceFile[] => {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { target: ScriptTarget.ES2022, noResolve: true },
  });
  project.addSourceFilesAtPaths(`${componentDir.split(/[\\/]/).join("/")}/**/*.css.ts`);
  return project.getSourceFiles();
};

export const extractComponentsV2 = async (paths: KitPathsV2): Promise<ComponentsArtifact> => {
  const parts = await Promise.all(
    V2_PACKAGES.map(async (pkg) => ({
      pkg,
      artifact: await extractComponents(asKitPaths(paths, pkg.dir)),
    })),
  );

  // Grouped rather than overwritten: `kit-exp`'s `Button` is a five-line facade over
  // `base-exp/Button` (S1 §2a), so last-wins would keep the assembled component's identity and
  // throw away the three recipes that ARE its variant surface. The winner supplies the record;
  // every directory of that name supplies the variants and the slots.
  const byName = new Map<string, { pkg: string; component: UiKitComponentDto }[]>();
  for (const { pkg, artifact } of parts) {
    for (const component of artifact.components) {
      byName.set(component.name, [
        ...(byName.get(component.name) ?? []),
        { pkg: pkg.name, component },
      ]);
    }
  }

  const locate = (absolutePath: string): string => toKitRelativePathV2(paths, absolutePath);

  const components = [...byName.entries()]
    .toSorted(([left], [right]) => compareStrings(left, right))
    .map(([, entries]) => {
      const winner = entries[entries.length - 1];
      if (winner === undefined) throw new Error("unreachable: empty component group");

      const variants = new Map<string, UiKitComponentDto["variants"][number]>();
      for (const entry of entries) {
        for (const set of findRecipeVariantSets(
          recipeFilesOf(`${paths.uiKitRoot}/${entry.component.directory}`),
          locate,
        )) {
          const existing = variants.get(set.name);
          variants.set(
            set.name,
            existing === undefined
              ? set
              : { ...existing, keys: [...new Set([...existing.keys, ...set.keys])].toSorted() },
          );
        }
      }

      // Slots and PROP TYPES are unioned for the same reason as variants: `kit-exp/Button` is a
      // re-export with no props type of its own, and the prop-overlap heuristic that finds a
      // local clone of a kit component is only as good as the prop list it is given.
      const slots = new Map(
        entries.flatMap((entry) => entry.component.slots.map((set) => [set.name, set] as const)),
      );
      const props = new Map(
        entries.flatMap((entry) => entry.component.props.map((type) => [type.name, type] as const)),
      );
      const reactComponents = new Map(
        entries.flatMap((entry) =>
          entry.component.components.map((declared) => [declared.name, declared] as const),
        ),
      );

      return Object.assign({}, winner.component, {
        package: winner.pkg,
        variants: [...variants.values()].toSorted((left, right) =>
          compareStrings(left.name, right.name),
        ),
        slots: [...slots.values()],
        props: [...props.values()],
        components: [...reactComponents.values()],
      }) satisfies UiKitComponentDto;
    });

  const symbolsByName = new Map<string, ComponentsArtifact["publicSymbols"][number]>();
  for (const { pkg, artifact } of parts) {
    for (const symbol of artifact.publicSymbols) {
      symbolsByName.set(symbol.name, { ...symbol, package: pkg.name });
    }
  }
  const publicSymbols = [...symbolsByName.values()].toSorted((left, right) =>
    compareStrings(left.name, right.name),
  );

  const exportsByPackage: Record<string, string[]> = {};
  for (const pkg of V2_PACKAGES) {
    exportsByPackage[pkg.name] = await declaredExports(
      pkg.dir === "base" ? paths.basePackageJson : paths.kitPackageJson,
    );
  }

  const [base] = parts;
  if (base === undefined) throw new Error("extractComponentsV2 requires at least one package");

  const artifact: ComponentsArtifact = {
    $schema: "ds-analyzer/components@1",
    meta: {
      sourceRoot: "packages",
      basePackageVersion: base.artifact.meta.basePackageVersion,
      barrels: parts.flatMap(({ artifact: part }) => part.meta.barrels).toSorted(compareStrings),
      typeCheckerAvailable: false,
      exports: exportsByPackage,
      styleLayers: readStyleLayers(paths.layersFile),
      counts: {
        componentDirectories: components.length,
        publicComponentDirectories: components.filter((component) => component.public).length,
        reactComponents: parts.reduce(
          (sum, part) => sum + part.artifact.meta.counts.reactComponents,
          0,
        ),
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
        externalReExports: 0,
        deprecatedSymbols: publicSymbols.filter((symbol) => symbol.deprecated).length,
      },
    },
    barrel: parts.flatMap(({ artifact: part }) => part.barrel),
    components,
    externalReExports: [],
    publicSymbols,
    diagnostics: parts.flatMap(({ artifact: part }) => part.diagnostics),
  };

  return validateArtifact(componentsArtifactSchema, artifact, "components artifact (v2)");
};
