/**
 * A `CommandContext` with its two output streams captured.
 *
 * The frozen contract's whole point is that `env`, `stdout` and `stderr` are INJECTED — "a
 * command runs unchanged in a test with zero process access"
 * (`packages/cli-kit/src/index.ts:44-46`). This helper is that sentence made usable: the
 * suites assert on `out`/`err` and never touch `process`.
 *
 * Defaults are the product's: `lang: "ru"`, because ru is the product default
 * (`WORKFLOW/features/initial-analysis/plans/2.1-design.md:127-128`) and a test that had to
 * spell the default out every time would stop noticing if it changed.
 */
import type { CommandContext, Lang } from "@smart-tools/fe-cli-kit";

export interface TestContext {
  readonly ctx: CommandContext;
  /** Everything written to stdout, in order. */
  readonly out: string[];
  /** Everything written to stderr, in order. */
  readonly err: string[];
}

export interface ContextOptions {
  readonly source?: string | undefined;
  readonly out?: string | undefined;
  readonly lang?: Lang;
  readonly env?: Record<string, string | undefined>;
  readonly flags?: Record<string, string | boolean | undefined>;
}

export function makeContext(options: ContextOptions = {}): TestContext {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: CommandContext = {
    source: options.source,
    out: options.out,
    lang: options.lang ?? "ru",
    env: options.env ?? {},
    flags: options.flags ?? {},
    stdout: (s: string) => {
      out.push(s);
    },
    stderr: (s: string) => {
      err.push(s);
    },
  };
  return { ctx, out, err };
}
