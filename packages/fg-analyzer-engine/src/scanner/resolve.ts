import { existsSync, statSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";

import type { Alias } from "../domain/profile.ts";
import { fromProjectPath, toProjectPath } from "../shared/path.ts";
import { CODE_EXTENSIONS, STYLE_EXTENSIONS } from "./walk.ts";

/**
 * Module specifier resolution. Ported from
 * `hackathon2026/ds-analyzer/src/scanner/resolve.ts:1-161`, minus `packageNameOf` and
 * `isDeepPackageImport`, which exist for the (unported) kit-import rules.
 *
 * Purely syntactic: no `node_modules` are required and no type checker is involved. The
 * question being answered is "does this specifier point at a file inside the project, and if
 * so which one" — enough to link a style module to the component that imports it.
 *
 * A specifier that resolves to nothing is not an error. Unresolved imports are recorded and
 * surfaced in the result's limitations, because pretending an import does not exist and
 * pretending it resolved are both worse than saying so.
 */

export type ResolutionKind = "relative" | "alias" | "package" | "unresolved";

export interface Resolution {
  readonly kind: ResolutionKind;
  /** Project-relative POSIX path, or `null` for packages and failures. */
  readonly file: string | null;
}

const CANDIDATE_EXTENSIONS: readonly string[] = [...CODE_EXTENSIONS, ...STYLE_EXTENSIONS];

const isFile = (candidate: string): boolean =>
  existsSync(candidate) && statSync(candidate).isFile();

/**
 * Expands a bare path into the files it could denote.
 *
 * Both the extensionless form (`./Button`) and the TypeScript-with-`.js`-extension form
 * (`./Button.js`, which must resolve to `Button.ts`) are handled, because ESM projects write
 * the latter and it is the form that trips naive resolvers.
 */
const candidatesFor = (basePath: string): string[] => {
  const candidates = [basePath];

  const jsExtension = /\.([cm]?)js(x?)$/.exec(basePath);
  if (jsExtension) {
    const stem = basePath.slice(0, jsExtension.index);
    const modifier = jsExtension[1] ?? "";
    const jsx = jsExtension[2] ?? "";
    candidates.push(`${stem}.${modifier}ts${jsx}`, `${stem}.ts${jsx}`, `${stem}.tsx`);
  }

  for (const extension of CANDIDATE_EXTENSIONS) {
    candidates.push(`${basePath}${extension}`);
  }
  for (const extension of CANDIDATE_EXTENSIONS) {
    candidates.push(`${basePath}/index${extension}`);
  }

  return candidates;
};

const resolveToFile = (basePath: string): string | null =>
  candidatesFor(basePath).find(isFile) ?? null;

/**
 * Applies an alias.
 *
 * Wildcard patterns behave the same everywhere: TypeScript allows at most one `*`, so
 * matching is a prefix/suffix comparison rather than a glob.
 *
 * Wildcard-free patterns do not. `"@app": ["src/app"]` in tsconfig matches the specifier
 * `@app` and nothing else, whereas `{ '@': '/abs/src' }` in a Vite or webpack config is a
 * prefix rewrite that turns `@/shared/ui` into `/abs/src/shared/ui`. Treating the Vite form
 * as exact silently loses every aliased import in projects that declare aliases only in the
 * build config.
 */
const applyAlias = (specifier: string, alias: Alias): string[] => {
  const star = alias.pattern.indexOf("*");

  if (star === -1) {
    if (specifier === alias.pattern) {
      return [...alias.resolvesTo];
    }

    const isPrefixAlias = alias.source !== "tsconfig" && alias.source !== "package-imports";
    if (isPrefixAlias && specifier.startsWith(`${alias.pattern}/`)) {
      const rest = specifier.slice(alias.pattern.length + 1);
      return alias.resolvesTo.map((target) => `${target}/${rest}`);
    }

    return [];
  }

  const prefix = alias.pattern.slice(0, star);
  const suffix = alias.pattern.slice(star + 1);

  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
    return [];
  }

  const matched = specifier.slice(prefix.length, specifier.length - suffix.length);

  return alias.resolvesTo.map((target) => target.replace("*", matched));
};

export interface ResolverContext {
  readonly root: string;
  readonly aliases: readonly Alias[];
}

/**
 * Resolves `specifier` as written inside `fromFile`.
 *
 * @param fromFile Project-relative POSIX path of the importing file.
 */
export const resolveSpecifier = (
  context: ResolverContext,
  specifier: string,
  fromFile: string,
): Resolution => {
  if (specifier.startsWith(".")) {
    const absolute = resolvePath(dirname(fromProjectPath(context.root, fromFile)), specifier);
    const file = resolveToFile(absolute);

    return {
      kind: file ? "relative" : "unresolved",
      file: file ? toProjectPath(context.root, file) : null,
    };
  }

  for (const alias of context.aliases) {
    for (const target of applyAlias(specifier, alias)) {
      const file = resolveToFile(fromProjectPath(context.root, target));
      if (file) {
        return { kind: "alias", file: toProjectPath(context.root, file) };
      }
    }
  }

  // Anything left is an external package. Whether it is installed is irrelevant: the
  // specifier is what the rules reason about.
  return { kind: "package", file: null };
};

/**
 * Package a bare specifier belongs to, or `null` for a relative/absolute path. Ported verbatim
 * from `hackathon2026/ds-analyzer/src/scanner/resolve.ts:136-154`.
 *
 * Scoped packages take two segments (`@scope/name`); everything else takes one, so a deep
 * import still names the package it reaches into.
 */
export const packageNameOf = (specifier: string): string | null => {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return null;
  }

  const segments = specifier.split("/");

  if (specifier.startsWith("@")) {
    return segments.length >= 2 ? `${segments[0] ?? ""}/${segments[1] ?? ""}` : null;
  }

  return segments[0] ?? null;
};

/** `true` when `specifier` reaches past a package's public entry points. */
export const isDeepPackageImport = (specifier: string): boolean => {
  const packageName = packageNameOf(specifier);

  return packageName !== null && specifier.length > packageName.length;
};
