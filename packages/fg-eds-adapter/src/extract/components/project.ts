import { existsSync } from "node:fs";
import { join } from "node:path";

import { Project, ScriptTarget, type SourceFile } from "ts-morph";

import type { KitPaths } from "../paths.ts";
import { ExtractionError } from "../shared/errors.ts";

/**
 * ts-morph project over the UI kit's component sources.
 *
 * Deliberately configured **without** a type checker programme:
 *
 * - `skipFileDependencyResolution` stops TypeScript from chasing `@v-uik/*` imports that
 *   cannot be resolved (the kit's `node_modules` are not installed), which would
 *   otherwise cost minutes and still fail.
 * - No `tsConfigFilePath`, because the kit's config pulls in every workspace package.
 *
 * Everything the extractor needs — export declarations, interface members, `as const`
 * object literals, JSX presence — is available syntactically. Where a fact genuinely
 * requires cross-package types, the extractor reports the gap instead of guessing.
 */

/** Directories whose contents are never part of the public API surface. */
const IGNORED_DIRECTORY_SEGMENTS = ["__tests__", "__snapshots__", "storiesAssets", "assets"];

const GLOB_EXTENSIONS = "{ts,tsx}";

/**
 * Files that demonstrate the API rather than declaring it.
 *
 * Storybook stories and `examples/` files define plenty of PascalCase components
 * (`FilledButtons`, `IconSizes`) that are documentation, not kit API. They are still
 * loaded — module resolution and the asset inventory need them — but are excluded from
 * the component/props/variant sweeps so they cannot inflate the specification.
 */
const DEMO_PATH_SEGMENTS = ["/examples/", "/doc/", "/stories/"];
const DEMO_FILE_PATTERN = /\.stories\.tsx?$/;

export interface ComponentsProject {
  readonly project: Project;
  /** All loaded sources under `packages/base/src`, excluding test and asset directories. */
  readonly sourceFiles: readonly SourceFile[];
  /** The subset of {@link sourceFiles} that declares public API, excluding demos. */
  readonly apiFiles: readonly SourceFile[];
}

const isIgnoredPath = (filePath: string): boolean =>
  IGNORED_DIRECTORY_SEGMENTS.some((segment) => filePath.includes(`/${segment}/`));

/** `true` when the file declares API rather than demonstrating it. */
export const isApiSourceFile = (filePath: string): boolean => {
  const normalised = filePath.split(/[\\/]/).join("/");
  return (
    !DEMO_PATH_SEGMENTS.some((segment) => normalised.includes(segment)) &&
    !DEMO_FILE_PATTERN.test(normalised)
  );
};

export const createComponentsProject = (paths: KitPaths): ComponentsProject => {
  if (!existsSync(paths.baseSrcDir)) {
    throw new ExtractionError(
      `Component sources not found at "${paths.baseSrcDir}". Expected packages/base/src in the UI kit.`,
    );
  }

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: {
      target: ScriptTarget.ES2022,
      allowJs: true,
      // `jsx: preserve` keeps JsxElement nodes in the AST, which the component detector needs.
      jsx: 1,
      noResolve: true,
    },
  });

  project.addSourceFilesAtPaths([
    join(paths.baseSrcDir, `**/*.${GLOB_EXTENSIONS}`),
    `!${join(paths.baseSrcDir, `**/__tests__/**/*.${GLOB_EXTENSIONS}`)}`,
  ]);

  const sourceFiles = project.getSourceFiles().filter((file) => !isIgnoredPath(file.getFilePath()));

  if (sourceFiles.length === 0) {
    throw new ExtractionError(`No TypeScript sources were loaded from "${paths.baseSrcDir}".`);
  }

  return {
    project,
    sourceFiles,
    apiFiles: sourceFiles.filter((file) => isApiSourceFile(file.getFilePath())),
  };
};
