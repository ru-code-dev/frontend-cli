/**
 * EVERY user-facing string the CLI layer itself produces, in both languages.
 *
 * The design makes multilingual UX a contract-level fact, not a rendering detail: `fg --lang
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
import type { Localized } from "@smart-tools/fg-cli-kit";

/** The half-line after `fg v<version> — ` at the top of `--help` (design 2.7). */
export const HELP_TAGLINE: Localized = {
  ru: "фронтенд-инструменты в командной строке",
  en: "frontend tools on the command line",
};

/** The `Использование` heading and the one line under it (design 2.7). */
export const HELP_USAGE_HEADING: Localized = { ru: "Использование", en: "Usage" };

export const HELP_USAGE_LINE: Localized = {
  ru: "fg <команда> <аргумент> [опции]",
  en: "fg <command> <argument> [options]",
};

/** The right-hand column's heading, on the first group's title row (design 2.7). */
export const HELP_DEFAULT_OUT_HEADING: Localized = { ru: "без -o →", en: "without -o →" };

/**
 * Printed instead of the command list when the registry is empty. It exists because an empty
 * registry is a REAL state of this tree — `packages/fg-pixso/src/index.ts` ships
 * `pixsoCommands: readonly CliCommand[] = []` until brief 3.2 fills it — and a help block that
 * silently renders nothing there would look like a rendering bug rather than an empty registry.
 */
export const HELP_COMMANDS_NONE: Localized = {
  ru: "команды: (ни одной не зарегистрировано)",
  en: "commands: (none registered)",
};

export const HELP_GLOBALS_HEADING: Localized = { ru: "Общие опции", en: "Common options" };

/** The environment block's heading and its trailing note (design 2.7's last two lines). */
export const HELP_ENV_HEADING: Localized = { ru: "Окружение", en: "Environment" };

export const HELP_ENV_NOTE: Localized = {
  ru: "./.env читается автоматически. Приоритет: флаг > env/.env > умолчание",
  en: "./.env is read automatically. Precedence: flag > env/.env > default",
};

/** The environment variables the block names, in one place so the note cannot drift from them. */
export const HELP_ENV_NAMES: readonly string[] = [
  "PIXSO_REMOTE_MCP_URL",
  "PIXSO_LOCAL_MCP_URL",
  "PIXSO_REMOTE_MCP_TOKEN",
  "FG_KITS_DIR",
];

/** The `Примеры` heading on a per-command page (design 2.8). */
export const HELP_EXAMPLES_HEADING: Localized = { ru: "Примеры", en: "Examples" };

/**
 * The per-command page's second line: `также: --project-report` (design §2.8, V5 finding #5).
 *
 * The long spelling is accepted everywhere and has to be teachable, but it belongs on a line of
 * its own rather than inside the usage line — where it cost 22 columns of a line the design caps
 * at 100 and made the same command read two different ways in one session (finding #8).
 */
export const HELP_ALSO_LABEL: Localized = { ru: "также:", en: "also:" };

/**
 * THE GLOBAL OPTIONS BLOCK, spelling and description together, in print order (design 2.7).
 *
 * The SPELLING is localized because its placeholder is (`-o, --out <путь>` / `<path>`), and the
 * rows are one table rather than two parallel lists keyed by name — the previous shape, where a
 * spelling map and a description map had to agree about their keys, is one edit away from a row
 * that prints a flag with no explanation.
 *
 * `--token` and `--endpoint` share ONE row: they are the same subject (reaching Pixso's MCP),
 * each is documented in full under the settings block below, and the design's own page prints
 * them together. `--debug` stays out entirely — it is the hidden flag.
 */
export const HELP_GLOBAL_ROWS: readonly { spelling: Localized; description: Localized }[] = [
  {
    spelling: { ru: "-o, --out <путь>", en: "-o, --out <path>" },
    description: {
      ru: "куда писать результат (файл или каталог), кроме --pkit",
      en: "where to write the result (file or directory), except --pkit",
    },
  },
  {
    spelling: { ru: "--lang ru|en", en: "--lang ru|en" },
    description: { ru: "язык вывода (ru)", en: "output language (ru)" },
  },
  {
    spelling: { ru: "--verbose", en: "--verbose" },
    description: {
      ru: "подробные сообщения в формате compact",
      en: "explanations under each compact row",
    },
  },
  {
    spelling: { ru: "--token, --endpoint", en: "--token, --endpoint" },
    description: { ru: "доступ к Pixso MCP", en: "access to the Pixso MCP" },
  },
  {
    spelling: { ru: "-h, --help", en: "-h, --help" },
    description: {
      ru: "справка;  fg --help --preport — подробно по команде",
      en: "this page;  fg --help --preport — one command in detail",
    },
  },
  {
    spelling: { ru: "-v, --version", en: "-v, --version" },
    description: { ru: "версия", en: "the version" },
  },
];

/**
 * THE FALLBACK POINTER for a failure that cannot name a command — an unknown flag, two commands
 * in one line, a broken `.env`.
 *
 * It is a {@link UsageHint}'s two halves rather than a sentence: design 2.6 gives every failure
 * the same two rows, and a refusal that instead ended with prose would be the one shape on the
 * page that reads differently. The `usage` half is the CLI's own surface line, which is the most
 * specific thing that can be said when the command is unknown.
 */
export const GENERIC_HINT: Localized = {
  ru: "fg <команда> <аргумент> [опции]",
  en: "fg <command> <argument> [options]",
};

/** Where to read the whole surface. Paired with {@link GENERIC_HINT}. */
export const HELP_POINTER = "fg --help";

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

/**
 * `--format` given a value the selected command does not accept — design U1's refusal.
 *
 * The accepted list is passed in, and it is the COMMAND's own: it is read back out of the
 * `ArgSpec` the help prints (`declaredValues`, `./parse.ts`), so the values a refusal quotes and
 * the values the help page promises are one string, not two.
 */
export function unknownFormat(value: string, accepted: readonly string[]): Localized {
  return {
    ru: `неизвестный формат: ${value}. Допустимые значения: ${accepted.join(", ")}`,
    en: `unknown format: ${value}. Accepted values: ${accepted.join(", ")}`,
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
