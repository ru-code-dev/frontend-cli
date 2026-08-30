import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { extensionOf, toProjectPath } from "../shared/path.ts";
import { compareStrings } from "../shared/sort.ts";
import { IgnoreMatcher, parseIgnoreFile } from "./profile/ignore.ts";

/**
 * Filesystem traversal. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/scanner/walk.ts:1-165`.
 *
 * Driven entirely by file extension, never by expected directory names. `src/` is a
 * convention, not a rule: the same code lives in `app/`, in `lib/`, under each package of a
 * monorepo, or at the repository root, and a scanner that looks for `src/` finds nothing in
 * a Next.js app router project.
 *
 * Symlinks are recorded but not followed. Monorepos link workspace packages into
 * `node_modules` and often into each other, and following those links means walking the same
 * files repeatedly — or forever.
 */

/** Source extensions worth parsing. */
export const CODE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
] as const;

/** Stylesheet extensions worth parsing. */
export const STYLE_EXTENSIONS = [".css", ".scss", ".sass", ".less", ".styl"] as const;

const WALKED_EXTENSIONS: ReadonlySet<string> = new Set<string>([
  ...CODE_EXTENSIONS,
  ...STYLE_EXTENSIONS,
]);

/** Files that configure the project rather than being part of it. */
const CONFIG_FILE_NAMES: ReadonlySet<string> = new Set([
  "tsconfig.json",
  "jsconfig.json",
  "package.json",
  "pnpm-workspace.yaml",
]);

export interface WalkResult {
  /** Project-relative POSIX paths of source and style files, sorted. */
  readonly files: string[];
  /** Project-relative POSIX paths of configuration files encountered, sorted. */
  readonly configFiles: string[];
  /** Count of entries skipped by the ignore rules. */
  readonly ignoredCount: number;
  /** Project-relative POSIX paths of symlinks that were not followed. */
  readonly symlinks: string[];
}

export interface WalkOptions {
  /** Absolute project root; all returned paths are relative to it. */
  readonly root: string;
  /** Absolute directory to start from. Defaults to `root`. */
  readonly start?: string;
  /** Extra ignore patterns, e.g. from the caller's `ignore` option. */
  readonly extraIgnores?: readonly string[];
  /** Maximum directory depth, as a guard against pathological trees. */
  readonly maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 32;

const readIgnoreFile = (directory: string, name: string): string[] => {
  try {
    return parseIgnoreFile(readFileSync(join(directory, name), "utf8"));
  } catch {
    // Absent, or unreadable. Either way there is nothing to add.
    return [];
  }
};

/**
 * Walks the tree beneath `start`, honouring ignore rules at every level.
 *
 * A directory that carries a `.gitignore` or `.dsignore` extends the matcher for its own
 * subtree only, matching git's behaviour: a nested ignore file cannot affect siblings.
 */
export const walkProject = (options: WalkOptions): WalkResult => {
  const { root, start = root, extraIgnores = [], maxDepth = DEFAULT_MAX_DEPTH } = options;

  const files: string[] = [];
  const configFiles: string[] = [];
  const symlinks: string[] = [];
  let ignoredCount = 0;

  const visit = (directory: string, matcher: IgnoreMatcher, depth: number): void => {
    if (depth > maxDepth) {
      return;
    }

    const scoped = matcher.withScoped(toProjectPath(root, directory), [
      ...readIgnoreFile(directory, ".gitignore"),
      ...readIgnoreFile(directory, ".dsignore"),
    ]);

    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      // Unreadable directory (permissions, a race with another process). One directory must
      // never abort the scan.
      return;
    }

    for (const entry of [...entries].sort((left, right) => compareStrings(left.name, right.name))) {
      const absolute = join(directory, entry.name);
      const projectPath = toProjectPath(root, absolute);

      if (entry.isSymbolicLink()) {
        symlinks.push(projectPath);
        continue;
      }

      if (entry.isDirectory()) {
        if (scoped.ignores(projectPath, true)) {
          ignoredCount += 1;
          continue;
        }
        visit(absolute, scoped, depth + 1);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (scoped.ignores(projectPath, false)) {
        ignoredCount += 1;
        continue;
      }

      if (CONFIG_FILE_NAMES.has(entry.name) || /\.config\.[cm]?[jt]sx?$/.test(entry.name)) {
        configFiles.push(projectPath);
      }

      if (WALKED_EXTENSIONS.has(extensionOf(entry.name))) {
        files.push(projectPath);
      }
    }
  };

  const matcher = IgnoreMatcher.create(extraIgnores);

  if (statSync(start).isFile()) {
    const projectPath = toProjectPath(root, start);
    if (!matcher.ignores(projectPath, false) && WALKED_EXTENSIONS.has(extensionOf(start))) {
      files.push(projectPath);
    }
  } else {
    visit(start, matcher, 0);
  }

  return {
    files: files.sort(compareStrings),
    configFiles: configFiles.sort(compareStrings),
    ignoredCount,
    symlinks: symlinks.sort(compareStrings),
  };
};

/** `true` for a path the TypeScript collectors should parse. */
export const isCodeFile = (filePath: string): boolean =>
  (CODE_EXTENSIONS as readonly string[]).includes(extensionOf(filePath));

/** `true` for a path the stylesheet collectors should parse. */
export const isStyleFile = (filePath: string): boolean =>
  (STYLE_EXTENSIONS as readonly string[]).includes(extensionOf(filePath));
