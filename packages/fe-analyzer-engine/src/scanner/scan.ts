import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { Project, ts } from "ts-morph";

import type {
  Declaration,
  JsxElement,
  LintMessage,
  Observations,
  StyleValue,
} from "../domain/observations.ts";
import { OBSERVATIONS_SCHEMA_ID } from "../domain/observations.ts";
import type { Alias, Limitation, ProjectProfile, StyleSyntax } from "../domain/profile.ts";
import { fromProjectPath } from "../shared/path.ts";
import { compareStrings, sortStrings } from "../shared/sort.ts";
import { collectJsxA11yLint } from "./collectors/jsx-a11y-lint.ts";
import { ScssVariableIndex } from "./collectors/scss-variables.ts";
import { collectStylesheet, styleSyntaxOf } from "./collectors/stylesheet.ts";
import { collectTypeScript } from "./collectors/typescript.ts";
import {
  aliasSourceForFile,
  mergeAliases,
  readConfigAliases,
  readPackageImports,
} from "./profile/aliases.ts";
import {
  detectPackageManager,
  detectWorkspaces,
  locateProject,
  readPackageManifest,
} from "./profile/root.ts";
import { isTsconfigFile, scanTsconfigs } from "./profile/tsconfig.ts";
import { resolveSpecifier, type ResolverContext } from "./resolve.ts";
import { isCodeFile, isStyleFile, walkProject } from "./walk.ts";

/**
 * Profile the project, then collect facts from it. Ported from
 * `hackathon2026/ds-analyzer/src/scanner/scan.ts:1-395` with the kit machinery removed:
 * no `ds.config.json` loader (source lines 15,173-180,199-203,318 — the brief rules it out
 * for v1), no `computeKitClosure`/`kitComponentFor` (17,315-319,343 — the module holding
 * them hardcodes a vendor scope), and no `linkKitUsage` (143-166), which existed only to
 * fill the `kitComponentsUsed` field this package's `Declaration` no longer has. Everything
 * else, including the two remaining linking passes, is the source's.
 *
 * The whole tree below the project root is walked even when a narrower scope was requested.
 * Configuration lives at the root, and a `tsconfig.json` that was never read is an alias that
 * never resolves, which shows up much later as a mysteriously missing finding. Files outside
 * the scope are dropped after the walk, not during it.
 */

export interface ScanOptions {
  /** File, directory, or repository root to analyse. */
  readonly path: string;
  /** Extra ignore patterns, gitignore syntax. */
  readonly ignore?: readonly string[];
}

export interface ScanResult {
  readonly profile: ProjectProfile;
  readonly observations: Observations;
}

const readFileSafely = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/**
 * Attaches import origin to every rendered element.
 *
 * The source additionally tagged each element's kit component here
 * (`ds-analyzer/src/scanner/scan.ts:89`); with no kit artifacts loaded that call could only
 * ever return `null`, so the field is left at the `null` the collector already wrote.
 */
const classifyJsxElements = (
  elements: readonly JsxElement[],
  importsByFile: ReadonlyMap<
    string,
    { specifier: string; local: string; imported: string; file: string | null }[]
  >,
): JsxElement[] =>
  elements.map((element) => {
    // `Button.Icon` is provided by whatever provides `Button`.
    const rootName = element.name.split(".")[0] ?? element.name;
    const binding = importsByFile.get(element.file)?.find((entry) => entry.local === rootName);

    if (!binding) {
      return element;
    }

    return { ...element, resolvedFrom: binding.specifier };
  });

/**
 * Resolves where each style declaration ends up.
 *
 * Without this a declaration on a component is indistinguishable from styling one's own
 * `<div>`, and `rootCause`/`appliedTo` on a finding have nothing to point at.
 */
