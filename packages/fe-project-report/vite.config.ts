import { defineProject, type TestProjectInlineConfiguration } from "vite-plus/test/config";
import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

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

export default defineConfig(() => ({ test: { projects: [defineProject(unitTestProject)] } }));
