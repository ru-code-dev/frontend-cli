/**
 * Loads the design system's theme by *executing its TypeScript sources*.
 *
 * ── WHY EXECUTE THE SOURCES AT ALL ──────────────────────────────────────────────────────────
 *
 * The hackathon's two rejected alternatives are still the right rejections, kept verbatim from
 * `hackathon2026/ds-analyzer/src/tokens/loader.ts:10-30`:
 *
 *  - Importing the published package — the kit's `node_modules` are not installed and
 *    `@sds-eng/theme` is not on a public registry.
 *  - Parsing the sources with an AST — `calcTheme()` performs non-trivial reference resolution
 *    (including an `rgba({ref},0.06)` → `#rrggbbaa` alpha merge,
 *    `ui-kit-eds-ce/packages/theme/src/calcTheme.ts:27-43`) that would have to be
 *    reimplemented, and any drift between the two implementations would silently corrupt the
 *    artifact.
 *
 * Executing the real sources is safe because `packages/theme` has **zero** external imports —
 * a closed set of plain object literals plus pure helpers — and {@link assertSelfContained}
 * makes that assumption fail loudly rather than silently if a future kit version breaks it.
 *
 * ── WHY NOT esbuild ─────────────────────────────────────────────────────────────────────────
 *
 * The hackathon bundled the theme with `esbuild.build({ stdin, bundle: true, write: false })`
 * and `import()`ed the result from a `data:` URL (`loader.ts:114-154,168-170`). esbuild is a
 * NATIVE BINARY: it cannot be inlined into `dist/main.mjs`, and this CLI's whole shape is one
 * zero-dependency file a user can copy anywhere (`cli/tsdown.config.ts:18-22`). Adding it would
 * have meant either shipping a second artifact or making `--parse-ui-kit` the one command that
 * needs an install.
 *
 * So the bundle step is replaced by `typescript.transpileModule` + `node:vm` — and BOTH halves
 * of that are already paid for: `typescript` is in the bundle via `ts-morph`
 * (`cli/tsdown.config.ts:257,260`) and `node:vm` is a builtin. What follows is a ~60-line
 * CommonJS module runner: resolve, transpile, evaluate, cache.
 *
 * THREE DECISIONS KEEP IT EQUIVALENT TO THE BUNDLER, and each one is load-bearing:
 *
 *  1. `runInThisContext`, NOT `createContext`. A fresh vm context is a fresh V8 REALM with its
 *     own `Object.prototype`, and the theme's values would then be cross-realm objects. The
 *     hackathon's `import(data:…)` ran in the caller's realm, so this must too — otherwise
 *     every `instanceof`, and any future prototype check in the walkers that read these trees
 *     (`shared/object.ts`), would answer differently for a reason that has nothing to do with
 *     the kit.
 *  2. A MODULE CACHE keyed by absolute path, populated BEFORE the module body runs. That is
 *     CommonJS cycle semantics, and it is what the bundler's single-scope output gave for free:
 *     `comp.ts` ← `theme/*.ts` ← `themeTemplates.ts` ← `ref.ts`/`sys.ts` is a real diamond in
 *     this kit, and every module in it must be evaluated exactly once so the resolved theme is
 *     built from one set of objects rather than several copies.
 *  3. THE EXTERNAL-IMPORT SET IS COLLECTED STATICALLY, before anything executes, by walking the
 *     graph with `ts.preProcessFile`. esbuild's `onResolve({ filter: /^[^./]/ })` plugin
 *     (`loader.ts:132-143`) recorded the same set the same way — at resolve time, not at run
 *     time — so a theme that grew a dependency is refused with the full list rather than
 *     throwing on whichever import happened to execute first.
 *
 * Equivalence is not argued from this comment: `tests/parse-ui-kit.integration.test.ts` runs
 * this loader against `ui-kit-eds-ce` at tag `v1.13.0` and compares the resulting `tokens.json`
 * to the embedded artifact the esbuild version produced.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { runInThisContext } from "node:vm";

import { compareStrings } from "@smart-tools/fe-analyzer-engine";
import ts from "typescript";

import { ExtractionError } from "../shared/errors.ts";
import { isPlainRecord, type PlainRecord } from "../shared/object.ts";

/**
 * Both the *authored* tiers (`sysLight`, `comp` — still carrying `{edsRef.…}` templates) and
 * the *resolved* themes (`light`, `dark`) are returned, so the extractor can record provenance
 * alongside final values.
 */
