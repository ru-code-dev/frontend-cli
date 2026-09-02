import ignoreFactory, { type Ignore } from "ignore";

/**
 * What the walker must not look at. Ported from
 * `hackathon2026/ds-analyzer/src/scanner/profile/ignore.ts:1-102`; the only change is that
 * `IgnoreMatcher`'s constructor takes an ordinary field instead of a TypeScript parameter
 * property, which this repo's `erasableSyntaxOnly` forbids (`tsconfig.base.json:32`).
 *
 * Three layers, applied in order:
 *
 *  1. **A hard list.** Build output and dependencies are never the developer's code.
 *     Reporting a problem inside `dist/` is worse than useless — it is unfixable, and a
 *     report full of unfixable findings does not get opened twice.
 *  2. **The project's own `.gitignore`s**, including nested ones. If the team decided a
 *     directory is generated, that decision applies here too.
 *  3. **`.dsignore` and the caller's `ignore` option**, for the cases the first two miss.
 *
 * `.gitignore` semantics are subtler than they look — negation, anchoring, directory-only
 * patterns, per-directory scoping — so the `ignore` package does the matching. Matching
 * exactly what git matches is the whole point; a hand-rolled approximation would diverge on
 * precisely the patterns teams actually write.
 */

/** Directories and files that are never source, whatever the project says. */
export const HARD_IGNORED = [
  "node_modules/",
  ".git/",
  ".hg/",
  ".svn/",
  "dist/",
  "build/",
  "out/",
  "coverage/",
  ".next/",
  ".nuxt/",
  ".svelte-kit/",
  ".turbo/",
  ".cache/",
  ".parcel-cache/",
  ".yarn/",
  "storybook-static/",
  "ui-analyzer/",
  "*.min.js",
  "*.min.css",
  "*.d.ts",
  "*.snap",
] as const;

interface ScopedIgnore {
  /** Project-relative POSIX directory the rules are anchored to; `''` for the root. */
  readonly prefix: string;
  readonly matcher: Ignore;
}

const relativeTo = (prefix: string, projectPath: string): string | null =>
  projectPath.startsWith(`${prefix}/`) ? projectPath.slice(prefix.length + 1) : null;

/**
 * Layered ignore matcher.
 *
 * Instances are immutable: descending into a directory that carries its own `.gitignore`
 * produces a new matcher rather than mutating the shared one, so sibling directories cannot
 * leak rules into each other.
 */
export class IgnoreMatcher {
  private readonly layers: readonly ScopedIgnore[];

  private constructor(layers: readonly ScopedIgnore[]) {
    this.layers = layers;
  }

  static create(extraPatterns: readonly string[] = []): IgnoreMatcher {
    return new IgnoreMatcher([
      { prefix: "", matcher: ignoreFactory().add([...HARD_IGNORED, ...extraPatterns]) },
    ]);
  }

  /** A matcher with `patterns` additionally applied to everything under `directory`. */
  withScoped(directory: string, patterns: readonly string[]): IgnoreMatcher {
    if (patterns.length === 0) {
      return this;
    }

    return new IgnoreMatcher([
      ...this.layers,
      { prefix: directory, matcher: ignoreFactory().add([...patterns]) },
    ]);
  }

  /**
   * `true` when `projectPath` is excluded.
   *
   * `isDirectory` matters because `dist/` only matches a directory, and the `ignore` package
   * distinguishes the two by a trailing slash on the tested path.
   */
  ignores(projectPath: string, isDirectory: boolean): boolean {
    const candidate = isDirectory ? `${projectPath}/` : projectPath;

    for (const { prefix, matcher } of this.layers) {
      const scoped = prefix.length === 0 ? candidate : relativeTo(prefix, candidate);
      // A path outside the layer's directory is simply not governed by it.
      if (scoped !== null && scoped.length > 0 && matcher.ignores(scoped)) {
        return true;
      }
    }

    return false;
  }
}

/** Splits an ignore file into patterns, dropping comments and blank lines. */
export const parseIgnoreFile = (content: string): string[] =>
  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
