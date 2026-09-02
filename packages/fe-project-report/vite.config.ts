import { readFileSync } from "node:fs";

import { defineProject, type TestProjectInlineConfiguration } from "vite-plus/test/config";
import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

/**
 * The SAME `define` the bundler applies (`tsdown.config.ts`), so `src/adapters.ts` resolves to
 * a literal under the test runner too — and the suite can assert that the version the registry
 * reports IS the adapter package's, rather than assert against the `0.0.0-dev` fallback.
 */
const { version: edsAdapterVersion } = JSON.parse(
  readFileSync(new URL("../fe-eds-adapter/package.json", import.meta.url), "utf8"),
) as { version: string };

/**
 * TIER-1 lane — see the identical block in `packages/cli-kit/vite.config.ts` for the
 * reasoning. `*.integration.test.ts` is excluded here too: tier 2 is the on-demand run
 * (design 2.1:153-156).
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

export default defineConfig(() => ({
  define: { __FE_EDS_ADAPTER_VERSION__: JSON.stringify(edsAdapterVersion) },
  test: { projects: [defineProject(unitTestProject)] },
}));