const linkAppliedTo = (
  styleValues: readonly StyleValue[],
  elements: readonly JsxElement[],
): StyleValue[] => {
  interface Target {
    readonly kind: "kit-component" | "local-component" | "host-element";
    readonly name: string;
    readonly slot: string | null;
  }

  const byClass = new Map<string, Target>();

  for (const element of elements) {
    const kind: Target["kind"] = /^[a-z]/.test(element.name) ? "host-element" : "local-component";

    for (const ref of element.styleRefs) {
      const key = `${ref.module}::${ref.className}`;
      // First writer wins; a class applied to two different components is rare and the first
      // use is the one the report points at.
      if (!byClass.has(key)) {
        byClass.set(key, { kind, name: element.name, slot: ref.slot });
      }
    }
  }

  return styleValues.map((styleValue) => {
    if (styleValue.classNames.length === 0) {
      return styleValue;
    }

    for (const className of styleValue.classNames) {
      const target = byClass.get(`${styleValue.file}::${className}`);
      if (target) {
        return {
          ...styleValue,
          appliedTo: { kind: target.kind, name: target.name, slot: target.slot },
        };
      }
    }

    return { ...styleValue, appliedTo: { kind: "unused", name: null, slot: null } };
  });
};

/** Walks, profiles and collects. */
export const scanProject = (options: ScanOptions): ScanResult => {
  const location = locateProject(options.path);
  const { root, scope, targetIsFile } = location;

  const limitations: Limitation[] = [];
  const walk = walkProject({ root, extraIgnores: options.ignore ?? [] });

  // --- Profile -----------------------------------------------------------------------
  const manifest = readPackageManifest(root);
  const tsconfigPaths = walk.configFiles
    .filter((file) => isTsconfigFile(basename(file)))
    .map((file) => fromProjectPath(root, file));
  const tsconfigScan = scanTsconfigs(root, tsconfigPaths);
  limitations.push(...tsconfigScan.limitations);

  const configAliases: Alias[] = [];
  for (const configFile of walk.configFiles) {
    const source = aliasSourceForFile(basename(configFile));
    if (source !== null) {
      configAliases.push(
        ...readConfigAliases(root, fromProjectPath(root, configFile), source, limitations),
      );
    }
  }

  const aliases = mergeAliases(tsconfigScan.aliases, configAliases, readPackageImports(root));
  const resolverContext: ResolverContext = { root, aliases };

  // --- Files in scope ----------------------------------------------------------------
  const inScope = (file: string): boolean =>
    scope.length === 0 || file === scope || file.startsWith(targetIsFile ? scope : `${scope}/`);

  const files = walk.files.filter(inScope);
  const styleFiles = files.filter(isStyleFile);
  const codeFiles = files.filter(isCodeFile);

  // Variables are resolved against *every* stylesheet in the project, not only those in
  // scope: `_vars.scss` routinely sits outside the folder being audited.
  const stylesheetContents = new Map<string, string>();
  for (const file of walk.files.filter(isStyleFile)) {
    const content = readFileSafely(fromProjectPath(root, file));
    if (content !== null) {
      stylesheetContents.set(file, content);
    }
  }
  const variables = ScssVariableIndex.build(stylesheetContents);

  // --- Collect -----------------------------------------------------------------------
  const styleValues: StyleValue[] = [];
  const jsxElements: JsxElement[] = [];
  const imports: Observations["imports"] = [];
  const reExports: Observations["reExports"] = [];
  const declarations: Declaration[] = [];
  const lintMessages: LintMessage[] = [];
  const scannedFiles: string[] = [];
  const byExtension: Record<string, number> = {};
  const syntaxes = new Set<StyleSyntax>();
  let unparseable = 0;

  for (const file of styleFiles) {
    const content = stylesheetContents.get(file);
    if (content === undefined) {
      unparseable += 1;
      limitations.push({
        file,
        line: null,
        reason: "parse-error",
        detail: "file could not be read",
      });
      continue;
    }

    const result = collectStylesheet({ file, content, variables });
    styleValues.push(...result.styleValues);
    limitations.push(...result.limitations);
    scannedFiles.push(file);
    if (result.styleValues.length > 0) {
      syntaxes.add(styleSyntaxOf(file));
    }
    if (result.limitations.some((entry) => entry.reason === "parse-error")) {
      unparseable += 1;
    }
  }

  const project = new Project({
    useInMemoryFileSystem: true,
    skipFileDependencyResolution: true,
    compilerOptions: {
      allowJs: true,
      noResolve: true,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.Latest,
    },
  });

  for (const file of codeFiles) {
    const content = readFileSafely(fromProjectPath(root, file));
    if (content === null) {
      unparseable += 1;
      limitations.push({
        file,
        line: null,
        reason: "parse-error",
        detail: "file could not be read",
      });
      continue;
    }

    const result = collectTypeScript({
      file,
      content,
      project,
      resolveModule: (specifier) => resolveSpecifier(resolverContext, specifier, file),
    });

    // The canonical JSX accessibility rules, run on the same content the collectors just
    // read. Kept here rather than in a rule so that syntax stays confined to this stage.
    const lint = collectJsxA11yLint({ file, content });
    lintMessages.push(...lint.messages);
    limitations.push(...lint.limitations);

    styleValues.push(...result.styleValues);
    jsxElements.push(...result.jsxElements);
    imports.push(...result.imports);
    reExports.push(...result.reExports);
    declarations.push(...result.declarations);
    limitations.push(...result.limitations);
    scannedFiles.push(file);

    for (const styleValue of result.styleValues) {
      syntaxes.add(styleValue.source);
    }
    if (result.limitations.some((entry) => entry.reason === "parse-error")) {
      unparseable += 1;
    }
  }

  for (const file of files) {
    const extension = file.slice(file.lastIndexOf("."));
    byExtension[extension] = (byExtension[extension] ?? 0) + 1;
  }

  // --- Join --------------------------------------------------------------------------
  const importsByFile = new Map<
    string,
    { specifier: string; local: string; imported: string; file: string | null }[]
  >();
  for (const record of imports) {
    const bucket = importsByFile.get(record.file) ?? [];
    for (const name of record.names) {
      bucket.push({
        specifier: record.specifier,
        local: name.local,
        imported: name.imported,
        file: record.resolution.file,
      });
    }
    if (record.defaultImport !== null) {
      bucket.push({
        specifier: record.specifier,
        local: record.defaultImport,
        imported: "default",
        file: record.resolution.file,
      });
    }
    importsByFile.set(record.file, bucket);
  }

  const classifiedElements = classifyJsxElements(jsxElements, importsByFile);
  const linkedStyleValues = linkAppliedTo(styleValues, classifiedElements);

  const profile: ProjectProfile = {
    $schema: "fe-analyzer-engine/project-profile@1",
    root,
    scope,
    name: manifest.name,
    packageManager: detectPackageManager(root),
    monorepo: (() => {
      const workspaces = detectWorkspaces(root, manifest);
      return { detected: workspaces.length > 0, workspaces };
    })(),
    tsconfigs: tsconfigScan.configs,
    aliases,
    styleSyntaxes: [...syntaxes].sort(compareStrings),
    files: {
      scanned: scannedFiles.length,
      ignored: walk.ignoredCount,
      unparseable,
      byExtension,
    },
    limitations: limitations.sort(
      (left, right) =>
        compareStrings(left.file, right.file) || (left.line ?? 0) - (right.line ?? 0),
    ),
  };

  const observations: Observations = {
    $schema: OBSERVATIONS_SCHEMA_ID,
    styleValues: linkedStyleValues,
    jsxElements: classifiedElements,
    imports,
    reExports,
    declarations,
    lintMessages: lintMessages.sort(
      (left, right) =>
        compareStrings(left.file, right.file) ||
        left.line - right.line ||
        left.column - right.column ||
        compareStrings(left.rule, right.rule),
    ),
    files: sortStrings(scannedFiles),
    limitations: profile.limitations,
  };

  return { profile, observations };
};