export interface ResolvedTheme {
  readonly ref: PlainRecord;
  readonly edsRef: PlainRecord;
  readonly edsSys: PlainRecord;
  readonly comp: PlainRecord;
}

export interface ThemeSource {
  /** Authored primitives; already literal, no references. */
  readonly edsRef: PlainRecord;
  /** Authored typography families exposed under the legacy `ref` export. */
  readonly ref: PlainRecord;
  /** Authored semantic tier, light mode — contains `{edsRef.…}` templates. */
  readonly sysLight: PlainRecord;
  /** Authored semantic tier, dark mode. */
  readonly sysDark: PlainRecord;
  /** Authored component tier — contains `{edsRef.…}` and `{edsSys.…}` templates. */
  readonly comp: PlainRecord;
  /** Fully resolved light theme as shipped to consumers. */
  readonly light: ResolvedTheme;
  /** Fully resolved dark theme as shipped to consumers. */
  readonly dark: ResolvedTheme;
}

/**
 * The seven exports the extractor needs, and the module each comes from.
 *
 * This is the hackathon's synthetic entry module (`loader.ts:55-61`) as DATA rather than as a
 * string of TypeScript. It had to be source text there because esbuild's `stdin` takes source
 * text; here the runner is called directly, so the same five imports are five lookups and there
 * is no generated file to keep in step with this table.
 */
const ENTRY_MODULES = {
  ref: ["ref", "ref"],
  edsRef: ["ref", "edsRef"],
  sysLight: ["sys", "sysLight"],
  sysDark: ["sys", "sysDark"],
  comp: ["comp", "comp"],
  light: ["light", "light"],
  dark: ["dark", "dark"],
} as const satisfies Record<string, readonly [string, string]>;

const REQUIRED_SOURCE_FILES = [
  "ref.ts",
  "sys.ts",
  "comp.ts",
  "light.ts",
  "dark.ts",
  "calcTheme.ts",
] as const;

const RESOLVED_THEME_KEYS = ["ref", "edsRef", "edsSys", "comp"] as const;

/** Extensions a relative specifier may resolve to, in the order esbuild's `resolveExtensions`
 *  tried them (`loader.ts:130`), plus the `index` forms a directory specifier needs — `comp.ts`
 *  imports `./theme`, which is a directory. */
const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js"] as const;

const assertSourcesPresent = (themeSrcDir: string): void => {
  const missing = REQUIRED_SOURCE_FILES.filter((file) => !existsSync(join(themeSrcDir, file)));

  if (missing.length > 0) {
    throw new ExtractionError(
      `Theme sources not found in "${themeSrcDir}". Missing: ${missing.join(", ")}. ` +
        "Check that the UI kit path points at packages/theme/src.",
    );
  }
};

/**
 * Fails if the theme package gained an external import, which would make executing it dependent
 * on the kit's uninstalled `node_modules`.
 */
const assertSelfContained = (externalImports: readonly string[]): void => {
  if (externalImports.length > 0) {
    throw new ExtractionError(
      `The theme package is no longer self-contained; it now imports: ${externalImports.join(", ")}. ` +
        "The loader executes theme sources directly and cannot resolve third-party modules.",
    );
  }
};

const asRecord = (value: unknown, exportName: string): PlainRecord => {
  if (!isPlainRecord(value)) {
    throw new ExtractionError(
      `Theme export "${exportName}" is not an object (got ${typeof value}).`,
    );
  }
  return value;
};

