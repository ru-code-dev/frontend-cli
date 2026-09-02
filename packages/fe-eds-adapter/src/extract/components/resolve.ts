import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type { KitPaths } from "../paths.ts";

/**
 * Module-specifier resolution for the UI kit, reimplemented rather than delegated to
 * TypeScript because the project is loaded with `noResolve` (see `project.ts`).
 *
 * Three specifier families occur:
 *
 *   './Button', '../shared/types'   relative       → resolved against the importing file
 *   '@src/shared/constants'          path alias     → `packages/base/src/*` per the kit tsconfig
 *   '@v-uik/base', 'react'           bare package   → external, unresolvable here
 */

/** Extension probe order, mirroring TypeScript's own for a `moduleResolution: node` project. */
const EXTENSION_CANDIDATES = [".ts", ".tsx", ".d.ts", ".js", ".jsx"] as const;

const INDEX_BASENAMES = ["index"] as const;

/** Alias declared in the kit's root tsconfig: `"@src/*": ["./packages/base/src/*"]`. */
const SRC_ALIAS_PREFIX = "@src/";

export type SpecifierKind = "relative" | "alias" | "external";

/**
 * File-existence probe used during resolution.
 *
 * Injected rather than calling `fs` directly so the resolver can be exercised against
 * in-memory fixtures, and so a future caller can back it with a cached index instead of
 * hitting the disk once per candidate extension.
 */
export interface FileProbe {
  isFile(absolutePath: string): boolean;
}

export const nodeFileProbe: FileProbe = {
  isFile: (absolutePath) => existsSync(absolutePath) && statSync(absolutePath).isFile(),
};

/** Builds a probe over a fixed set of absolute file paths. */
export const setFileProbe = (files: Iterable<string>): FileProbe => {
  const known = new Set(files);
  return { isFile: (absolutePath) => known.has(absolutePath) };
};

export interface ResolvedSpecifier {
  readonly specifier: string;
  readonly kind: SpecifierKind;
  /** Absolute path to the resolved file, or `null` for external / unresolvable specifiers. */
  readonly file: string | null;
  /** Package name for external specifiers, e.g. `@v-uik/base` from `@v-uik/base/foo`. */
  readonly packageName: string | null;
}

export const classifySpecifier = (specifier: string): SpecifierKind => {
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    return "relative";
  }
  if (specifier.startsWith(SRC_ALIAS_PREFIX)) {
    return "alias";
  }
  return "external";
};

/** `@v-uik/base/dist/x` → `@v-uik/base`; `react-dom/client` → `react-dom`. */
export const toPackageName = (specifier: string): string => {
  const segments = specifier.split("/");

  if (specifier.startsWith("@")) {
    return segments.slice(0, 2).join("/");
  }

  return segments[0] ?? specifier;
};

/** Probes `<base>.<ext>` then `<base>/index.<ext>`, matching Node/TS resolution order. */
const probeModule = (basePath: string, probe: FileProbe): string | null => {
  for (const extension of EXTENSION_CANDIDATES) {
    const candidate = `${basePath}${extension}`;
    if (probe.isFile(candidate)) {
      return candidate;
    }
  }

  for (const indexName of INDEX_BASENAMES) {
    for (const extension of EXTENSION_CANDIDATES) {
      const candidate = join(basePath, `${indexName}${extension}`);
      if (probe.isFile(candidate)) {
        return candidate;
      }
    }
  }

  return null;
};

/**
 * Resolves a module specifier appearing in `fromFile`.
 *
 * @param paths     Analyzer path set, used to expand the `@src/*` alias.
 * @param fromFile  Absolute path of the importing file.
 * @param specifier Specifier exactly as written in source.
 * @param probe     File-existence probe; defaults to the real filesystem.
 */
export const resolveSpecifier = (
  paths: KitPaths,
  fromFile: string,
  specifier: string,
  probe: FileProbe = nodeFileProbe,
): ResolvedSpecifier => {
  const kind = classifySpecifier(specifier);

  switch (kind) {
    case "relative": {
      const basePath = resolve(dirname(fromFile), specifier);
      return { specifier, kind, file: probeModule(basePath, probe), packageName: null };
    }
    case "alias": {
      const basePath = join(paths.baseSrcDir, specifier.slice(SRC_ALIAS_PREFIX.length));
      return { specifier, kind, file: probeModule(basePath, probe), packageName: null };
    }
    case "external":
      return { specifier, kind, file: null, packageName: toPackageName(specifier) };
  }
};
