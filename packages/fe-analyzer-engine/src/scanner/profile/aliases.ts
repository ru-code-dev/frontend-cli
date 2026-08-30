import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { Node, Project, SyntaxKind, ts } from "ts-morph";

import type { Alias, AliasSource, Limitation } from "../../domain/profile.ts";
import { toPosix, toProjectPath } from "../../shared/path.ts";
import { compareStrings } from "../../shared/sort.ts";

/**
 * Alias discovery from build configuration. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/scanner/profile/aliases.ts:1-294`, with one message change:
 * the "declare the alias in ds.config.json" advice becomes this engine's own `ignore`/alias
 * wording, because v1 has no `ds.config.json` (see DELTAS).
 *
 * Aliases are the single largest source of brittleness in a cross-project scanner:
 * `import { Button } from '@/shared/ui'` is unresolvable without knowing what `@/` means,
 * and a project is free to declare that in any of five places.
 *
 * **Configs are parsed, never executed.** Running a consumer's `vite.config.ts` would
 * require their dependencies to be installed, would execute arbitrary code from a repository
 * we are only meant to read, and would fail on any config that imports a plugin. Static
 * analysis costs us the exotic cases — which are recorded as limitations — and buys
 * correctness everywhere else.
 *
 * The traversal looks for one shape: an `alias` property under a `resolve` property. That
 * single rule covers Vite, webpack, craco and the `webpack()` callback in `next.config`,
 * because all four settled on the same key.
 */

const CONFIG_SOURCES: readonly (readonly [RegExp, AliasSource])[] = [
  [/^vite\.config\.[cm]?[jt]s$/, "vite"],
  [/^vitest\.config\.[cm]?[jt]s$/, "vite"],
  [/^webpack\.config(\.[\w-]+)?\.[cm]?[jt]s$/, "webpack"],
  [/^craco\.config\.[cm]?[jt]s$/, "craco"],
  [/^next\.config\.[cm]?[jt]s$/, "next"],
  [/^rollup\.config\.[cm]?[jt]s$/, "webpack"],
];

/** Alias source implied by a config file name, or `null` when it is not one we read. */
export const aliasSourceForFile = (fileName: string): AliasSource | null =>
  CONFIG_SOURCES.find(([pattern]) => pattern.test(fileName))?.[1] ?? null;

/**
 * Recovers a filesystem path from a config expression without evaluating it.
 *
 * Handles the three spellings that account for essentially every real config:
 *
 *   '@': './src'
 *   '@': path.resolve(__dirname, 'src')
 *   '@': fileURLToPath(new URL('./src', import.meta.url))
 *
 * The shared trick is that in all of them the only meaningful information is the string
 * literals; `__dirname` and `import.meta.url` both denote the config's own directory, which
 * the caller already knows. Anything with no string literal at all returns `null` rather
 * than a guess.
 */
const staticPathOf = (node: Node): string | null => {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralValue();
  }

  if (Node.isCallExpression(node) || Node.isNewExpression(node)) {
    const parts = node
      .getArguments()
      .map((argument) => staticPathOf(argument))
      .filter((part): part is string => part !== null);

    return parts.length > 0 ? parts.join("/") : null;
  }

  return null;
};

interface AliasEntry {
  readonly pattern: string;
  readonly target: string;
}

