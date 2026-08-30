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
 * Trailer explaining the three configurable values and the precedence chain, because the
 * precedence is the part a user cannot guess (design 2.1:105-111). The names printed are the
 * owner-fixed ones from `cli/src/constants.ts`.
 */
export const HELP_CONFIG_NOTE: Localized = {
  ru: [
    "настройки (приоритет: флаг > переменная окружения / .env > значение по умолчанию):",
    "  PIXSO_REMOTE_MCP_URL     адрес удалённого MCP   (флаг --endpoint)",
    "  PIXSO_LOCAL_MCP_URL      адрес локального MCP   (флаг --endpoint)",
    "  PIXSO_REMOTE_MCP_TOKEN   токен для удалённого MCP (флаг --token)",
    "файл ./.env в текущем каталоге загружается автоматически, если он есть.",
  ].join("\n"),
  en: [
    "settings (precedence: flag > environment variable / .env > built-in default):",
    "  PIXSO_REMOTE_MCP_URL     remote MCP endpoint   (flag --endpoint)",
    "  PIXSO_LOCAL_MCP_URL      local MCP endpoint    (flag --endpoint)",
    "  PIXSO_REMOTE_MCP_TOKEN   token for the remote MCP (flag --token)",
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
  out: {
    ru: "куда записать результат (файл или каталог); без него — в stdout",
    en: "where to write the result (file or directory); without it, stdout",
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
