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

/**
 * TIER-2 lane — `bash install`'s rc half against ru-code's REAL installer
 * (`vendor/ru-code/install`, the fresh HEAD build `bash install` ships as `ru-code-install`), in
 * real bash and zsh, inside scratch HOMEs. Serial: each case owns a sandbox HOME and spawns shells.
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
