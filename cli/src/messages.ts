/**
 * EVERY user-facing string the CLI layer itself produces, in both languages.
 *
 * The design makes multilingual UX a contract-level fact, not a rendering detail: `fe --lang
 * ru|en`, DEFAULT `ru`, and "all user-facing strings (help, command summaries, arg
 * descriptions, errors) are localized" (design 2.1:127-132). The cli-kit contract enforces it
 * for FEATURE packages by typing their metadata as `Localized`
 * (`packages/cli-kit/src/index.ts:25-28,72-78`) — a command that ships only English cannot be
 * constructed. Nothing types-enforces it for the CLI's own messages, so the enforcement here is
 * structural instead: this file is the only place in `cli/src` that contains a user-facing
 * sentence, every export is `Localized`, and a bare string literal reaching stdout or stderr
 * from anywhere else is a bug visible on sight.
 *
 * Builders (functions returning `Localized`) exist because several messages interpolate a
 * value; they build BOTH languages from that value so an interpolated message can never be
 * half-translated.
 */
import type { Localized } from "@smart-tools/fe-cli-kit";

/** The one-line banner at the top of `--help`. */
export const HELP_TAGLINE: Localized = {
  ru: "fe — фронтенд-инструменты в командной строке",
  en: "fe — frontend tools on the command line",
};

/** The `usage:` line. Flag-style surface, one command flag per invocation (design 2.1:84-93). */
export const HELP_USAGE: Localized = {
  ru: "использование: fe <команда> [источник] [опции]",
  en: "usage: fe <command> [source] [options]",
};

export const HELP_COMMANDS_HEADING: Localized = {
  ru: "команды:",
  en: "commands:",
};

/**
 * Printed instead of the command list when the registry is empty. It exists because an empty
 * registry is a REAL state of this tree — `packages/fe-pixso/src/index.ts` ships
 * `pixsoCommands: readonly CliCommand[] = []` until brief 3.2 fills it — and a help block that
 * silently renders nothing there would look like a rendering bug rather than an empty registry.
 */
export const HELP_COMMANDS_NONE: Localized = {
  ru: "команды: (ни одной не зарегистрировано)",
  en: "commands: (none registered)",
};

export const HELP_GLOBALS_HEADING: Localized = {
  ru: "общие опции:",
  en: "global options:",
};

/**
 * Trailer explaining the configurable values and the precedence chain, because the precedence
 * is the part a user cannot guess (design 2.1:105-111). The names printed are the owner-fixed
 * ones from `cli/src/constants.ts`, plus `FE_KITS_DIR`.
 *
 * `FE_KITS_DIR` IS LISTED WITHOUT A FLAG, and that is not an omission — there is no flag for
 * it. V3 MINOR-2 found it documented nowhere user-facing (zero occurrences in `--help` in
 * either language and in the README) despite being the shipped override for where
 * `--parse-ui-kit` writes and where `--project-report` looks
 * (`packages/fe-eds-adapter/src/corpus.ts:67-76`). A block that enumerates the environment
 * variables and skips one of them is worse than no block, so it is here; the "flag >" half of
 * the precedence line simply has no term for this row. The default is spelled `~/.fe/kits`
 * rather than expanded, because the expansion is the running user's home directory and this
 * string is built once, at module scope, for everyone.
 */
export const HELP_CONFIG_NOTE: Localized = {
  ru: [
    "настройки (приоритет: флаг > переменная окружения / .env > значение по умолчанию):",
    "  PIXSO_REMOTE_MCP_URL     адрес удалённого MCP   (флаг --endpoint)",
    "  PIXSO_LOCAL_MCP_URL      адрес локального MCP   (флаг --endpoint)",
    "  PIXSO_REMOTE_MCP_TOKEN   токен для удалённого MCP (флаг --token)",
    "  FE_KITS_DIR              каталог корпусов дизайн-систем, куда пишет --parse-ui-kit",
    "                           и откуда читает --project-report (по умолчанию ~/.fe/kits)",
    "файл ./.env в текущем каталоге загружается автоматически, если он есть.",
  ].join("\n"),
  en: [
    "settings (precedence: flag > environment variable / .env > built-in default):",
    "  PIXSO_REMOTE_MCP_URL     remote MCP endpoint   (flag --endpoint)",
    "  PIXSO_LOCAL_MCP_URL      local MCP endpoint    (flag --endpoint)",
    "  PIXSO_REMOTE_MCP_TOKEN   token for the remote MCP (flag --token)",
    "  FE_KITS_DIR              design-system corpus directory: where --parse-ui-kit writes",
    "                           and --project-report reads (default ~/.fe/kits)",
    "a ./.env file in the current directory is loaded automatically when present.",
  ].join("\n"),
};

/** Pointer appended to every parse error, so a failure always says how to see the surface. */
export const USAGE_HINT: Localized = {
  ru: "запустите `fe --help`, чтобы увидеть список команд.",
  en: "run `fe --help` to see the list of commands.",
};

/** No command flag given. The help is printed too, and the exit code is 2 (design 2.1:82). */
export const NO_COMMAND: Localized = {
  ru: "не указана команда.",
  en: "no command given.",
};

/** Two or more command flags in one invocation. */
export const TOO_MANY_COMMANDS: Localized = {
  ru: "за один запуск можно указать ровно одну команду.",
  en: "exactly one command may be given per invocation.",
};

