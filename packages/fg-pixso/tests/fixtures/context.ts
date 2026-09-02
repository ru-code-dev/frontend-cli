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
import type { CommandContext, CommandUi, Lang, Localized } from "@smart-tools/fg-cli-kit";
import { pick } from "@smart-tools/fg-cli-kit";

export interface TestContext {
  readonly ctx: CommandContext;
  /** Everything written to stdout, in order. */
  readonly out: string[];
  /** Everything written to stderr, in order. */
  readonly err: string[];
  /**
   * Everything the command said to the terminal UI, in order, as `verb:payload` lines.
   *
   * A RECORDER rather than `silentUi`, because the header, the phases and the summary block a
   * command announces are now its behaviour and a fixture that threw them away would leave that
   * behaviour untestable. Nothing here renders: the escapes, the bar and the block are
   * `cli-kit`'s to draw and `packages/cli-kit/tests/ui.test.ts`'s to prove.
   */
  readonly ui: string[];
}

export interface ContextOptions {
  /**
   * The working directory the command resolves its default output against. REQUIRED, with no
   * default, and that is deliberate: `-o` is optional for every command now, so EVERY run of
   * one writes a file somewhere, and a fixture that quietly defaulted to `process.cwd()` would
   * scatter `fg-out/` into the repository the first time somebody forgot. Making it an argument
   * with no default means a test cannot run a command without having said where it may write.
   */
  readonly cwd: string;
  readonly source?: string | undefined;
  readonly out?: string | undefined;
  readonly lang?: Lang;
  readonly env?: Record<string, string | undefined>;
  readonly flags?: Record<string, string | boolean | undefined>;
  /**
   * Is stdout a terminal? DEFAULTS TO FALSE — the piped lane — because that is the lane whose
   * bytes a test can meaningfully assert on, and because U3 makes the two lanes genuinely
   * different: on a terminal `emitPaths` writes NOTHING to stdout
   * (`packages/cli-kit/src/out.ts`). A case that wants to prove that passes `true`.
   */
  readonly stdoutIsTTY?: boolean;
  readonly verbose?: boolean;
}

export function makeContext(options: ContextOptions): TestContext {
  const out: string[] = [];
  const err: string[] = [];
  const ui: string[] = [];
  const lang: Lang = options.lang ?? "ru";
  const say = (message: Localized): string => pick(message, lang);
  let ended = false;
  const recorder: CommandUi = {
    header: (parts) => void ui.push(`header:${parts.map(say).join(" · ")}`),
    phase: (label, detail) =>
      void ui.push(`phase:${say(label)}${detail === undefined ? "" : ` (${say(detail)})`}`),
    progress: (done, total, unit) =>
      void ui.push(
        `progress:${String(done)}/${String(total)}${unit === undefined ? "" : ` ${say(unit)}`}`,
      ),
    // `end` seals the phase in flight without printing a block (design §2.3). Recorded, because
    // WHEN it is called is the assertion: it must land before anything reaches stdout
    // (V5 finding #2).
    end: (detail) => void ui.push(`end${detail === undefined ? "" : `:${say(detail)}`}`),
    note: (message) => void ui.push(`note:${say(message)}`),
    warn: (message) => void ui.push(`warn:${say(message)}`),
    summary: (summary) => {
      ended = true;
      const rows = summary.rows
        .map(
          (row) => `${say(row.key)}=${typeof row.value === "string" ? row.value : say(row.value)}`,
        )
        .join(" ");
      ui.push(`summary:${say(summary.headline)}${rows === "" ? "" : ` [${rows}]`}`);
    },
    fail: (message, hint, detail) => {
      ended = true;
      ui.push(
        `fail:${say(message)}${detail === undefined ? "" : ` <${say(detail)}>`}` +
          `${hint === undefined ? "" : ` [${hint.usage}|${hint.help}]`}`,
      );
    },
    ended: () => ended,
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
    stdoutIsTTY: options.stdoutIsTTY ?? false,
    verbose: options.verbose ?? false,
    ui: recorder,
  };
  return { ctx, out, err, ui };
}
