/**
 * PARSING — pure, total, and generated from the registry.
 *
 * Nothing here touches the process, the filesystem or the clock: `parseInvocation` takes an
 * argv and a command list and returns a description of what should happen. That is the whole
 * reason the tests can cover every alias, every exit code and both languages without spawning
 * anything (design 2.1:148-153, brief 3.3 deliverable 5).
 *
 * TOKENIZING IS NODE'S JOB. The design settles this explicitly: `util.parseArgs` for
 * "platform-stable parsing, not hand-rolled tokenizing", with our own registry/help layer on
 * top because the i18n requirement forces us to own the presentation regardless
 * (design 2.1:134-139). So this file translates the registry INTO a `parseArgs` options table
 * and translates `parseArgs`'s output back into an `Invocation` — and never inspects a `-` by
 * hand except in the one place Node cannot help (see `offendingToken`).
 */
import { parseArgs } from "node:util";

import type { CliCommand, Lang, Localized } from "@smart-tools/fe-cli-kit";

import { NO_COMMAND, TOO_MANY_COMMANDS, badFlagUsage, badLang, unknownFlag } from "./messages.ts";

/** Success. */
export const EXIT_OK = 0;
/** A command (or the engine) failed at runtime. */
export const EXIT_FAILURE = 1;
/** The invocation itself was wrong — `pixso-cli`'s convention (design 2.1:82). */
export const EXIT_USAGE = 2;

/** The language the CLI speaks when `--lang` says nothing. Owner-fixed (design 2.1:127). */
export const DEFAULT_LANG: Lang = "ru";

type ParseArgsOptions = NonNullable<Parameters<typeof parseArgs>[0]>["options"];
type OptionConfig = NonNullable<ParseArgsOptions>[string];

/**
 * The globals, spelled once (brief 3.3 deliverable 3).
 *
 * `--debug` is here but is deliberately absent from `HELP_GLOBAL_ORDER` below: it is the hidden
 * flag that turns a one-line error into a stack trace, useful to whoever is debugging and noise
 * to everyone else ("No stack traces to users except with `--debug` (hidden flag, not in
 * help)").
 */
