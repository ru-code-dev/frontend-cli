/**
 * `@smart-tools/fg-cli-kit` — THE FROZEN CONTRACT.
 *
 * Everything every other package in this repo builds against lives in this one file: the
 * command shape, the context a command runs in, and the localization primitive. It holds
 * types and pure helpers ONLY — no pixso knowledge, no I/O, no node builtins, no runtime
 * dependency of any kind. A feature package (`fg-pixso`, and whatever follows it) depends on
 * this; this depends on nothing, so it can never be the reason two features disagree.
 *
 * Multilingual UX is a contract-level fact, not a rendering detail: the design fixes
 * `fg --lang ru|en` with a DEFAULT of `ru` and requires that every user-facing string — help,
 * command summaries, argument descriptions, errors — be localized
 * (`WORKFLOW/features/initial-analysis/plans/2.1-design.md:127-132`). That is why the
 * metadata fields below are `Localized` rather than `string`: a command that ships only an
 * English summary cannot be constructed.
 *
 * TWO THINGS ARE NOT IN THIS FILE, and both are re-exported below so the package still has
 * exactly one entry point (`package.json`'s `exports` map lists only `"."`).
 *
 * The terminal UI — the header, the live progress line, the summary block — lives in `./ui.ts`,
 * because it is a RENDERER and this file is the contract. What the contract owns is the seam:
 * `CommandContext.ui`, typed as {@link CommandUi}, so a command can announce a phase — or
 * remark on something non-fatal — without knowing whether anything is drawing it.
 *
 * The output contract — where files go when `-o` was not given, and the shape of the sentence
 * that reports them — lives in `./out.ts`. Same split for the same reason: this file fixes
 * `CommandContext.cwd` and `CommandContext.out`, which is the seam; `out.ts` holds the shared
 * vocabulary (`FG_OUT_DIR`, `safeSegment`, `emitPaths`) every command builds its answer from.
 */
export { FG_OUT_DIR, emitPaths, safeSegment } from "./out.ts";
export type {
  CommandUi,
  Summary,
  SummaryRow,
  TerminalUi,
  UiCapability,
  UiOptions,
  UiStream,
  UsageHint,
} from "./ui.ts";
export {
  ANSI,
  capabilityOf,
  createUi,
  formatElapsed,
  liveLine,
  phaseRow,
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
  /**
   * The placeholder the help shows, e.g. `<url|guid>`.
   *
   * `Localized` OR a plain `string`, and both are right for different arguments. Design §2.7
   * spells the ru page's placeholders in Russian (`<путь|repo>`, `-o <путь>`, `--config <файл>`)
   * while a flag's VALUE LIST (`--format html|compact|json|sarif`) is the same text in both
   * languages and would be a shape whose halves drift if it had to be written twice. A `string`
   * therefore reads as "identical in both languages" — which is what every one of them was
   * before this field carried a language at all (V5 finding #12).
   */
  readonly name: Localized | string;
  /** The full sentence, printed on the PER-COMMAND page (`fg --help --preport`, design 2.8). */
  readonly description: Localized;
  /**
   * The ONE-LINE form, printed as an indented row under the command in the main `fg --help`
   * table (design 2.7's `--format html|compact|json|sarif   несколько через запятую …`).
   *
   * Optional, and its absence means "do not show this argument in the main table" — which is
   * the right answer for a positional and for `-o`, both of which the page already explains
   * elsewhere. It exists because the main table is a TABLE: `description` is a paragraph, and
   * the diagnosis this redesign answers records what happens when paragraphs are pasted into
   * one (`plans/current-output.txt`: a 160-column usage line, the same three lines four times).
   */
  readonly hint?: Localized | undefined;
  readonly required: boolean;
}

/**
 * A HEADING IN `fg --help`, carried by the commands themselves — design 2.7/3.
 *
 * The help does not hold a list of groups: it collects the `group` off every registered command,
 * de-duplicates by `id` and sorts by `order`. So a feature package introduces a section by
 * shipping one, and a section with no commands cannot exist. Two packages that share an `id`
 * share the section, which is how `--preport`, `--iconf` and `--pkit` land under one heading
 * while living in one package and `--psvg` lands under another.
 */