const readAliasObject = (object: Node): AliasEntry[] => {
  const entries: AliasEntry[] = [];

  for (const property of object.getChildrenOfKind(SyntaxKind.PropertyAssignment)) {
    const name = property.getNameNode();
    const pattern = Node.isStringLiteral(name)
      ? name.getLiteralValue()
      : Node.isIdentifier(name)
        ? name.getText()
        : Node.isComputedPropertyName(name)
          ? null
          : name.getText().replace(/^['"]|['"]$/g, "");

    const initializer = property.getInitializer();
    const target = initializer ? staticPathOf(initializer) : null;

    if (pattern !== null && target !== null) {
      entries.push({ pattern, target });
    }
  }

  return entries;
};

/** Vite also accepts `alias: [{ find, replacement }]`. */
const readAliasArray = (array: Node): AliasEntry[] => {
  const entries: AliasEntry[] = [];

  for (const element of array.getChildrenOfKind(SyntaxKind.ObjectLiteralExpression)) {
    let pattern: string | null = null;
    let target: string | null = null;

    for (const property of element.getChildrenOfKind(SyntaxKind.PropertyAssignment)) {
      const key = property.getName().replace(/^['"]|['"]$/g, "");
      const initializer = property.getInitializer();
      if (!initializer) {
        continue;
      }
      if (key === "find") {
        pattern = staticPathOf(initializer);
      } else if (key === "replacement") {
        target = staticPathOf(initializer);
      }
    }

    if (pattern !== null && target !== null) {
      entries.push({ pattern, target });
    }
  }

  return entries;
};

/**
 * Extracts aliases from one build config.
 *
 * A dedicated in-memory `Project` is used so that nothing about the consumer's TypeScript
 * setup — missing types, unresolved plugin imports, a `strict` flag — can affect us. The
 * file is only ever a syntax tree here.
 */
export const readConfigAliases = (
  root: string,
  configPath: string,
  source: AliasSource,
  limitations: Limitation[],
): Alias[] => {
  let sourceText: string;
  try {
    sourceText = readFileSync(configPath, "utf8");
  } catch (error) {
    limitations.push({
      file: toProjectPath(root, configPath),
      line: null,
      reason: "unreadable-config",
      detail: error instanceof Error ? error.message : "read failed",
    });
    return [];
  }

  const project = new Project({
    useInMemoryFileSystem: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: true, noResolve: true, target: ts.ScriptTarget.Latest },
  });

  let sourceFile;
  try {
    sourceFile = project.createSourceFile(
      `/config${configPath.endsWith("x") ? ".tsx" : ".ts"}`,
      sourceText,
    );
  } catch (error) {
    limitations.push({
      file: toProjectPath(root, configPath),
      line: null,
      reason: "unreadable-config",
      detail: error instanceof Error ? error.message : "parse failed",
    });
    return [];
  }

  const configDirectory = dirname(configPath);
  const entries: AliasEntry[] = [];

  const readAliasInitializer = (initializer: Node, reportedAt: Node): void => {
    if (Node.isObjectLiteralExpression(initializer)) {
      entries.push(...readAliasObject(initializer));
    } else if (Node.isArrayLiteralExpression(initializer)) {
      entries.push(...readAliasArray(initializer));
    } else {
      limitations.push({
        file: toProjectPath(root, configPath),
        line: reportedAt.getStartLineNumber(),
        reason: "unreadable-config",
        detail:
          "resolve.alias is computed and cannot be read statically; imports through it stay unresolved",
      });
    }
  };

  // `config.resolve.alias = { … }` — the shape Next.js and ejected webpack configs use,
  // where the alias map is assigned inside a callback rather than declared in a literal.
  for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) {
      continue;
    }

    const target = assignment.getLeft();
    if (!Node.isPropertyAccessExpression(target) || !/\bresolve\.alias$/.test(target.getText())) {
      continue;
    }

    readAliasInitializer(assignment.getRight(), assignment);
  }

  for (const property of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    if (property.getName().replace(/^['"]|['"]$/g, "") !== "alias") {
      continue;
    }

    // `alias` is only meaningful under `resolve`. Requiring the parent guards against
    // unrelated objects that happen to use the word.
    const owner = property.getFirstAncestorByKind(SyntaxKind.PropertyAssignment);
    if (owner && owner.getName().replace(/^['"]|['"]$/g, "") !== "resolve") {
      continue;
    }

    const initializer = property.getInitializer();
    if (initializer) {
      readAliasInitializer(initializer, initializer);
    }
  }

  return entries.map(({ pattern, target }) => ({
    pattern,
    resolvesTo: [toPosix(toProjectPath(root, resolve(configDirectory, target)))],
    source,
  }));
};

/** Subpath imports from `package.json`, e.g. `{"#app/*": "./src/*"}`. */
export const readPackageImports = (root: string): Alias[] => {
  const manifestPath = resolve(root, "package.json");
  if (!existsSync(manifestPath)) {
    return [];
  }

  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (typeof parsed !== "object" || parsed === null) {
      return [];
    }
    manifest = parsed as Record<string, unknown>;
  } catch {
    return [];
  }

  const imports = manifest["imports"];
  if (typeof imports !== "object" || imports === null) {
    return [];
  }

  const aliases: Alias[] = [];
  for (const [pattern, target] of Object.entries(imports)) {
    // Conditional exports (`{ "default": "./x.js" }`) are a runtime concern; only the plain
    // string form maps to a path we can resolve statically.
    if (typeof target === "string") {
      aliases.push({
        pattern,
        resolvesTo: [toPosix(toProjectPath(root, resolve(root, target)))],
        source: "package-imports",
      });
    }
  }

  return aliases;
};

/**
 * Merges alias sets, keeping the first definition of each pattern.
 *
 * `tsconfig` is passed first because it is the declaration the editor and the type checker
 * already agree on; build configs are a fallback for projects that only declare aliases
 * there.
 */
export const mergeAliases = (...sets: readonly (readonly Alias[])[]): Alias[] => {
  const merged = new Map<string, Alias>();

  for (const set of sets) {
    for (const alias of set) {
      if (!merged.has(alias.pattern)) {
        merged.set(alias.pattern, alias);
      }
    }
  }

  return [...merged.values()].sort((left, right) => compareStrings(left.pattern, right.pattern));
};

/** Config file names this module knows how to read, for the walker's benefit. */
export const isAliasConfigFile = (filePath: string): boolean =>
  aliasSourceForFile(basename(filePath)) !== null;
