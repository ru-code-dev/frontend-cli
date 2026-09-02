import { toPosix } from "../../shared/path.ts";

/**
 * SCSS variable resolution. Ported from
 * `hackathon2026/ds-analyzer/src/scanner/collectors/scss-variables.ts:1-291`; the only change
 * is `ScssVariableIndex`'s constructor taking an ordinary field rather than a TypeScript
 * parameter property, which `erasableSyntaxOnly` forbids.
 *
 * `postcss-scss` reports `color: $brand` verbatim and knows nothing about what `$brand` is.
 * Compiling with `sass` would produce the value but destroy the source coordinates, and the
 * report has to point at the line the developer wrote.
 *
 * So the value is resolved and the coordinates are kept: the finding is reported where the
 * variable is *used*, and additionally carries the declaration as its root cause. That
 * framing is more useful than either alternative — `$brand: #ff1f78` used in fourteen places
 * is one problem with one fix, not fourteen problems.
 *
 * Only assignment chains are followed. `darken($brand, 10%)`, `@each` loops and map lookups
 * are computation, and computation is marked as dynamic rather than guessed at.
 */

export interface VariableDeclaration {
  /** Name without the `$`. */
  readonly name: string;
  /** Value as authored, before resolution. */
  readonly authored: string;
  /** Value after following assignment chains; equals `authored` when nothing to follow. */
  readonly resolved: string;
  /** `true` when the chain ended at something this module cannot evaluate. */
  readonly unresolved: boolean;
  readonly file: string;
  readonly line: number;
}

/** `$name: value;` at the top level of a stylesheet. */
const DECLARATION_PATTERN = /^[ \t]*\$([\w-]+)\s*:\s*([^;]+?)\s*(?:!default|!global)?\s*;/gm;

/** `@use 'path' as ns;` / `@use 'path';` / `@forward 'path';` */
const USE_PATTERN = /@(?:use|forward)\s+['"]([^'"]+)['"](?:\s+as\s+([\w*]+))?/g;

/** `@import 'path';` — legacy, but still everywhere. */
const IMPORT_PATTERN = /@import\s+((?:['"][^'"]+['"]\s*,?\s*)+);/g;

/** A `$name` or `ns.$name` reference inside a value. */
const REFERENCE_PATTERN = /(?:([\w-]+)\.)?\$([\w-]+)/g;

export interface StylesheetVariables {
  /** Declarations in this file, by name. */
  readonly declarations: ReadonlyMap<string, VariableDeclaration>;
  /** Namespace → project-relative path of the used stylesheet. `*` means "no namespace". */
  readonly namespaces: ReadonlyMap<string, string>;
  /** Stylesheets pulled in without a namespace (`@import`, or `@use … as *`). */
  readonly wildcardSources: readonly string[];
}

/** Normalises `a/b/../c` to `a/c` without touching the filesystem. */
const normalisePosix = (path: string): string => {
  const segments: string[] = [];

  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.join("/");
};

/**
 * Resolves a Sass module specifier against the set of stylesheets already walked.
 *
 * Sass partials carry a leading underscore the specifier omits and an extension the
 * specifier may omit, so `@use '../styles/vars'` means `../styles/_vars.scss`. Every
 * spelling is tried against the known set rather than against the filesystem: the walker has
 * already decided which files are in play, and a stylesheet it excluded must not come back
 * in through an `@use`.
 */
