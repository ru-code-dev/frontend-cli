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
import type { CommandContext, CommandUi, Lang, Localized } from "@smart-tools/fe-cli-kit";
import { pick } from "@smart-tools/fe-cli-kit";

export interface TestContext {
  readonly ctx: CommandContext;
  /** Everything written to stdout, in order. */
  readonly out: string[];
  /** Everything written to stderr, in order. */
  readonly err: string[];
  /**
   * Everything the command said to the terminal UI, in order, as `verb:payload` lines.
   *
   * A RECORDER rather than `silentUi`, because the phases a command announces are now part of
   * its behaviour and a fixture that threw them away would leave that behaviour untestable.
   * Nothing here renders: the escapes, the bar and the card are `cli-kit`'s to draw and
   * `packages/cli-kit/tests/ui.test.ts`'s to prove.
   */
  readonly ui: string[];
}

export interface ContextOptions {
  /**
   * The working directory the command resolves its default output against. REQUIRED, with no
   * default, and that is deliberate: `-o` is optional for every command now, so EVERY run of
   * one writes a file somewhere, and a fixture that quietly defaulted to `process.cwd()` would
   * scatter `fe-out/` into the repository the first time somebody forgot. Making it an argument
   * with no default means a test cannot run a command without having said where it may write.
   */
  readonly cwd: string;
  readonly source?: string | undefined;
  readonly out?: string | undefined;
  readonly lang?: Lang;
  readonly env?: Record<string, string | undefined>;
  readonly flags?: Record<string, string | boolean | undefined>;
}

export function makeContext(options: ContextOptions): TestContext {
  const out: string[] = [];
  const err: string[] = [];
  const ui: string[] = [];
  const lang: Lang = options.lang ?? "ru";
  const say = (message: Localized): string => pick(message, lang);
  const recorder: CommandUi = {
    phase: (label) => void ui.push(`phase:${say(label)}`),
    progress: (done, total) => void ui.push(`progress:${String(done)}/${String(total)}`),
    done: (summary) => void ui.push(`done:${say(summary)}`),
    fail: (message) => void ui.push(`fail:${say(message)}`),
  };
  const ctx: CommandContext = {
    source: options.source,
    out: options.out,
    cwd: options.cwd,
    lang,
    env: options.env ?? {},
    flags: options.flags ?? {},
    stdout: (s: string) => {
      out.push(s);
    },
    stderr: (s: string) => {
      err.push(s);
    },
    ui: recorder,
  };
  return { ctx, out, err, ui };
}
