import { Node, type SourceFile } from "ts-morph";

import { discoverKit, type DiscoveredPackage } from "./discover.ts";
import { collectExternalBases, flattenProps, isExternalDeclaration, propsTypeOf } from "./props.ts";
import { createKitProject } from "./project.ts";
import {
  analyzePolymorphic,
  analyzeRoot,
  type RootAnalysis,
  resolveImplementation,
  returnsJsx,
  snapshotRoot,
  unwrap,
} from "./renders.ts";
import { declaredTypeText, toRelative } from "./type-text.ts";
import {
  type ComponentEntry,
  type ExtractOptions,
  type KitExtract,
  type KitPackageEntry,
  type RendersInfo,
  SCHEMA_VERSION,
  type TypeEntry,
  type TypeKind,
  type UnresolvedEntry,
} from "./types.ts";

/** Identity key for a declaration node, stable within one run. */
function nodeKey(node: Node): string {
  return `${node.getSourceFile().getFilePath()}:${node.getPos()}`;
}

const TYPE_KINDS: ReadonlyArray<[(node: Node) => boolean, TypeKind]> = [
  [(node) => Node.isInterfaceDeclaration(node), "interface"],
  [(node) => Node.isTypeAliasDeclaration(node), "type-alias"],
  [(node) => Node.isEnumDeclaration(node), "enum"],
];

function typeKindOf(node: Node): TypeKind | null {
  for (const [predicate, kind] of TYPE_KINDS) if (predicate(node)) return kind;
  return null;
}

/**
 * `getExportedDeclarations()` hands back both the real declaration and the `export { X }`
 * specifier that re-exported it. Prefer whatever actually declares something.
 */
function primaryDeclaration(declarations: readonly Node[]): Node | undefined {
  const declaring = declarations.find(
    (node) =>
      Node.isFunctionDeclaration(node) ||
      Node.isVariableDeclaration(node) ||
      Node.isClassDeclaration(node) ||
      Node.isInterfaceDeclaration(node) ||
      Node.isTypeAliasDeclaration(node) ||
      Node.isEnumDeclaration(node),
  );
  return declaring ?? declarations[0];
}

/**
 * Component-hood is decided by the checker and by the code, never by a name.
 *
 * Primary test: the export is callable AND the implementation reachable from it returns JSX.
 * That is what catches `zzqFabricate("star")` — an arbitrary factory whose product is only a
 * component because of what the factory returns. Fallback test: the call signature's return
 * type names a React element type, which covers a component whose implementation lives behind
 * a `.d.ts` the kit did not author.
 */
const REACT_ELEMENT_RETURN = /\b(?:JSX\.Element|ReactElement|ReactNode|ReactPortal|Element)\b/u;

function isComponent(declaration: Node): boolean {
  const signatures = declaration.getType().getCallSignatures();
  if (signatures.length === 0) return false;
  if (returnsJsx(declaration)) return true;
  const returnText = signatures[0]!.getReturnType().getText(declaration);
  return REACT_ELEMENT_RETURN.test(returnText);
}

interface PendingComponent {
  entry: ComponentEntry;
  declaration: Node;
  analysis: RootAnalysis;
}

interface Builder {
  kitRoot: string;
  components: Map<string, PendingComponent>;
  /** declaration node key -> component key, for delegation and subcomponent lookups. */
  byDeclaration: Map<string, string>;
  types: Map<string, TypeEntry>;
  unresolved: UnresolvedEntry[];
}