export const resolveSassImport = (
  fromFile: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | null => {
  if (specifier.startsWith("sass:") || specifier.startsWith("~") || specifier.startsWith("@")) {
    // Built-in modules and package imports are outside the project.
    return null;
  }

  const fromDirectory = toPosix(fromFile).split("/").slice(0, -1).join("/");
  const base = normalisePosix(`${fromDirectory}/${specifier}`);
  const directory = base.split("/").slice(0, -1).join("/");
  const name = base.slice(directory.length === 0 ? 0 : directory.length + 1);
  const prefix = directory.length === 0 ? "" : `${directory}/`;

  const candidates = [
    base,
    `${base}.scss`,
    `${base}.sass`,
    `${base}.css`,
    `${prefix}_${name}.scss`,
    `${prefix}_${name}.sass`,
    `${base}/_index.scss`,
    `${base}/index.scss`,
  ];

  return candidates.find((candidate) => known.has(candidate)) ?? null;
};

/** Reads declarations and module links out of one stylesheet's text. */
export const readStylesheetVariables = (
  file: string,
  content: string,
  known: ReadonlySet<string>,
): StylesheetVariables => {
  const declarations = new Map<string, VariableDeclaration>();
  const namespaces = new Map<string, string>();
  const wildcardSources: string[] = [];

  const lineOf = (offset: number): number => content.slice(0, offset).split("\n").length;

  for (const match of content.matchAll(DECLARATION_PATTERN)) {
    const name = match[1] ?? "";
    const authored = match[2] ?? "";
    declarations.set(name, {
      name,
      authored,
      resolved: authored,
      unresolved: false,
      file,
      line: lineOf(match.index),
    });
  }

  for (const match of content.matchAll(USE_PATTERN)) {
    const target = resolveSassImport(file, match[1] ?? "", known);
    if (target === null) {
      continue;
    }

    const alias = match[2];
    if (alias === undefined || alias === "*") {
      wildcardSources.push(target);
    } else {
      namespaces.set(alias, target);
    }
  }

  for (const match of content.matchAll(IMPORT_PATTERN)) {
    for (const quoted of (match[1] ?? "").matchAll(/['"]([^'"]+)['"]/g)) {
      const target = resolveSassImport(file, quoted[1] ?? "", known);
      if (target !== null) {
        wildcardSources.push(target);
      }
    }
  }

  return { declarations, namespaces, wildcardSources };
};

/** Maximum assignment hops followed before a chain is declared unresolvable. */
const MAX_HOPS = 8;

/**
 * Project-wide variable table.
 *
 * Built from every stylesheet at once because a variable declared in `_vars.scss` is
 * consumed in modules that `_vars.scss` knows nothing about; resolution is inherently a
 * whole-project operation.
 */
export class ScssVariableIndex {
  private readonly perFile: ReadonlyMap<string, StylesheetVariables>;

  private constructor(perFile: ReadonlyMap<string, StylesheetVariables>) {
    this.perFile = perFile;
  }

  static build(stylesheets: ReadonlyMap<string, string>): ScssVariableIndex {
    const known = new Set(stylesheets.keys());
    const perFile = new Map<string, StylesheetVariables>();

    for (const [file, content] of stylesheets) {
      perFile.set(file, readStylesheetVariables(file, content, known));
    }

    return new ScssVariableIndex(perFile);
  }

  /** Looks up `[namespace.]$name` as visible from `file`. */
  lookup(file: string, namespace: string | null, name: string): VariableDeclaration | null {
    const scope = this.perFile.get(file);
    if (!scope) {
      return null;
    }

    if (namespace !== null) {
      const target = scope.namespaces.get(namespace);
      return target === undefined
        ? null
        : (this.perFile.get(target)?.declarations.get(name) ?? null);
    }

    const own = scope.declarations.get(name);
    if (own) {
      return own;
    }

    for (const source of scope.wildcardSources) {
      const inherited = this.perFile.get(source)?.declarations.get(name);
      if (inherited) {
        return inherited;
      }
    }

    return null;
  }

  /**
   * Substitutes variable references in `value` as seen from `file`.
   *
   * The reported root cause is the *deepest* declaration in the chain: given
   * `$accent-border: $brand` and `$brand: #ff1f78`, the literal lives on `$brand`, and that
   * is the one line whose repair fixes every usage.
   */
  resolveValue(
    file: string,
    value: string,
  ): {
    readonly value: string;
    readonly rootCause: VariableDeclaration | null;
    readonly unresolved: boolean;
  } {
    let rootCause: VariableDeclaration | null = null;
    let unresolved = false;

    const resolved = value.replace(
      REFERENCE_PATTERN,
      (match, namespace: string | undefined, name: string) => {
        const chain = this.resolveChain(file, namespace ?? null, name, new Set(), 0);

        if (!chain) {
          unresolved = true;
          return match;
        }

        rootCause = chain.declaration;
        unresolved = unresolved || chain.unresolved;
        return chain.value;
      },
    );

    return { value: resolved, rootCause, unresolved };
  }

  /**
   * Follows one reference to its literal.
   *
   * Each hop re-scopes to the file that declared the variable, because `$brand` inside
   * `_vars.scss` means whatever `_vars.scss` says it means — not whatever the consuming
   * module happens to have in scope.
   */
  private resolveChain(
    file: string,
    namespace: string | null,
    name: string,
    seen: Set<string>,
    depth: number,
  ): {
    readonly value: string;
    readonly declaration: VariableDeclaration;
    readonly unresolved: boolean;
  } | null {
    const declaration = this.lookup(file, namespace, name);
    if (!declaration) {
      return null;
    }

    const key = `${declaration.file}#${declaration.name}`;
    if (depth >= MAX_HOPS || seen.has(key)) {
      // A cycle, or a chain deeper than any real stylesheet. Stop and claim nothing.
      return { value: declaration.authored, declaration, unresolved: true };
    }
    seen.add(key);

    let deepest = declaration;
    let unresolved = false;

    const value = declaration.authored.replace(
      REFERENCE_PATTERN,
      (match, innerNamespace: string | undefined, innerName: string) => {
        const inner = this.resolveChain(
          declaration.file,
          innerNamespace ?? null,
          innerName,
          seen,
          depth + 1,
        );

        if (!inner) {
          unresolved = true;
          return match;
        }

        deepest = inner.declaration;
        unresolved = unresolved || inner.unresolved;
        return inner.value;
      },
    );

    return { value, declaration: deepest, unresolved };
  }
}

/** `true` when `value` still contains an unresolved Sass construct. */
export const hasUnresolvedSass = (value: string): boolean =>
  /\$[\w-]+/.test(value) ||
  value.includes("#{") ||
  /\b(?:darken|lighten|rgba?|mix|map-get|map\.get|adjust-color|scale-color)\s*\([^)]*\$/.test(
    value,
  );