/** An unrecognized flag. `token` is the offending spelling as the user typed it. */
export function unknownFlag(token: string): Localized {
  return {
    ru: `неизвестный флаг: ${token}`,
    en: `unknown flag: ${token}`,
  };
}

/**
 * A flag this CLI knows, aimed at a command that does not take it — V3 MAJOR-1.
 *
 * It names BOTH halves because either one alone leaves the user guessing: "unknown flag: -o" is
 * false (`-o` is known, and works on five other commands) and "wrong flag for this command"
 * without the command is unactionable when the line holds several. `flag` is the spelling the
 * user typed, `command` the flag that selected the command — both quoted verbatim, so the
 * message can be pasted back as the line to fix.
 */
export function flagNotForCommand(flag: string, command: string): Localized {
  return {
    ru: `флаг ${flag} не поддерживается командой ${command}.`,
    en: `flag ${flag} is not supported by ${command}.`,
  };
}

/**
 * A known flag used wrongly — `--out` with no value, `--psvg=x` when it takes no argument.
 * `detail` is Node's own `parseArgs` explanation, which names the option precisely and is the
 * only part of the message not translated: it is a quotation, not our prose.
 */
export function badFlagUsage(detail: string): Localized {
  return {
    ru: `неверное использование флага: ${detail}`,
    en: `invalid flag usage: ${detail}`,
  };
}

/** `--lang` given something other than `ru` or `en`. */
export function badLang(value: string): Localized {
  return {
    ru: `неизвестный язык: ${value}. Допустимые значения: ru, en.`,
    en: `unknown language: ${value}. Accepted values: ru, en.`,
  };
}

/**
 * `./.env` exists but could not be loaded. `reason` is the underlying error's message.
 *
 * Node's `.env` parser is lenient — verified: a line with no `=`, or a stray `=novalue`, is
 * skipped silently rather than throwing. What DOES throw is an unreadable file: a directory
 * named `.env` raises `ERR_INVALID_ARG_TYPE`, a vanished file raises `ENOENT`. So this message
 * covers "present but unusable", which is exactly the case where a stack trace would otherwise
 * reach a user who only mistyped a path.
 */
export function envLoadFailed(path: string, reason: string): Localized {
  return {
    ru: `не удалось загрузить ${path}: ${reason}`,
    en: `could not load ${path}: ${reason}`,
  };
}

/**
 * A command (or the engine underneath it) threw. `detail` is the underlying message, passed
 * through as-is: core owns its own error text and the CLI must not paraphrase it (brief 3.3
 * deliverable 3, "core's own error text may pass through as-is").
 */
export function commandFailed(detail: string): Localized {
  return {
    ru: `ошибка: ${detail}`,
    en: `error: ${detail}`,
  };
}

/** Appended to a command failure, pointing at the hidden `--debug` flag for the full trace. */
export const DEBUG_HINT: Localized = {
  ru: "повторите с `--debug`, чтобы увидеть полную трассировку.",
  en: "re-run with `--debug` to see the full stack trace.",
};

/** Descriptions of the global options, as `--help` prints them. */
export const GLOBAL_DESCRIPTIONS: Readonly<Record<string, Localized>> = {
  /**
   * CHANGED IN E2b. This used to read "без него — в stdout", which stopped being true when the
   * owner's law made `-o` optional everywhere: a command without one now WRITES, to its own
   * documented default, and prints the absolute paths. The default itself is deliberately not
   * named here — there are three different ones — and each command states its own in its
   * `-o` `ArgSpec` (`packages/fe-pixso/src/strings.ts`,
   * `packages/fe-project-report/src/strings.ts`), which is where a reader is already looking.
   *
   * CHANGED AGAIN IN F2. Since V3 MAJOR-1 was fixed, `-o` is no longer accepted by every
   * command — `--parse-ui-kit` declares no output flag and now REFUSES one instead of
   * discarding it — so the description says which commands take it. It stays in this block
   * rather than moving under each command because five of the six do take it and each already
   * documents its own default in its own `ArgSpec`; a global block that listed it unqualified
   * would be the help contradicting the parser.
   */
  out: {
    ru: "куда записать результат (файл или каталог); принимают его только команды, которые его объявляют; необязателен — без него команда пишет в свой каталог по умолчанию и печатает абсолютные пути",
    en: "where to write the result (file or directory); accepted only by the commands that declare it; optional — without it a command writes to its own default location and prints the absolute paths",
  },
  token: {
    ru: "токен для удалённого MCP (переопределяет PIXSO_REMOTE_MCP_TOKEN)",
    en: "token for the remote MCP (overrides PIXSO_REMOTE_MCP_TOKEN)",
  },
  endpoint: {
    ru: "адрес MCP (переопределяет PIXSO_REMOTE_MCP_URL и PIXSO_LOCAL_MCP_URL)",
    en: "MCP endpoint (overrides both PIXSO_REMOTE_MCP_URL and PIXSO_LOCAL_MCP_URL)",
  },
  lang: {
    ru: "язык вывода: ru или en (по умолчанию ru)",
    en: "output language: ru or en (default ru)",
  },
  help: {
    ru: "показать эту справку",
    en: "show this help",
  },
  version: {
    ru: "показать версию",
    en: "show the version",
  },
};