function buildComponent(
  builder: Builder,
  key: string,
  declaration: Node,
  packageName: string,
  qualified: string,
): PendingComponent {
  const { kitRoot } = builder;
  const propsType = propsTypeOf(declaration, declaration.getType());
  const flattened =
    propsType === null
      ? { props: [], externalCount: 0, undeclared: [] as string[] }
      : flattenProps(propsType, declaration, kitRoot);
  const bases = propsType === null ? [] : collectExternalBases(propsType, kitRoot);

  const primaryBase = bases.find((base) => base.element !== null);
  const extendsHtml = primaryBase?.element ?? null;
  const extendsExternal = bases
    .filter((base) => base !== primaryBase)
    .map((base) => base.text)
    .sort();

  if (propsType === null) {
    builder.unresolved.push({
      export: qualified,
      reason: "props: no call signature parameter to read",
    });
  }
  for (const undeclaredProp of flattened.undeclared) {
    builder.unresolved.push({
      export: qualified,
      reason: `props: "${undeclaredProp}" has no declaration the checker could point at`,
    });
  }
  if (flattened.externalCount > 0 && bases.length === 0) {
    builder.unresolved.push({
      export: qualified,
      reason: `props: ${flattened.externalCount} externally-declared prop(s) collapsed with no identifiable base type`,
    });
  }

  const analysis = analyzeRoot(declaration);
  const entry: ComponentEntry = {
    name: key,
    package: packageName,
    source: toRelative(kitRoot, declaration.getSourceFile().getFilePath()),
    props: flattened.props,
    extendsHtml,
    extendsExternal,
    // Filled in by the delegation pass.
    renders: { element: null, confidence: "unknown", via: [], reason: analysis.reason },
    polymorphic: analyzePolymorphic(
      analysis,
      flattened.props.map((prop) => prop.name),
    ),
    subcomponents: [],
    parent: null,
    alsoExportedAs: null,
    snapshot: {
      root: snapshotRoot(analysis),
      props: flattened.props
        .map((prop) => `${prop.name}${prop.required ? "" : "?"}: ${prop.type}`)
        .sort(),
    },
  };
  return { entry, declaration, analysis };
}

/** Resolve `renders` after every component is known, so delegation can be followed. */
function resolveRenders(builder: Builder): void {
  const memo = new Map<string, RendersInfo>();

  const resolve = (key: string, seen: ReadonlySet<string>): RendersInfo => {
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    const pending = builder.components.get(key)!;
    const { analysis } = pending;
    let result: RendersInfo;

    if (analysis.kind === "intrinsic" && analysis.tag !== null) {
      result = { element: analysis.tag, confidence: "certain", via: [], reason: null };
    } else if (analysis.kind === "component") {
      const targetKey =
        analysis.target === undefined
          ? undefined
          : builder.byDeclaration.get(nodeKey(analysis.target));
      if (targetKey === undefined) {
        result = {
          element: null,
          confidence: "unknown",
          via: [],
          reason: "root-component-not-in-kit",
        };
      } else if (seen.has(targetKey)) {
        result = {
          element: null,
          confidence: "unknown",
          via: [targetKey],
          reason: "cyclic-delegation",
        };
      } else {
        const inner = resolve(targetKey, new Set([...seen, key]));
        result =
          inner.element === null
            ? {
                element: null,
                confidence: "unknown",
                via: [targetKey, ...inner.via],
                reason: inner.reason,
              }
            : {
                element: inner.element,
                confidence: "delegated",
                via: [targetKey, ...inner.via],
                reason: null,
              };
      }
    } else {
      result = {
        element: null,
        confidence: "unknown",
        via: [],
        reason: analysis.reason ?? "unknown-root",
      };
    }

    memo.set(key, result);
    return result;
  };

  for (const key of [...builder.components.keys()].sort()) {
    const pending = builder.components.get(key)!;
    pending.entry.renders = resolve(key, new Set([key]));
    if (pending.entry.renders.element === null) {
      builder.unresolved.push({
        export: `${pending.entry.package}#${key}`,
        reason: `renders: root element unknown (${pending.entry.renders.reason ?? "unknown-root"})`,
      });
    }
  }
}