const asResolvedTheme = (value: unknown, exportName: string): ResolvedTheme => {
  const record = asRecord(value, exportName);

  const missing = RESOLVED_THEME_KEYS.filter((key) => !isPlainRecord(record[key]));
  if (missing.length > 0) {
    throw new ExtractionError(
      `Theme export "${exportName}" is missing tier(s): ${missing.join(", ")}.`,
    );
  }

  return {
    ref: record["ref"] as PlainRecord,
    edsRef: record["edsRef"] as PlainRecord,
    edsSys: record["edsSys"] as PlainRecord,
    comp: record["comp"] as PlainRecord,
  };
};

/**
 * A relative or absolute specifier → the file it names, or `null`.
 *
 * Tries the bare path, then each extension, then `index.<ext>` inside it — the standard
 * TypeScript/bundler order. `null` rather than a throw so the caller can say WHICH import in
 * WHICH file could not be resolved, which a `MODULE_NOT_FOUND` from deeper down would not.
 */
const resolveModulePath = (fromDir: string, specifier: string): string | null => {
  const base = isAbsolute(specifier) ? specifier : resolve(fromDir, specifier);

  const candidates = [
    ...(/\.[cm]?[jt]sx?$/.test(base) ? [base] : []),
    ...RESOLVE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...RESOLVE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
};

/** `true` for the specifiers esbuild's plugin treated as external: anything not starting with
 *  `.` or `/` (`loader.ts:136-137`). */
const isBareSpecifier = (specifier: string): boolean => !/^[./]/.test(specifier);

/**
 * Walks the import graph from `entries` WITHOUT executing anything, returning the bare
 * specifiers it found.
 *
 * `ts.preProcessFile` is the compiler's own pre-parse scanner: it reports every import,
 * `export … from`, `require()` and triple-slash reference in a file without building a program.
 * That makes this pass both exact — it is the same tokenizer the transpile step will use — and
 * cheap enough to run over the whole theme package on every extraction.
 */
const collectExternalImports = (entries: readonly string[]): string[] => {
  const externals = new Set<string>();
  const visited = new Set<string>();

  const walk = (file: string): void => {
    if (visited.has(file)) return;
    visited.add(file);

    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      // A file that cannot be read cannot be transpiled either; the run step reports it with
      // the importing file's name, which is the more useful message.
      return;
    }

    for (const imported of ts.preProcessFile(source, true, true).importedFiles) {
      const specifier = imported.fileName;
      if (isBareSpecifier(specifier)) {
        externals.add(specifier);
        continue;
      }
      const resolved = resolveModulePath(dirname(file), specifier);
      if (resolved !== null) walk(resolved);
    }
  };

  for (const entry of entries) walk(entry);

  return [...externals].sort(compareStrings);
};

/** What `ts.transpileModule` is asked for, and why each option is what it is. */
const TRANSPILE_OPTIONS: ts.CompilerOptions = {
  // CommonJS, because the runner below IS a CommonJS host: `exports`/`require` are the two
  // names it can supply to a function wrapper. ESM output would need a real module record.
  module: ts.ModuleKind.CommonJS,
  // Matching esbuild's `target: 'es2022'` (`loader.ts:129`). The theme is object literals,
  // spreads and `Array.prototype.reduce`; nothing here is downlevelled at ES2022, so the
  // emitted code is the input with types erased.
  target: ts.ScriptTarget.ES2022,
  // `import * as theme from './theme'` must become a plain property read of the CommonJS
  // `exports` object rather than an interop-wrapped default. This is the pair of flags that
  // makes a namespace import of a `export *` barrel spread the way the bundler's namespace
  // object did — which is what `comp.ts:6-10` depends on.
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  // The theme's own `tsconfig` is not consulted: this loader must behave identically whatever
  // the checkout's compiler settings are, or a byte-identical re-extraction would depend on a
  // file none of the extracted values come from.
  isolatedModules: true,
  useDefineForClassFields: false,
};

/** One evaluated module. `exports` is mutated in place, which is what makes cycles work. */
interface LoadedModule {
  exports: PlainRecord;
}

