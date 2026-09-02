import { defineProject, type TestProjectInlineConfiguration } from "vite-plus/test/config";
import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

/**
 * TIER-1 lane — see the identical block in `packages/cli-kit/vite.config.ts` for the reasoning.
 * `*.integration.test.ts` is excluded here too: tier 2 is the on-demand run (design 2.1:153-156).
 *
 * The parity suite is tier 1 despite being the acceptance test, because it compares against
 * goldens committed under `tests/golden/` and runs in well under a second. Only the suite that
 * *regenerates* those goldens by spawning the hackathon's own `ds.mjs` is tier 2, and only
 * because it needs a checkout that lives outside this repository.
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
 * TIER 2 — `tests/parity.integration.test.ts` only. It spawns `node ds.mjs` once per fixture
 * against a sibling checkout, so it is never in the default run.
 *
 * `fileParallelism: false` for the same reason `cli/vite.config.ts:60` gives: these suites shell
 * out and write to temporary directories, and running them concurrently is how that turns flaky.
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
  test: { projects: [defineProject(unitTestProject), defineProject(integrationTestProject)] },
}));
