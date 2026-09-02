import { defineProject, type TestProjectInlineConfiguration } from "vite-plus/test/config";
import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

/**
 * TIER-1 lane — see `packages/cli-kit/vite.config.ts` for the reasoning behind the project
 * name, the `*.integration.test.ts` exclusion and `passWithNoTests: false`.
 *
 * `tests/**\/*.e2e.test.ts` is excluded for the same reason the integration suffix is, and for
 * one more that is specific to it: the e2e lane spawns pseudo-terminals and drives a headless
 * Chromium. `pnpm test` must stay BROWSER-FREE (brief s1 deliverable 2), and the only thing that
 * can guarantee that is the default project never matching the file that opens one.
 */
const unitTestProject = {
  extends: true,
  test: {
    name: "unit",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.integration.test.ts", "tests/**/*.e2e.test.ts"],
    fileParallelism: true,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    passWithNoTests: false,
  },
} satisfies TestProjectInlineConfiguration;

/**
 * TIER 3 — THE E2E LANE. `pnpm test:e2e`, and never anything else.
 *
 * It is a THIRD project rather than a second tier-2 suffix because what it needs is different
 * in kind: the real `cli/dist/fg.mjs`, a pseudo-terminal per row (`script -qec`), a fake MCP
 * socket, a `--parse-ui-kit` run that reaches the npm registry, and a headless Chromium that
 * turns every captured terminal state into a PNG. None of that belongs in `pnpm test`
 * (unit, no network, no browser) and none of it belongs in `pnpm test:integration` either,
 * which the owner runs on demand against the bundle alone.
 *
 * `fileParallelism: false` for the reason `cli/vite.config.ts:58` gives about tier 2 — this
 * lane binds a port, spawns PTYs and launches a browser, and running two such files at once is
 * how that turns flaky. The timeouts are long because ONE test here is the whole matrix: every
 * row, the gallery, ~40 element screenshots and two dashboard captures.
 *
 * `passWithNoTests: false`: a lane that cannot fail is not a lane
 * (`ru-code-packages/packages/pixso-cli/vite.config.ts:10-15`).
 */
const e2eTestProject = {
  extends: true,
  test: {
    name: "e2e",
    include: ["tests/**/*.e2e.test.ts"],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
    passWithNoTests: false,
  },
} satisfies TestProjectInlineConfiguration;

export default defineConfig(() => ({
  test: { projects: [defineProject(unitTestProject), defineProject(e2eTestProject)] },
}));
