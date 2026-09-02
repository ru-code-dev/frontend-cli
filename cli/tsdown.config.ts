import { readFileSync } from "node:fs";

import { defineConfig } from "tsdown";

/**
 * The version, read HERE — in the build process — and substituted into the bundle as a literal.
 *
 * This read happens while tsdown runs; it is not code that ships. That distinction is the whole
 * requirement: the published tarball is `package.json` + `dist/main.mjs`
 * (`cli/package.json:8-10`), a user may copy that single file anywhere, and a bundle that reads
 * its own manifest at runtime breaks the moment it is moved away from one. `cli/src/version.ts`
 * documents the consuming half.
 */
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

// The SINGLE-FILE bundle target, modelled on
// `ru-code-packages/packages/pixso-cli/tsdown.config.ts:8-35` — the proven recipe for a
// zero-dep artifact (report 1.2 Q5A). Unlike the library packages beside it, `cli` inlines
// its dependencies so `dist/main.mjs` is one self-contained file a user can run with nothing
// installed beside it.
export default defineConfig({
  entry: { main: "src/main.ts" },
  format: "esm",
  // ── THE TWO TRICKS THAT MAKE THE ANALYZER BUNDLABLE ──────────────────────────────────────
  //
  // Both are ported from the in-house precedent this repo's design named: hackathon2026's own
  // `ds.mjs` is a 15.1 MB single-file zero-dep bundle of the SAME dependency set (ts-morph,
  // typescript, eslint, jsx-a11y, postcss), built with exactly these two
  // (`hackathon2026/ds-analyzer/scripts/build-skills.ts:56-75`, quoted at
  // `WORKFLOW/features/hackathon-analys/plans/h4-design.md:55-64`). They are not guesses about
  // what might be needed; they are the recorded answer to what this exact set requires.
  //
  // (1) `jiti` STAYS EXTERNAL, AND STAYS DEAD. It is the lazy import inside eslint's
  //     config-file loader. Our runtime path is `new Linter().verify(...)` only
  //     (`packages/fe-analyzer-engine/src/scanner/collectors/jsx-a11y-lint.ts`), which never
  //     touches the loader, so the unresolved import may sit in code that cannot execute. The
  //     alternative — inlining jiti — pulls a whole second transpiler into the bundle to
  //     support a path we do not take. `jiti/package.json` is listed too because the loader
  //     reads its own manifest.
  external: ["jiti", "jiti/package.json"],
  // (2) THE CJS-GLOBALS BANNER. ts-morph/typescript, eslint and postcss are CJS: they
  //     `require()` node builtins at runtime and TypeScript's `sys` reads `__filename` during
  //     module initialisation — before any of our code runs, so a lazy shim would be too late.
  //     An ESM bundle has none of the three, and the standard way to supply them is this
  //     six-line prologue. Without it the bundle dies at import with
  //     `ReferenceError: __filename is not defined` and never reaches `main`.
  banner: [
    'import { createRequire as __feCreateRequire } from "node:module";',
    'import { fileURLToPath as __feFileURLToPath } from "node:url";',
    'import { dirname as __feDirname } from "node:path";',
    "const require = __feCreateRequire(import.meta.url);",
    "const __filename = __feFileURLToPath(import.meta.url);",
    "const __dirname = __feDirname(__filename);",
  ].join("\n"),
  // EVERY `@smart-tools/*` package, not just one: the chain is
  // cli -> fe-pixso -> {fe-cli-kit, pixso-core}, and inlining only the first link would leave
  // a runtime import of the rest behind — which is precisely what this target exists to
  // avoid (design 2.1:66-68). pixso-core's exports map is `.` + `./node`, so the subpath must
  // be matched too.
  noExternal: [/^@smart-tools\/(.*)$/],
  // tsdown >=0.20's bundled-dependency check: the declared, complete set of third parties the
  // bundle is ALLOWED to inline — pixso-core's runtime deps plus their sub-dependencies,
  // copied verbatim from `ru-code-packages/packages/pixso-cli/tsdown.config.ts:19-30`.
  // Anything new entering the bundle errors loudly by design; never widen this list without
  // knowing which import dragged the newcomer in.
  inlineOnly: [
    // Added beyond pixso-cli's verbatim list, and REQUIRED here for a reason that is a direct
    // consequence of this package's zero-dependency publish shape. tsdown's bundled-dependency
    // check offers three ways to legitimize inlining a package found in node_modules: list it in
    // `inlineOnly`, declare it a production dependency, or externalize it. `pixso-cli` takes the
    // second route — `@smart-tools/pixso-core` is a real `dependencies` entry of that package
    // (`ru-code-packages/packages/pixso-cli/package.json:19-21`), so it never needed the first.
    // This package deliberately has NO `dependencies` key at all (design 2.1:59-60): everything
    // is a devDependency precisely so the published manifest declares zero runtime deps. That
    // closes route two, and externalizing would defeat the single-file target, so the engine is
    // named here instead. Reached through `packages/fe-pixso`, which is the only module in the
    // repo that imports it.
    "@smart-tools/pixso-core",
    "zod",
    "@modelcontextprotocol/sdk",
    "ajv",
    "fast-deep-equal",
    "json-schema-traverse",
    "fast-uri",
    "ajv-formats",
    "pkce-challenge",
    "eventsource-parser",
    "undici",
    // ── THE h4 ANALYZER CLOSURE (brief B4 deliverable 3) ──────────────────────────────────
    //
    // Everything below entered the bundle with `packages/fe-project-report`, which reaches
    // `fe-source` (node builtins only — it contributes NOTHING here), `fe-analyzer-report`
    // (a template STRING, so it has no runtime dependency of its own either) and
    // `fe-analyzer-engine`, whose nine production dependencies
    // (`packages/fe-analyzer-engine/package.json:21-31`) drag the rest in transitively:
    // eslint + eslint-plugin-jsx-a11y + typescript-eslint and their closure, ts-morph +
    // typescript, postcss + postcss-scss, aria-query, ignore.
    //
    // THE LIST IS THE BUILD'S OWN OUTPUT, NOT A GUESS. Every name was emitted by tsdown's
    // bundled-dependency check as `<name> is located in node_modules but is not included in
    // inlineOnly option`, each with the importing file printed beside it; the run that
    // produced them is recorded in `WORKFLOW/features/hackathon-analys/logs/b4.md`. That is
    // what keeps the list's promise intact — it still errors loudly on a newcomer, because
    // nothing here was added speculatively.
    //
    // `zod` is NOT repeated: it is already listed above, shared by pixso-core and the engine.
    // `jiti` is deliberately ABSENT — it is `external`, see the top of this file.
    //
    // X3 ADDED NOTHING HERE, and that is a result rather than an oversight.
    // `packages/fe-project-report` now statically imports `@smart-tools/fe-eds-adapter`, which
    // is matched by the `noExternal` pattern above and whose own third-party surface is `zod`
    // (already listed) — its 5.6 MB of `dist` is artifacts and its own code, not packages. The
    // build was re-run from clean and the bundled-dependency check emitted no
    // `is located in node_modules but is not included in inlineOnly option` line, which is the
    // same diagnostic that produced the 154 names below. The bundle grew 16 051 732 ->
    // 20 044 687 bytes; the guard that watches that number is
    // `cli/tests/project-report.integration.test.ts`, raised in the same change.
    "acorn",
    "acorn-jsx",
    "aria-query",
    "array-includes",
    "array.prototype.flat",
    "array.prototype.flatmap",
    "axe-core",
    "axobject-query",
    "balanced-match",
    "brace-expansion",
    "braces",
    "call-bind",
    "call-bind-apply-helpers",
    "call-bound",
    "callsites",
    "code-block-writer",
    "concat-map",
    "damerau-levenshtein",
    "debug",
    "define-data-property",
    "define-properties",
    "dunder-proto",
    "emoji-regex",
    "es-abstract",
    "es-abstract-get",
    "escape-string-regexp",
    "es-define-property",
    "es-errors",
    "eslint",
    "@eslint-community/eslint-utils",
    "@eslint-community/regexpp",
    "@eslint/config-array",
    "@eslint/eslintrc",
    "@eslint/js",
    "@eslint/object-schema",
    "eslint-plugin-jsx-a11y",
    "@eslint/plugin-kit",
    "eslint-scope",
    "eslint-visitor-keys",
    "es-object-atoms",
    "espree",
    "esquery",
    "esrecurse",
    "es-shim-unscopables",
    "es-to-primitive",
    "estraverse",
    "esutils",
    "fast-glob",
    "fast-json-stable-stringify",
    "fastq",
    "fdir",
    "file-entry-cache",
    "fill-range",
    "find-up",
    "flat-cache",
    "flatted",
    "function-bind",
    "get-intrinsic",
    "get-proto",
    "globals",
    "glob-parent",
    "gopd",
    "has-flag",
    "hasown",
    "has-property-descriptors",
    "has-proto",
    "has-symbols",
    "has-tostringtag",
    "@humanfs/core",
    "@humanfs/node",
    "@humanwhocodes/retry",
    "ignore",
    "import-fresh",
    "imurmurhash",
    "internal-slot",
    "is-callable",
    "is-date-object",
    "is-extglob",
    "is-glob",
    "is-number",
    "is-regex",
    "is-string",
    "is-symbol",
    "json-buffer",
    "json-stable-stringify-without-jsonify",
    "jsx-ast-utils",
    "keyv",
    "language-subtag-registry",
    "language-tags",
    "levn",
    "locate-path",
    "lodash.merge",
    "math-intrinsics",
    "merge2",
    "micromatch",
    "minimatch",
    "ms",
    "nanoid",
    "natural-compare",
    "@nodelib/fs.scandir",
    "@nodelib/fs.stat",
    "@nodelib/fs.walk",
    "object.assign",
    "object.fromentries",
    "object-inspect",
    "object-keys",
    "object.values",
    "parent-module",
    "path-browserify",
    "path-exists",
    "picocolors",
    "picomatch",
    "p-limit",
    "p-locate",
    "postcss",
    "postcss-scss",
    "prelude-ls",
    "queue-microtask",
    "resolve-from",
    "reusify",
    "run-parallel",
    "safe-regex-test",
    "semver",
    "set-function-length",
    "set-proto",
    "side-channel",
    "side-channel-list",
    "side-channel-map",
    "side-channel-weakmap",
    "source-map-js",
    "string.prototype.includes",
    "string.prototype.trim",
    "strip-json-comments",
    "supports-color",
    "tinyglobby",
    "to-regex-range",
    "ts-api-utils",
    "ts-morph",
    "@ts-morph/common",
    "type-check",
    "typescript",
    "typescript-eslint",
    "@typescript-eslint/eslint-plugin",
    "@typescript-eslint/parser",
    "@typescript-eslint/project-service",
    "@typescript-eslint/scope-manager",
    "@typescript-eslint/tsconfig-utils",
    "@typescript-eslint/types",
    "@typescript-eslint/typescript-estree",
    "@typescript-eslint/type-utils",
    "@typescript-eslint/utils",
    "@typescript-eslint/visitor-keys",
    "uri-js",
    "yocto-queue",
  ],
  /**
   * ONE FILE, INCLUDING THE DYNAMIC IMPORTS — the third thing the analyzer closure needed, and
   * the one the esbuild recipe got for free.
   *
   * eslint reaches its filesystem abstraction through `await import("@humanfs/node")`. Rolldown
   * code-splits on a dynamic import by default, so the first successful build emitted THREE
   * files: `main.mjs` plus `src-*.mjs` (`@humanfs/node`) and the `chunk-*.mjs` they share —
   * with `main.mjs` importing `./src-*.mjs` by relative path. That is not a self-contained
   * bundle: copy `main.mjs` alone into a bare directory, as `bundle.integration.test.ts` and
   * every user does, and the import has nothing to resolve against.
   *
   * esbuild never had this problem because it splits only under `splitting: true`, which
   * `hackathon2026/ds-analyzer/scripts/build-skills.ts:46-79` does not set — so a dynamic
   * import there is inlined into the one `outfile`. `codeSplitting: false` is rolldown's
   * spelling of the same decision (its `OutputOptions` doc: "Inline all dynamic imports into a
   * single bundle"), and it is what keeps `dist/` at exactly one file. The publish-shape test
   * asserts that file list independently (`cli/tests/publish.integration.test.ts:125-129`).
   */
  outputOptions: { codeSplitting: false },
  // BUILD-TIME VERSION INJECTION. `define` is a textual identifier replacement performed during
  // the build (tsdown 0.20.3 `dist/types-CNIFJKMX.d.mts:725`), so `__FE_VERSION__` in
  // `src/version.ts` becomes the quoted literal below and the surrounding `typeof` guard folds
  // away under `minify`. No `package.json` read survives into `dist/main.mjs`.
  define: { __FE_VERSION__: JSON.stringify(version) },
  minify: true,
  sourcemap: false,
  clean: true,
  outDir: "dist",
});
