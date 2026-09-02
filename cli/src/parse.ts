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

import {
  NO_COMMAND,
  TOO_MANY_COMMANDS,
  badFlagUsage,
  badLang,
  flagNotForCommand,
  unknownFlag,
} from "./messages.ts";

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
 * The options every invocation may carry, spelled once (brief 3.3 deliverable 3).
 *
 * TWO OF THEM ARE DELIBERATELY ABSENT FROM `HELP_GLOBAL_ORDER` below, for different reasons.
 *
 * `--debug` is the hidden flag that turns a one-line error into a stack trace: useful to
 * whoever is debugging and noise to everyone else ("No stack traces to users except with
 * `--debug` (hidden flag, not in help)").
 *
 * `--ui-kit` is here because `parseArgs` is strict and an option nobody declared is an unknown
 * flag — the parser has to know it takes a value. It is NOT a global in meaning: it belongs to
 * `--project-report`, it is documented under that command as one of its own `ArgSpec`s
 * (`packages/fe-project-report/src/command.ts`), and the list of design systems it accepts is
 * that package's to state, not this file's. Printing it among `-o`/`--token`/`--lang` would
 * claim it applies to every command, and duplicating its accepted values here would be a
 * second list to drift.
 *
 * `--source` is here for exactly the same reason and with exactly the same caveat: it belongs to
 * `--parse-ui-kit` (`packages/fe-project-report/src/parse-ui-kit.ts`), which documents it and
 * owns its default. Note that it is NOT the same thing as `Invocation.source` below — that is
 * the POSITIONAL argument, which for `--parse-ui-kit eds` is the kit name. Two different values
 * with one word between them is a real hazard, and the reason it is named after the flag the
 * user types rather than renamed to something tidier is that `ctx.flags` is keyed by flag name
 * throughout.
 *
 * THIS TABLE IS WHAT `parseArgs` MAY TOKENIZE, NOT WHAT EVERY COMMAND ACCEPTS. Those were the
 * same thing until V3's MAJOR-1: `--parse-ui-kit eds -o /tmp/x` exited 0 and threw the user's
 * explicit destination away in silence, because a command that does not declare a flag used to
 * ignore it rather than refuse it. Tokenizing still has to be permissive — `parseArgs` is strict
 * and cannot be told "`--source` takes a value, but only for one command" — so the narrowing
 * happens after the command is known, in {@link rejectUndeclared}, against
 * {@link declaredOptions}. See {@link scopedOptionNames} for which of these names narrow.
 */
const GLOBAL_OPTIONS = {
  out: { type: "string", short: "o" },
  token: { type: "string" },
  endpoint: { type: "string" },
  lang: { type: "string" },
  "ui-kit": { type: "string" },
  source: { type: "string" },
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
 * A spelling as it appears inside an `ArgSpec.name` (`-o`, `--ui-kit`) resolved to the key
 * `parseArgs` files its value under (`out`, `ui-kit`). `undefined` when the options table has
 * no such option, which is how a placeholder like `<url|guid>` and a typo are both ignored.
 */
function longNameOf(spelling: string, options: ParseArgsOptions): string | undefined {
  const known = options ?? {};
  if (spelling.startsWith("--")) {
    const name = optionName(spelling);
    return name in known ? name : undefined;
  }
  const short = spelling.slice(1);
  for (const [name, config] of Object.entries(known)) {
    if ((config as { short?: string }).short === short) return name;
  }
  return undefined;
}

/**
 * The options ONE command declares — read out of its own `ArgSpec` list, which is the only
 * place a command says what it takes.
 *
 * `ArgSpec.name` is the help's placeholder (`-o <path>`, `--ui-kit <name>`, `<url|guid>`), so
 * the flags in it are exactly the flags the help promises that command accepts. Deriving from
 * it rather than from a table in this file is the whole point: help and parser cannot disagree
 * about a command's surface, because they read the same field. A positional placeholder
 * contributes nothing — it does not start with `-`.
 */
export function declaredOptions(
  command: CliCommand,
  options: ParseArgsOptions,
): ReadonlySet<string> {
  const declared = new Set<string>();
  for (const arg of command.args) {
    for (const word of arg.name.split(/\s+/u)) {
      if (!word.startsWith("-") || word === "-" || word === "--") continue;
      const name = longNameOf(word.split("=", 1)[0] ?? word, options);
      if (name !== undefined) declared.add(name);
    }
  }
  return declared;
}

/**
 * WHICH GLOBALS NARROW TO THE COMMANDS THAT DECLARE THEM — decided from the registry, never
 * from a list written here.
 *
 * The rule is ownership by declaration: **an option some command names in its `args` belongs to
 * the commands that name it; an option no command names is the CLI's own and applies to every
 * invocation.** Today that sorts itself out as
 *
 *   scoped    `out` (five commands declare `-o`), `ui-kit` (`--project-report`),
 *             `source` (`--parse-ui-kit`)
 *   universal `lang`, `help`, `version`, `debug` — the meta-flags — and `token`/`endpoint`,
 *             which `cli/src/settings.ts` resolves on EVERY invocation and hands to EVERY
 *             command through `ctx.env`, so they are configuration the CLI owns rather than a
 *             flag some feature declared.
 *
 * The moment a feature package declares `--token` in an `ArgSpec`, this function narrows it to
 * that command without anything here being edited — which is the property that makes it a rule
 * rather than an exception list.
 */
export function scopedOptionNames(
  commands: readonly CliCommand[],
  options: ParseArgsOptions,
): readonly string[] {
  const claimed = new Set<string>();
  for (const command of commands) {
    for (const name of declaredOptions(command, options)) claimed.add(name);
  }
  // Filtered through `GLOBAL_OPTIONS`'s own key order so the refusal a user sees is the same
  // one for the same argv, rather than depending on registry iteration order.
  return Object.keys(GLOBAL_OPTIONS).filter((name) => claimed.has(name));
}

/**
 * The spelling the USER typed for `name`, so the refusal quotes their line rather than a
 * canonical form they never wrote: someone who typed `-o` should not be told about `--out`.
 * Falls back to the long spelling when argv holds only the `--name=value` form's sibling or
 * nothing recognizable.
 */
function typedSpelling(
  argv: readonly string[],
  name: string,
  options: ParseArgsOptions,
): string | undefined {
  const short = (options?.[name] as { short?: string } | undefined)?.short;
  for (const token of argv) {
    if (token === "--") break;
    if (!token.startsWith("-") || token === "-") continue;
    if (token.startsWith("--")) {
      if (optionName(token.split("=", 1)[0] ?? token) === name) return `--${name}`;
      continue;
    }
    if (short !== undefined && token.slice(1).includes(short)) return `-${short}`;
  }
  return undefined;
}

/**
 * The spelling the user used for the COMMAND, for the same reason {@link typedSpelling} exists:
 * someone who typed `--psvg` should be told about `--psvg`, not about `--get-pixso-svg`. Falls
 * back to the registry's primary spelling when neither appears literally (it always does today,
 * but a fallback is cheaper than a proof).
 */
function typedCommandSpelling(argv: readonly string[], command: CliCommand): string {
  const alias = command.alias;
  for (const token of argv) {
    if (token === "--") break;
    if (token === command.flag) return command.flag;
    if (alias !== undefined && token === alias) return alias;
  }
  return command.flag;
}

/**
 * V3 MAJOR-1, enforced: refuse a scoped option the selected command has not declared.
 *
 * Checked only for options that actually carry a value in the parse result, so a command is
 * refused for what the user typed and never for what they omitted. Returns `undefined` when the
 * invocation is clean.
 */
function rejectUndeclared(
  argv: readonly string[],
  values: Record<string, unknown>,
  command: CliCommand,
  commands: readonly CliCommand[],
  options: ParseArgsOptions,
  lang: Lang,
): Invocation | undefined {
  const declared = declaredOptions(command, options);
  for (const name of scopedOptionNames(commands, options)) {
    if (declared.has(name) || values[name] === undefined) continue;
    const spelling = typedSpelling(argv, name, options) ?? `--${name}`;
    return {
      kind: "error",
      lang,
      message: flagNotForCommand(spelling, typedCommandSpelling(argv, command)),
      withHelp: false,
    };
  }
  return undefined;
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

  // The command is known, so the permissive tokenizing above can finally be narrowed to what
  // THIS command declares. After `--help`/`--version` and the one-command rule, because a flag
  // that does not belong to a command is only a question once there is exactly one command.
  const undeclared = rejectUndeclared(argv, values, command, commands, options, lang);
  if (undeclared !== undefined) return undeclared;

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
      // Reaches the command through `ctx.flags`, which is the only channel a command-specific
      // option has: `CommandContext` names `source` and `out` and nothing else
      // (`packages/cli-kit/src/index.ts:53-63`), and that contract is frozen.
      "ui-kit": asString(values["ui-kit"]),
      // `--parse-ui-kit`'s optional repository. Reaches the command the same way `--ui-kit`
      // does, and for the same reason: `CommandContext` names `source` and `out` and nothing
      // else, and that contract is frozen (`packages/cli-kit/src/index.ts:81-104`).
      source: asString(values["source"]),
      debug: values["debug"] === true,
    },
  };
}