/** `Component.Sub = X` in any spelling: direct assignment, or a call that merges an object in. */
function scanSubcomponents(builder: Builder, files: readonly SourceFile[]): void {
  interface Found {
    parentKey: string;
    subName: string;
    target: Node;
  }
  const found: Found[] = [];

  const resolveTargetDeclaration = (node: Node | undefined): Node | undefined => {
    const value = unwrap(node);
    if (value === undefined) return undefined;
    if (Node.isIdentifier(value) || Node.isPropertyAccessExpression(value)) {
      const symbol = value.getSymbol();
      const target = symbol?.getAliasedSymbol() ?? symbol;
      return target?.getDeclarations()[0];
    }
    return value;
  };

  const parentKeyOf = (node: Node | undefined): string | undefined => {
    const declaration = resolveTargetDeclaration(node);
    return declaration === undefined ? undefined : builder.byDeclaration.get(nodeKey(declaration));
  };

  for (const file of files) {
    file.forEachDescendant((node) => {
      if (Node.isBinaryExpression(node) && node.getOperatorToken().getText() === "=") {
        const left = node.getLeft();
        if (!Node.isPropertyAccessExpression(left)) return;
        const parentKey = parentKeyOf(left.getExpression());
        if (parentKey === undefined) return;
        const target = resolveTargetDeclaration(node.getRight());
        if (target === undefined) return;
        found.push({ parentKey, subName: left.getName(), target });
        return;
      }

      if (Node.isCallExpression(node)) {
        const args = node.getArguments();
        if (args.length < 2) return;
        const parentKey = parentKeyOf(args[0]);
        if (parentKey === undefined) return;
        const literal = unwrap(args[1]);
        if (literal === undefined || !Node.isObjectLiteralExpression(literal)) return;

        const pairs: Array<{ subName: string; target: Node }> = [];
        for (const property of literal.getProperties()) {
          if (Node.isPropertyAssignment(property)) {
            const target = resolveTargetDeclaration(property.getInitializer());
            if (target === undefined) return;
            pairs.push({ subName: property.getName(), target });
            continue;
          }
          if (Node.isShorthandPropertyAssignment(property)) {
            const target = resolveTargetDeclaration(property.getNameNode());
            if (target === undefined) return;
            pairs.push({ subName: property.getName(), target });
            continue;
          }
          return;
        }
        // Only a merge whose every value is itself a component counts as subcomponent
        // assignment; anything else is some other call that happens to take an object.
        if (pairs.length === 0 || !pairs.every((pair) => isComponent(pair.target))) return;
        for (const pair of pairs) found.push({ parentKey, ...pair });
      }
    });
  }

  found.sort((a, b) =>
    a.parentKey === b.parentKey
      ? a.subName < b.subName
        ? -1
        : a.subName > b.subName
          ? 1
          : 0
      : a.parentKey < b.parentKey
        ? -1
        : 1,
  );

  for (const { parentKey, subName, target } of found) {
    const parent = builder.components.get(parentKey);
    if (parent === undefined) continue;
    const key = `${parentKey}.${subName}`;
    if (builder.components.has(key)) continue;

    const standalone = builder.byDeclaration.get(nodeKey(target)) ?? null;
    const pending = buildComponent(
      builder,
      key,
      target,
      parent.entry.package,
      `${parent.entry.package}#${key}`,
    );
    pending.entry.parent = parentKey;
    pending.entry.alsoExportedAs = standalone;
    builder.components.set(key, pending);
    if (!parent.entry.subcomponents.includes(subName)) parent.entry.subcomponents.push(subName);
  }

  for (const pending of builder.components.values()) pending.entry.subcomponents.sort();
}

function packageOf(
  packages: readonly DiscoveredPackage[],
  filePath: string,
  fallback: string,
): string {
  for (const pkg of packages) {
    if (filePath.startsWith(`${pkg.dir}/`)) return pkg.name;
  }
  return fallback;
}