export interface CommandGroup {
  readonly id: string;
  readonly title: Localized;
  /** Ascending. Ties break on first appearance in the registry. */
  readonly order: number;
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
   * {@link FG_OUT_DIR}, relative to {@link CommandContext.cwd}, and the run reports the
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
   * Is STDOUT a terminal? Injected, never read from `process`, for the reason every other field
   * here is: a command must behave identically in a test.
   *
   * It is a CONTRACT field rather than a detail because U3 hangs on it — the absolute paths a
   * run wrote go to stdout only when stdout is piped — and `emitPaths` (`./out.ts`) is the one
   * reader of it.
   */
  readonly stdoutIsTTY: boolean;
  /** `--verbose`, the global switch that turns short messages into explained ones (design U5). */
  readonly verbose: boolean;
  /**
   * HOW MANY COLUMNS STDOUT HAS, or `undefined` when it is not a terminal.
   *
   * A contract field rather than a private channel between two first-party packages: it used to
   * travel as `FG_STDOUT_COLUMNS` inside `ctx.env`, which put a key in the environment namespace
   * that appears in no help text, no README and no `--help` `Окружение` line — so a user who set
   * it themselves was silently overridden, and the two packages agreed on a spelling rather than
   * on a type (V5 finding #15). `--format compact` right-flushes its rule ids to this width
   * (design §2.4); absent is a real answer, and the one a pipe gives.
   */
  readonly columns?: number | undefined;
  /**
   * `--format`'s comma list, TOKENIZED and split by the CLI and nothing more: the values are not
   * validated here and neither is the question of which command may accept them. That belongs to
   * the command that declares the flag, which is the only place that knows its own formats.
   */
  readonly formats?: readonly string[] | undefined;
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
 * A registry entry. The surface is flag-style (`fg --get-pixso-svg <src>`, design 2.1:84-93),
 * so `flag` is the full spelling including its leading dashes and `alias` is the short form.
 *
 * `run` returns the process exit code rather than calling `process.exit`, which is what makes
 * the whole registry testable in-process (design 2.1:150-153).
 */
export interface CliCommand {
  readonly flag: string;
  /**
   * The SHORT spelling — and the DISPLAY NAME in `fg --help` (design U8). The long `flag` stays
   * accepted everywhere and appears on the per-command page; a table whose first column is
   * `--get-pixso-prompt, --pprompt` is the table the owner called unreadable.
   */
  readonly alias?: string | undefined;
  /** Which section of `fg --help` this command appears under. */
  readonly group: CommandGroup;
  /** ONE short line for the help table. The design budgets it 40 columns. */
  readonly summary: Localized;
  /**
   * The `без -o →` column: where this command writes when `-o` was not given.
   *
   * `null` for a command that takes no `-o` at all and whose destination is therefore not a
   * user's choice; a `Localized` otherwise, because the fixed locations differ per language
   * only in the placeholder inside them (`<имя>` / `<name>`).
   */
  readonly defaultOut: Localized | null;
  /** The paragraph `fg --help --<command>` prints under the usage line (design 2.8). */
  readonly details?: Localized | undefined;
  /** Command lines printed verbatim under `Примеры` on the per-command page. */
  readonly examples?: readonly string[] | undefined;
  readonly args: readonly ArgSpec[];
  run(ctx: CommandContext): Promise<number>;
}

/**
 * The two pointer lines a failure prints (design 2.6), BUILT FROM THE COMMAND ITSELF.
 *
 * One builder, so the usage line a refusal quotes is the same surface the help documents — the
 * alias first because that is the spelling the help teaches, then the arguments exactly as the
 * help renders them (required bare, optional in brackets).
 */
/** An argument's placeholder in the language in play. A plain `string` is the same in both. */
export function argName(arg: ArgSpec, lang: Lang): string {
  return typeof arg.name === "string" ? arg.name : pick(arg.name, lang);
}

/**
 * ONE USAGE LINE, FOR EVERY PLACE THAT QUOTES ONE — design §2.6, §2.7 and §2.8.
 *
 * There used to be two builders and they disagreed in the same session: cli-kit's spelled
 * `fg --preport <path|repo> …` for a refusal and `cli/src/help.ts`'s spelled
 * `fg --preport, --project-report <path|repo> [-o <path>] [--format html|compact|json|sarif]
 * [--ui-kit eds|none] [--config <file>]` — 127 columns — for the help page and for every
 * `--format` refusal (V5 findings #5 and #8). This is the one that stays.
 *
 * THE ELISION RULE, which is what keeps the line inside §2.7's 100 columns: a long flag that
 * takes a value prints as `--format …`, because its accepted values are already a row of their
 * own on the help page and repeating them here is what made the line 127 wide. Everything else
 * — the positional, a short flag, a long flag with no value — prints verbatim. That is §2.8's
 * spelling exactly: `fg --preport <путь|repo> [-o <путь>] [--format …] [--ui-kit …]
 * [--config …]`.
 *
 * The DISPLAY NAME is the short alias (U8), alone: the long spelling is a second line on the
 * help page (`также: --project-report`), not a second column in every refusal.
 */
export function usageLineOf(command: CliCommand, lang: Lang, bin = "fg"): string {
  const name = command.alias ?? command.flag;
  const args = command.args
    .map((arg) => {
      const spelled = elide(argName(arg, lang));
      return arg.required ? spelled : `[${spelled}]`;
    })
    .join(" ");
  return args === "" ? `${bin} ${name}` : `${bin} ${name} ${args}`;
}

/** `--format html|compact|json|sarif` → `--format …`; everything else is left alone. */
function elide(name: string): string {
  const at = name.indexOf(" ");
  if (at < 0 || !name.startsWith("--")) return name;
  return `${name.slice(0, at)} …`;
}

/**
 * The two pointer lines a failure prints (design §2.6), BUILT FROM THE COMMAND ITSELF.
 *
 * One builder — {@link usageLineOf} — so the usage line a refusal quotes is the same surface the
 * help documents, in the same spelling, in the language the run is speaking.
 */
/**
 * THE RUNTIME-FAILURE HINT — design §2.6's second block, and V5 finding #4.
 *
 * `✖ <what failed>` and ONE pointer row: the line the user just typed, with `--debug` on the
 * end. NO usage row — the invocation was accepted, so there is nothing about it to correct.
 *
 * It lives here, beside {@link usageHintOf}, because it was the CLI's alone: a command that
 * caught its own runtime error (a path that does not exist, a clone that failed, a disk that
 * refused the write) returned exit 1 having printed the `✖` line and NOTHING else, while a
 * command that let the error escape got the pointer row from `cli/src/main.ts`. Two shapes for
 * one kind of failure, decided by which of them threw.
 */
export function debugHintOf(command: CliCommand, bin = "fg"): { usage: string; help: string } {
  return { usage: "", help: `${bin} ${command.alias ?? command.flag} … --debug` };
}

export function usageHintOf(
  command: CliCommand,
  lang: Lang = "ru",
  bin = "fg",
): { usage: string; help: string } {
  return {
    usage: usageLineOf(command, lang, bin),
    help: `${bin} --help ${command.alias ?? command.flag}`,
  };
}