const GLOBAL_OPTIONS = {
  out: { type: "string", short: "o" },
  token: { type: "string" },
  endpoint: { type: "string" },
  lang: { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  debug: { type: "boolean" },
} as const satisfies Record<string, OptionConfig>;

/** The globals `--help` prints, in the order it prints them. `debug` is not among them. */
export const HELP_GLOBAL_ORDER = ["out", "token", "endpoint", "lang", "help", "version"] as const;

/** Strip the leading dashes off a registry spelling: `--get-pixso-svg` -> `get-pixso-svg`. */
export function optionName(flag: string): string {
  return flag.replace(/^-+/, "");
}

/** A single-dash, single-character spelling — the only thing `parseArgs` accepts as `short`. */
function isShortSpelling(alias: string): boolean {
  return /^-[^-]$/.test(alias);
}

/**
 * Build the `parseArgs` options table FROM the registry. This is the "flags + aliases generated
 * from the registry" requirement in one function: a command that exists is parseable, a command
 * that does not exist is an unknown flag, and there is no second table to forget to update.
 *
 * Command flags are `multiple: true` so their values arrive as `boolean[]`. That is not
 * decoration — it is how the one-command rule is enforced exactly. Verified against node
 * v24.14.1: without `multiple`, `--psvg --psvg` collapses to `true` and the repetition is
 * invisible; with it, the value is `[true, true]` and the count is the literal number of times
 * the user typed a command flag, which is what "2+ -> error" is about.
 *
 * A feature package whose flag collides with a global keeps the GLOBAL's meaning — `out`,
 * `lang` and friends are the CLI's own surface and a feature cannot redefine them. This is a
 * registry bug rather than a user error, so it does not fail the invocation; the collided
 * command simply never matches, and `--help` still lists it, which is what surfaces the bug.
 */
export function optionsFor(commands: readonly CliCommand[]): ParseArgsOptions {
  const options: Record<string, OptionConfig> = { ...GLOBAL_OPTIONS };
  for (const command of commands) {
    const name = optionName(command.flag);
    const alias = command.alias;
    if (!(name in options)) {
      options[name] =
        alias !== undefined && isShortSpelling(alias)
          ? { type: "boolean", multiple: true, short: alias.slice(1) }
          : { type: "boolean", multiple: true };
    }
    if (alias !== undefined && !isShortSpelling(alias)) {
      const aliasName = optionName(alias);
      if (!(aliasName in options)) options[aliasName] = { type: "boolean", multiple: true };
    }
  }
  return options;
}

/**
 * How many times the user named this command — under either spelling.
 *
 * `--psvg --get-pixso-svg` counts 2, not 1. The rule the brief states is about FLAGS ("exactly
 * one command flag per invocation"), not about distinct commands, and counting flags is also
 * the more honest reading of the input: a user who typed two command flags did not know what
 * they wanted, even if the two happen to name the same thing, and silently picking one teaches
 * them nothing.
 */
function occurrences(values: Record<string, unknown>, command: CliCommand): number {
  const names = [optionName(command.flag)];
  if (command.alias !== undefined) names.push(optionName(command.alias));
  let total = 0;
  for (const name of names) {
    const value = values[name];
    if (Array.isArray(value)) total += value.length;
    else if (value === true) total += 1;
  }
  return total;
}

/**
 * `--lang`, read BEFORE the real parse.
 *
 * This exists because of an ordering trap that has exactly one honest fix. An unknown flag is
 * reported by a message that must be in the resolved language — but `parseArgs` THROWS on the
 * unknown flag, so by the time we could ask it for `--lang` there is no parse result to ask.
 * Pre-scanning argv for `--lang` is therefore not a shortcut around the parser; it is the only
 * way `fe --lang en --bogus` can answer in English.
 *
 * An unrecognized value falls back to the default here and is REPORTED by the real parse — this
 * function decides a language, it does not validate one, and duplicating the validation would
 * risk the two disagreeing.
 */
export function preresolveLang(argv: readonly string[]): Lang {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token === "--") break;
    if (token === "--lang") {
      const next = argv[i + 1];
      if (next === "en") return "en";
      if (next === "ru") return "ru";
      continue;
    }
    if (token.startsWith("--lang=")) {
      const value = token.slice("--lang=".length);
      if (value === "en") return "en";
      if (value === "ru") return "ru";
    }
  }
  return DEFAULT_LANG;
}

/**
 * Name the flag that `parseArgs` refused.
 *
 * `ERR_PARSE_ARGS_UNKNOWN_OPTION` carries no structured field for the offending spelling — only
 * an English sentence — and quoting an English sentence at a Russian user is precisely what the
 * localization requirement forbids. So the token is recovered from argv by the same rules
 * `parseArgs` used: everything after `--` is positional, `--name=value` is `name`, and a
 * single-dash run is a cluster of short options each of which must be known.
 *
 * Returns `undefined` when nothing looks unknown, and the caller then falls back to a message
 * that does not name a flag. Guessing a name would be worse than not printing one.
 */
function offendingToken(argv: readonly string[], options: ParseArgsOptions): string | undefined {
  const known = options ?? {};
  const shorts = new Set(
    Object.values(known)
      .map((o) => (o as { short?: string }).short)
      .filter((s): s is string => s !== undefined),
  );
  for (const token of argv) {
    if (token === "--") break;
    if (!token.startsWith("-") || token === "-") continue;
    if (token.startsWith("--")) {
      const name = optionName(token.split("=", 1)[0] ?? token);
      if (!(name in known)) return `--${name}`;
      continue;
    }
    for (const char of token.slice(1)) {
      if (!shorts.has(char)) return `-${char}`;
    }
  }
  return undefined;
}