/**
 * Evaluates the theme's module graph and returns the namespace of each entry file.
 *
 * The wrapper is the classic CommonJS one — `(function (exports, require, module, __filename,
 * __dirname) { … })` — compiled with {@link runInThisContext} so the module body sees no
 * ambient scope from THIS file while still living in this realm. `filename` is passed so a
 * throw inside the theme points at the theme's own file rather than at a `<anonymous>` frame.
 */
const evaluateGraph = (entries: readonly string[]): Map<string, PlainRecord> => {
  const cache = new Map<string, LoadedModule>();

  const load = (file: string, importedFrom: string | null): PlainRecord => {
    const cached = cache.get(file);
    // Populated before the body runs, so a cycle sees the partially-filled namespace instead of
    // recursing forever — Node's own CommonJS behaviour.
    if (cached !== undefined) return cached.exports;

    const loaded: LoadedModule = { exports: {} };
    cache.set(file, loaded);

    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch (cause) {
      throw new ExtractionError(
        `Could not read theme source "${file}"` +
          (importedFrom === null ? "" : ` (imported from "${importedFrom}")`) +
          `: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    const { outputText } = ts.transpileModule(source, {
      compilerOptions: TRANSPILE_OPTIONS,
      fileName: file,
    });

    const wrapper = runInThisContext(
      `(function (exports, require, module, __filename, __dirname) {\n${outputText}\n})`,
      { filename: file },
    ) as (
      exports: PlainRecord,
      require: (specifier: string) => PlainRecord,
      module: LoadedModule,
      filename: string,
      directory: string,
    ) => void;

    const directory = dirname(file);
    const requireFrom = (specifier: string): PlainRecord => {
      // Unreachable while `assertSelfContained` has passed — it is the same graph, walked with
      // the same resolver. Kept because "unreachable" and "silently returns `{}`" are different
      // promises, and only one of them survives a future kit version.
      if (isBareSpecifier(specifier)) {
        throw new ExtractionError(
          `Theme source "${file}" requires the external module "${specifier}", which this loader cannot resolve.`,
        );
      }
      const resolved = resolveModulePath(directory, specifier);
      if (resolved === null) {
        throw new ExtractionError(
          `Theme source "${file}" imports "${specifier}", which does not exist on disk.`,
        );
      }
      return load(resolved, file);
    };

    wrapper(loaded.exports, requireFrom, loaded, file, directory);

    return loaded.exports;
  };

  return new Map(entries.map((entry) => [entry, load(entry, null)]));
};

/**
 * Compiles and evaluates the UI kit's theme sources.
 *
 * @param themeSrcDir Absolute path to `packages/theme/src` of the UI kit.
 */
export const loadThemeSource = (themeSrcDir: string): ThemeSource => {
  assertSourcesPresent(themeSrcDir);

  const entryFiles = new Map<string, string>();
  for (const [, [moduleName]] of Object.entries(ENTRY_MODULES)) {
    if (entryFiles.has(moduleName)) continue;
    const resolved = resolveModulePath(themeSrcDir, `./${moduleName}`);
    if (resolved === null) {
      throw new ExtractionError(`Theme entry "${moduleName}" not found under "${themeSrcDir}".`);
    }
    entryFiles.set(moduleName, resolved);
  }

  assertSelfContained(collectExternalImports([...entryFiles.values()]));

  const namespaces = evaluateGraph([...entryFiles.values()]);

  /** One of the seven entry exports, by the table above. */
  const exported = (key: keyof typeof ENTRY_MODULES): unknown => {
    const [moduleName, exportName] = ENTRY_MODULES[key];
    const file = entryFiles.get(moduleName);
    return file === undefined ? undefined : namespaces.get(file)?.[exportName];
  };

  return {
    edsRef: asRecord(exported("edsRef"), "edsRef"),
    ref: asRecord(exported("ref"), "ref"),
    sysLight: asRecord(exported("sysLight"), "sysLight"),
    sysDark: asRecord(exported("sysDark"), "sysDark"),
    comp: asRecord(exported("comp"), "comp"),
    light: asResolvedTheme(exported("light"), "light"),
    dark: asResolvedTheme(exported("dark"), "dark"),
  };
};