export function extractKit(options: ExtractOptions): KitExtract {
  const kit = discoverKit(options.packagesDir, options.exclude ?? []);
  const { project, tsConfigPath } = createKitProject(kit);
  const kitRoot = kit.kitRoot;

  const builder: Builder = {
    kitRoot,
    components: new Map(),
    byDeclaration: new Map(),
    types: new Map(),
    unresolved: [],
  };

  const packageEntries: KitPackageEntry[] = [];
  const analysed: Array<{ key: string; declaration: Node; packageName: string }> = [];
  /**
   * export name -> declaration key. Two packages re-exporting the SAME declaration is a normal
   * kit shape, not a collision; two different declarations under one name is a real one and has
   * to be reported rather than silently overwritten.
   */
  const claimed = new Map<string, string>();

  for (const pkg of kit.packages) {
    packageEntries.push({
      name: pkg.name,
      dir: toRelative(kitRoot, pkg.dir),
      version: pkg.version,
      entry: pkg.entry === null ? null : toRelative(kitRoot, pkg.entry),
    });

    if (pkg.entry === null) {
      builder.unresolved.push({ export: pkg.name, reason: pkg.entryProblem ?? "no entry file" });
      continue;
    }
    const entryFile = project.getSourceFile(pkg.entry);
    if (entryFile === undefined) {
      builder.unresolved.push({
        export: pkg.name,
        reason: "entry file could not be added to the project",
      });
      continue;
    }

    const exported = entryFile.getExportedDeclarations();
    for (const name of [...exported.keys()].sort()) {
      const declaration = primaryDeclaration(exported.get(name) ?? []);
      const qualified = `${pkg.name}#${name}`;
      if (declaration === undefined) {
        builder.unresolved.push({ export: qualified, reason: "export has no declaration" });
        continue;
      }
      if (isExternalDeclaration(declaration, kitRoot)) {
        builder.unresolved.push({
          export: qualified,
          reason: "re-exported from outside the kit root; not analysed",
        });
        continue;
      }

      const filePath = declaration.getSourceFile().getFilePath();
      const packageName = packageOf(kit.packages, filePath, pkg.name);
      const declarationKey = nodeKey(declaration);
      const previous = claimed.get(name);
      if (previous !== undefined) {
        if (previous !== declarationKey) {
          builder.unresolved.push({
            export: qualified,
            reason: `duplicate export name "${name}" resolving to a different declaration`,
          });
        }
        continue;
      }
      claimed.set(name, declarationKey);

      const kind = typeKindOf(declaration);
      if (kind !== null) {
        builder.types.set(name, {
          name,
          package: packageName,
          source: toRelative(kitRoot, filePath),
          kind,
          text: declaredTypeText(declaration.getType(), declaration, kitRoot),
        });
        continue;
      }

      if (Node.isClassDeclaration(declaration)) {
        builder.unresolved.push({ export: qualified, reason: "class export is not analysed" });
        continue;
      }
      if (!isComponent(declaration)) {
        builder.unresolved.push({
          export: qualified,
          reason: `export is neither a component nor a type (${declaration.getKindName()})`,
        });
        continue;
      }
      analysed.push({ key: name, declaration, packageName });
      builder.byDeclaration.set(declarationKey, name);
      const implementation = resolveImplementation(declaration);
      if (implementation !== undefined) builder.byDeclaration.set(nodeKey(implementation), name);
    }
  }

  for (const { key, declaration, packageName } of analysed) {
    builder.components.set(
      key,
      buildComponent(builder, key, declaration, packageName, `${packageName}#${key}`),
    );
  }

  const kitFiles = project
    .getSourceFiles()
    .filter((file) => !isExternalDeclaration(file, kitRoot))
    .sort((a, b) => (a.getFilePath() < b.getFilePath() ? -1 : 1));
  scanSubcomponents(builder, kitFiles);

  resolveRenders(builder);

  const components: Record<string, ComponentEntry> = {};
  for (const key of [...builder.components.keys()].sort()) {
    components[key] = builder.components.get(key)!.entry;
  }
  const types: Record<string, TypeEntry> = {};
  for (const key of [...builder.types.keys()].sort()) types[key] = builder.types.get(key)!;

  builder.unresolved.sort((a, b) =>
    a.export === b.export
      ? a.reason < b.reason
        ? -1
        : a.reason > b.reason
          ? 1
          : 0
      : a.export < b.export
        ? -1
        : 1,
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    kit: {
      name: kit.name,
      version: kit.version,
      packages: packageEntries,
      tsconfig: tsConfigPath === null ? null : toRelative(kitRoot, tsConfigPath),
      compilerOptions: tsConfigPath === null ? "defaults" : "tsconfig",
    },
    components,
    types,
    unresolved: builder.unresolved,
  };
}
