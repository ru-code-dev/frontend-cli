import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Path helpers for artifacts. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/shared/path.ts:1-41` (only quoting/semicolons changed by
 * the house formatter).
 *
 * Every path that reaches a result record is project-relative and POSIX-separated. Two
 * reasons: results are committed and diffed, so a Windows run must not produce a different
 * file from a Linux run; and the report builds deep links out of these strings, where a
 * backslash is an escape character.
 */

/** Rewrites platform separators to `/`. */
export const toPosix = (value: string): string =>
  sep === "/" ? value : value.split(sep).join("/");

/** `absolutePath` relative to `root`, POSIX-separated. Paths outside `root` stay absolute. */
export const toProjectPath = (root: string, absolutePath: string): string => {
  const relativePath = relative(root, absolutePath);

  if (relativePath.length === 0) {
    return "";
  }
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return toPosix(absolutePath);
  }

  return toPosix(relativePath);
};

/** Inverse of {@link toProjectPath}. */
export const fromProjectPath = (root: string, projectPath: string): string =>
  resolve(root, projectPath);

/** Lower-case extension including the dot, or `''`. */
export const extensionOf = (filePath: string): string => {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");

  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
};

/** `true` for `*.module.css`, `*.module.scss` and friends. */
export const isStyleModule = (filePath: string): boolean =>
  /\.module\.(css|scss|sass|less|styl)$/i.test(filePath);
