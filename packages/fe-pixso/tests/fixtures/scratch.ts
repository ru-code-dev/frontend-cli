/**
 * A scratch directory per test, and the reason every suite in this package now needs one.
 *
 * `-o` became optional on all four commands, so a command that used to print to stdout now
 * WRITES — to `./fe-out/pixso/…` under whatever the context calls its cwd. A suite that let
 * that be `process.cwd()` would leave `fe-out/` inside the repository, and two tests running in
 * parallel would race over the same filename. So `CommandContext.cwd` is an injected scratch
 * directory in every case, and `ContextOptions.cwd` has no default to make forgetting impossible
 * (`packages/fe-pixso/tests/fixtures/context.ts`).
 *
 * `mkdtemp` under `os.tmpdir()` rather than `@smart-tools/fe-testkit`: that package is a
 * devDependency of `cli` and of nothing under `packages/`, and taking on a workspace edge for
 * two lines `node:fs` already provides is the trade
 * `packages/fe-project-report/tests/harness.ts:4-10` declines for the same reason.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A fresh directory. The caller removes it — {@link disposeScratch} is the pair. */
export function scratch(): string {
  return mkdtempSync(join(tmpdir(), "fe-pixso-"));
}

/** Remove a scratch directory and everything under it. Safe to call twice. */
export function disposeScratch(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
