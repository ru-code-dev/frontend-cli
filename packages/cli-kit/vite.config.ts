import { defineProject, type TestProjectInlineConfiguration } from "vite-plus/test/config";
import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

/**
 * The package's TIER-1 lane. Same `vp test` / `vite-plus/test` stack every package in
 * `ru-code-packages` runs (`ru-code-packages/packages/pixso-cli/vite.config.ts:1-32`).
 *
 * `exclude` carries the repo-wide split: `*.integration.test.ts` is TIER 2 and never runs in
 * `pnpm test` (design 2.1:147-163). Only `cli` owns tier-2 files today, but the exclusion is
 * stated in every package so a feature package that grows one cannot slow the default run by
 * accident.
 *
 * `passWithNoTests: false` is the point of naming the project at all: a package whose tests
 * were all deleted must go RED, not green — the lesson `pixso-cli`'s own config records
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

export default defineConfig(() => ({ test: { projects: [defineProject(unitTestProject)] } }));
