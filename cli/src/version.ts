/**
 * `--version`, resolved at BUILD TIME.
 *
 * The requirement is that the shipped `dist/main.mjs` never reads `package.json` at runtime:
 * the published tarball is `package.json` + `dist/main.mjs` and nothing else
 * (`cli/package.json:8-10`), a user may copy the single file anywhere, and a bundle that
 * `readFileSync`s its own manifest breaks the moment it is moved. So the version arrives as a
 * literal substituted into the source text by the bundler.
 *
 * MECHANISM: tsdown's `define` (`Record<string, string>`, tsdown 0.20.3
 * `dist/types-CNIFJKMX.d.mts:725`) is a textual identifier replacement performed during the
 * build. `cli/tsdown.config.ts` reads `cli/package.json` — in the BUILD process, not the
 * bundled program — and maps `__FE_VERSION__` to the JSON-quoted version. `cli/vite.config.ts`
 * declares the identical `define` so the unit suite sees the same literal and can assert the
 * two agree.
 *
 * The `typeof` guard is what makes that safe rather than clever. `define` rewrites the
 * identifier wherever it appears, `typeof` included, so after substitution the whole expression
 * folds to the literal and the fallback branch is dead code the minifier drops. If a future
 * config ever forgets the `define`, `typeof` on an undeclared identifier is legal JavaScript
 * that yields `"undefined"` — the CLI reports `0.0.0-dev` instead of throwing a ReferenceError
 * at import time. Degrading loudly-but-alive beats a bin that cannot start.
 */

/**
 * Injected by the bundler. Declared `| undefined` because the un-substituted case is real (see
 * the header) and the type must admit it; `declare` is type-only, so it erases cleanly under
 * `erasableSyntaxOnly` (`tsconfig.base.json`).
 */
declare const __FE_VERSION__: string | undefined;

/** The version `--version` prints. A literal in the built bundle — never a filesystem read. */
export const CLI_VERSION: string =
  typeof __FE_VERSION__ === "string" ? __FE_VERSION__ : "0.0.0-dev";
