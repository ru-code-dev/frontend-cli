/**
 * THE CLI's VERSION, resolved at BUILD TIME — the number a lint document stamps itself with.
 *
 * SARIF names the tool that produced it (`tool.driver.version`) and ESLint-shaped consumers
 * expect the same, so `formatLint` takes `tool: { name, version }` and something has to supply
 * it. Nothing may read a `package.json` at run time: the published artifact is one
 * `dist/fg.mjs` a user may copy anywhere (`cli/src/version.ts:1-12`), and a bundle that
 * `readFileSync`s its own manifest breaks the moment it is moved.
 *
 * MECHANISM: exactly the one `src/adapters.ts` already uses for the adapter package's number —
 * tsdown's `define`, a textual identifier replacement performed during the build. This package's
 * `tsdown.config.ts` reads `cli/package.json` — in the BUILD process, not in the bundled
 * program — and maps `__FG_VERSION__` to the JSON-quoted version; `vite.config.ts` declares the
 * identical `define` so the unit suite sees the same literal. It is the CLI's manifest rather
 * than this package's because the number belongs to the PRODUCT a user installed, and
 * `@smart-tools/fg-project-report` is private and never published.
 *
 * The `typeof` guard makes that safe rather than clever, for the reason `cli/src/version.ts`
 * gives in full: if a future config forgets the `define`, `typeof` on an undeclared identifier
 * is legal JavaScript that yields `"undefined"`, so the SARIF document says `0.0.0-dev` instead
 * of the process dying at import time.
 */

/** Injected by the bundler; `| undefined` because the un-substituted case is real. */
declare const __FG_VERSION__: string | undefined;

/** The version a `--lint` document reports as the tool that produced it. */
export const FG_VERSION: string = typeof __FG_VERSION__ === "string" ? __FG_VERSION__ : "0.0.0-dev";