/** What the user asked for. Every arm carries the language, so nothing downstream re-derives it. */
export type Invocation =
  /** Print the generated help. `exitCode` is 0 for an explicit `--help`, 2 for "no command". */
  | { readonly kind: "help"; readonly lang: Lang; readonly exitCode: number }
  /** Print the build-time version. */
  | { readonly kind: "version"; readonly lang: Lang }
  /** The invocation was wrong. `withHelp` prints the full help under the message. */
  | {
      readonly kind: "error";
      readonly lang: Lang;
      readonly message: Localized;
      readonly withHelp: boolean;
    }
  /** Run this command. */
  | {
      readonly kind: "command";
      readonly lang: Lang;
      readonly command: CliCommand;
      readonly source?: string | undefined;
      readonly out?: string | undefined;
      readonly endpoint?: string | undefined;
      readonly token?: string | undefined;
      readonly debug: boolean;
      readonly flags: Readonly<Record<string, string | boolean | undefined>>;
    };

/**
 * argv -> what to do. Never throws, never exits, never prints.
 *
 * Precedence among the meta-flags: `--help` beats `--version` beats everything, and both beat a
 * command flag — `fe --psvg X --help` explains itself instead of fetching, which is the reading
 * of `--help` that cannot surprise anyone. They are checked before the one-command rule so that
 * `fe --help` (zero commands) is a success rather than the "no command" error.
 */
export function parseInvocation(
  argv: readonly string[],
  commands: readonly CliCommand[],
): Invocation {
  const lang = preresolveLang(argv);
  const options = optionsFor(commands);

  let values: Record<string, unknown>;
  let positionals: readonly string[];
  try {
    const parsed = parseArgs({
      args: [...argv],
      options,
      strict: true,
      allowPositionals: true,
    });
    values = parsed.values as Record<string, unknown>;
    positionals = parsed.positionals;
  } catch (cause) {
    const code = (cause as { code?: string }).code;
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      const token = offendingToken(argv, options);
      return {
        kind: "error",
        lang,
        message: token === undefined ? badFlagUsage(detail) : unknownFlag(token),
        withHelp: false,
      };
    }
    // `ERR_PARSE_ARGS_INVALID_OPTION_VALUE` and anything else parseArgs decides to raise: a
    // known flag used wrongly (`--out` with no value, `--psvg=x`). Node's own sentence names the
    // option better than a generic message could, so it is quoted inside a localized frame.
    return { kind: "error", lang, message: badFlagUsage(detail), withHelp: false };
  }

  // `--lang` is validated here, once, against the value the parser actually produced.
  const rawLang = values["lang"];
  if (typeof rawLang === "string" && rawLang !== "ru" && rawLang !== "en") {
    return { kind: "error", lang, message: badLang(rawLang), withHelp: false };
  }

  if (values["help"] === true) return { kind: "help", lang, exitCode: EXIT_OK };
  if (values["version"] === true) return { kind: "version", lang };

  const selected = commands.filter((c) => occurrences(values, c) > 0);
  const total = commands.reduce((sum, c) => sum + occurrences(values, c), 0);

  // Zero commands: the help IS the answer, but the invocation was still incomplete, so it is
  // printed with exit 2 rather than 0 (brief 3.3 deliverable 3).
  if (total === 0) return { kind: "help", lang, exitCode: EXIT_USAGE };
  if (total > 1) {
    return { kind: "error", lang, message: TOO_MANY_COMMANDS, withHelp: true };
  }

  const command = selected[0];
  // Unreachable while `total === 1` implies one selected command; kept because narrowing an
  // array index to non-undefined under `noUncheckedIndexedAccess` must not be done with `!`.
  if (command === undefined) return { kind: "error", lang, message: NO_COMMAND, withHelp: true };

  const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

  return {
    kind: "command",
    lang,
    command,
    source: positionals[0],
    out: asString(values["out"]),
    endpoint: asString(values["endpoint"]),
    token: asString(values["token"]),
    debug: values["debug"] === true,
    // What the command sees in `ctx.flags`. Command-flag booleans are dropped: a command already
    // knows it is the one running, and `multiple: true` would otherwise hand it a `boolean[]`
    // that the frozen `CommandContext.flags` type (`string | boolean | undefined`) cannot hold.
    flags: {
      out: asString(values["out"]),
      token: asString(values["token"]),
      endpoint: asString(values["endpoint"]),
      lang,
      debug: values["debug"] === true,
    },
  };
}
