/**
 * `@smart-tools/fe-cli-kit` — THE FROZEN CONTRACT.
 *
 * Everything every other package in this repo builds against lives in this one file: the
 * command shape, the context a command runs in, and the localization primitive. It holds
 * types and pure helpers ONLY — no pixso knowledge, no I/O, no node builtins, no runtime
 * dependency of any kind. A feature package (`fe-pixso`, and whatever follows it) depends on
 * this; this depends on nothing, so it can never be the reason two features disagree.
 *
 * Multilingual UX is a contract-level fact, not a rendering detail: the design fixes
 * `fe --lang ru|en` with a DEFAULT of `ru` and requires that every user-facing string — help,
 * command summaries, argument descriptions, errors — be localized
 * (`WORKFLOW/features/initial-analysis/plans/2.1-design.md:127-132`). That is why the
 * metadata fields below are `Localized` rather than `string`: a command that ships only an
 * English summary cannot be constructed.
 *
 * TWO THINGS ARE NOT IN THIS FILE, and both are re-exported below so the package still has
 * exactly one entry point (`package.json`'s `exports` map lists only `"."`).
 *
 * The terminal UI — the banner, the progress line, the final card — lives in `./ui.ts`, because
 * it is a RENDERER and this file is the contract. What the contract owns is the seam:
 * `CommandContext.ui`, typed as {@link CommandUi}, so a command can announce a phase — or
 * remark on something non-fatal — without knowing whether anything is drawing it.
 *
 * The output contract — where files go when `-o` was not given, and the shape of the sentence
 * that reports them — lives in `./out.ts`. Same split for the same reason: this file fixes
 * `CommandContext.cwd` and `CommandContext.out`, which is the seam; `out.ts` holds the shared
 * vocabulary (`FE_OUT_DIR`, `safeSegment`, `resultOf`) every command builds its answer from.
 */
export { FE_OUT_DIR, resultOf, safeSegment } from "./out.ts";
export type {
  CommandUi,
  PhaseRecord,
  TerminalUi,
  UiCapability,
  UiOptions,
  UiStream,
} from "./ui.ts";
export {
  ANSI,
  banner,
  capabilityOf,
  card,
  createUi,
  gradient,
  progressLine,
  silentUi,
  visibleWidth,
} from "./ui.ts";

import type { CommandUi } from "./ui.ts";

/** The two languages the CLI speaks. `ru` is the default (design 2.1:127-128). */
export type Lang = "ru" | "en";

/**
 * One user-facing string in both languages. Both are required — see the file header: the
 * type is the enforcement.
 */
export interface Localized {
  readonly ru: string;
  readonly en: string;
}

/** Resolve a `Localized` for the language in play. Total, pure, no fallback needed. */
export function pick(l: Localized, lang: Lang): string {
  return lang === "ru" ? l.ru : l.en;
}

/** One argument in a command's signature, as the generated help prints it. */
export interface ArgSpec {
  /** The placeholder the help shows, e.g. `<url|guid>`. */
  readonly name: string;
  readonly description: Localized;
  readonly required: boolean;
}

/**
 * Everything a command is handed. It is data, never a service locator: `env`, `stdout` and
 * `stderr` are injected so a command runs unchanged in a test with zero process access.
 *
 * `source` and `out` are spelled `| undefined` deliberately. Under this repo's
 * `exactOptionalPropertyTypes` (`tsconfig.base.json`, copied from
 * `ru-code-packages/tsconfig.base.json:13`) a bare `source?: string` REJECTS an explicit
 * `{ source: undefined }` — which is exactly what a parser that produces
 * `string | undefined` writes. The union keeps the property optional AND assignable.
 */
export interface CommandContext {
  /** The positional argument, when one was given: a design link, a node guid, or a path. */
  readonly source?: string | undefined;
  /**
   * The resolved `-o`/`--out` target, when one was given.
   *
   * OPTIONAL FOR EVERY COMMAND, by the owner's law: "`-o` must be optional; if not passed,
   * same-shape output that lists the saved files as absolute paths." So the absence of this
   * field is never a refusal — it selects the command's documented default under
   * {@link FE_OUT_DIR}, relative to {@link CommandContext.cwd}, and the run reports the
   * absolute paths either way.
   */
  readonly out?: string | undefined;
  /**
   * The directory relative paths resolve against — `process.cwd()` in the CLI's wiring.
   *
   * REQUIRED, and injected rather than read, for exactly the reason the streams are: a command
   * that called `process.cwd()` itself would be a command that cannot be pointed at a scratch
   * directory in a test without `chdir`-ing the whole runner, and `chdir` in a parallel suite is
   * a race between files. It became load-bearing when `-o` became optional everywhere: the
   * default output paths are cwd-relative, so "where is the cwd" is now an input to what a
   * command WRITES, not just to what it reads.
   */
  readonly cwd: string;
  readonly lang: Lang;
  readonly env: Record<string, string | undefined>;
  readonly flags: Readonly<Record<string, string | boolean | undefined>>;
  readonly stdout: (s: string) => void;
  readonly stderr: (s: string) => void;
  /**
   * THE TERMINAL UI — a command's channel for saying what it is doing while it does it.
   *
   * It is REQUIRED rather than optional, and that is the whole point: an optional `ui` would be
   * a field every command has to defend against with `?.`, and the first one to forget would
   * simply be the silent command. `silentUi` (`./ui.ts`) is the value a caller with nothing to
   * draw on passes, so "no UI" is a decision made once by the caller rather than a branch in
   * every command. (`CommandUi.note` is the one optional VERB, for the reason spelled out at
   * its declaration; the field itself stays required.)
   *
   * Whatever it draws goes to the UI's OWN stream — `stderr` in the CLI's wiring
   * (`cli/src/main.ts`) — never to `stdout`, which stays byte-for-byte the data a caller piped.
   */
  readonly ui: CommandUi;
}

/**
 * A registry entry. The surface is flag-style (`fe --get-pixso-svg <src>`, design 2.1:84-93),
 * so `flag` is the full spelling including its leading dashes and `alias` is the short form.
 *
 * `run` returns the process exit code rather than calling `process.exit`, which is what makes
 * the whole registry testable in-process (design 2.1:150-153).
 */
export interface CliCommand {
  readonly flag: string;
  readonly alias?: string | undefined;
  readonly summary: Localized;
  readonly args: readonly ArgSpec[];
  run(ctx: CommandContext): Promise<number>;
}
