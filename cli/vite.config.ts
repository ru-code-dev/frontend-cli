import { readFileSync } from "node:fs";

import { defineProject, type TestProjectInlineConfiguration } from "vite-plus/test/config";
import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

/**
 * The SAME `define` the bundler applies (`cli/tsdown.config.ts`), so `src/version.ts` resolves
 * to a literal under the test runner too.
 *
 * Without it the suite could not assert what it is asked to assert. `--version` must print the
 * version from `cli/package.json` and must do so from a build-time substitution rather than a
 * runtime file read; a test that read `package.json` itself and compared it to a `0.0.0-dev`
 * fallback would prove only that the fallback exists. With the define declared in both configs,
 * the test reads the manifest, the code carries the injected literal, and their agreement is the
 * proof the injection works.
 */
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

/**
 * THE TWO-TIER SPLIT, as a file pattern (design 2.1:147-163).
 *
 * The tiers are decided by filename and nothing else, so a suite lands in the right lane by
 * being named correctly and a reviewer can see which lane a file is in without opening it —
 * the same mechanism `pixso-core` uses for its corpus split
 * (`ru-code-packages/packages/pixso-core/vite.config.ts:20-49`, whose header calls the
 * suffix "the filesystem-visible proof").
 *
 *   `pnpm test`             -> `--project unit`        -> everything EXCEPT *.integration.test.ts
 *   `pnpm test:integration` -> `--project integration` -> ONLY *.integration.test.ts
 *
 * Both carry `passWithNoTests: false`: a check that cannot fail is not a check
 * (`ru-code-packages/packages/pixso-cli/vite.config.ts:10-15`).
 */
const unitTestProject = {
  extends: true,
  test: {
    name: "unit",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.integration.test.ts"],
    fileParallelism: true,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    passWithNoTests: false,
  },
} satisfies TestProjectInlineConfiguration;

/**
 * TIER 2. Reads `dist/`, spawns processes, and (from 3.4) opens a socket — so it is never in
 * the default run and always assumes `pnpm build` ran first.
 *
 * `fileParallelism: false`: these suites bind ports and copy the bundle around, and running
 * them concurrently is how that turns flaky. `pixso-core` makes the same call for its browser
 * lane (`ru-code-packages/packages/pixso-core/vite.config.ts:60`).
 */
const integrationTestProject = {
  extends: true,
  test: {
    name: "integration",
    include: ["tests/**/*.integration.test.ts"],
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 300_000,
    passWithNoTests: false,
  },
} satisfies TestProjectInlineConfiguration;

export default defineConfig(() => ({
  define: { __FE_VERSION__: JSON.stringify(version) },
  test: { projects: [defineProject(unitTestProject), defineProject(integrationTestProject)] },
}));
