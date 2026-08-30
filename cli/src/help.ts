/**
 * `--help`, GENERATED — never written down.
 *
 * The design's rule is that help "can never drift from what actually runs" because there is no
 * second list to drift from (design 2.1:81-82, the idiom `pixso-cli/src/main.ts:33-53` uses).
 * `helpText` therefore takes the registry as an argument and prints exactly what is in it: a
 * command that is registered appears, a command that is not, does not, and a summary shown is
 * the `Localized` the feature package itself shipped.
 *
 * Localization is not a wrapper around an English document — the whole page is rendered per
 * language, headings included, from `cli/src/messages.ts` and the registry's own `Localized`
 * fields. `pick` is cli-kit's (`packages/cli-kit/src/index.ts:31-33`).
 *
 * Pure: a string in, a string out, no I/O. The caller decides where it goes.
 */
import { type CliCommand, type Lang, pick } from "@smart-tools/fe-cli-kit";

import {
  GLOBAL_DESCRIPTIONS,
  HELP_COMMANDS_HEADING,
  HELP_COMMANDS_NONE,
  HELP_CONFIG_NOTE,
  HELP_GLOBALS_HEADING,
  HELP_TAGLINE,
  HELP_USAGE,
} from "./messages.ts";
import { HELP_GLOBAL_ORDER } from "./parse.ts";

/** The globals' spellings, as the help prints them. Mirrors `GLOBAL_OPTIONS` in `parse.ts`. */
const GLOBAL_SPELLINGS: Readonly<Record<string, string>> = {
  out: "-o, --out <path>",
  token: "--token <token>",
  endpoint: "--endpoint <url>",
  lang: "--lang ru|en",
  help: "-h, --help",
  version: "-v, --version",
};

/**
 * One command's invocation line: every spelling that runs it, then its arguments.
 *
 * Both the flag AND the alias are printed on the same line rather than the alias being hidden
 * in a footnote — an alias a user cannot discover from `--help` is an alias that does not
 * exist, and the tests assert both spellings are present in both languages for every registered
 * command (brief 3.3 deliverable 5).
 *
 * `_lang` is accepted and unused on purpose: a usage line is spellings and argument NAMES, and
 * neither is translated — but every other help-rendering function in this file takes the
 * language, and a lone exception would read as an oversight at each call site. The underscore
 * is the linter's own convention for a parameter kept for signature symmetry
 * (`eslint/no-unused-vars`, `.oxlintrc.json:12`).
 */
export function commandUsageLine(command: CliCommand, _lang: Lang): string {
  const spellings =
    command.alias === undefined ? command.flag : `${command.flag}, ${command.alias}`;
  const args = command.args.map((a) => (a.required ? a.name : `[${a.name}]`)).join(" ");
  return args === "" ? `  ${spellings}` : `  ${spellings} ${args}`;
}

/**
 * The whole help page.
 *
 * Two lines per command rather than a padded two-column table: the flag-plus-alias spellings
 * here run past 30 characters, and `pixso-cli` records what happens when they share a line with
 * the summary — "the argument shapes are long enough that a single padded column either wraps
 * or collides with the summary — the first spelling of this did collide"
 * (`ru-code-packages/packages/pixso-cli/src/main.ts:34-35`). Taking that lesson rather than
 * rediscovering it.
 *
 * Argument descriptions are indented under their command, so a feature package's `ArgSpec`
 * documentation (`packages/cli-kit/src/index.ts:36-41`) actually reaches the user instead of
 * existing only in the type.
 */
export function helpText(commands: readonly CliCommand[], lang: Lang, version: string): string {
  const lines: string[] = [
    `${pick(HELP_TAGLINE, lang)}  v${version}`,
    "",
    pick(HELP_USAGE, lang),
    "",
  ];

  if (commands.length === 0) {
    lines.push(pick(HELP_COMMANDS_NONE, lang));
  } else {
    lines.push(pick(HELP_COMMANDS_HEADING, lang));
    for (const command of commands) {
      lines.push(commandUsageLine(command, lang));
      lines.push(`      ${pick(command.summary, lang)}`);
      for (const arg of command.args) {
        lines.push(`        ${arg.name}  ${pick(arg.description, lang)}`);
      }
    }
  }

  lines.push("", pick(HELP_GLOBALS_HEADING, lang));
  for (const name of HELP_GLOBAL_ORDER) {
    const description = GLOBAL_DESCRIPTIONS[name];
    const spelling = GLOBAL_SPELLINGS[name] ?? `--${name}`;
    lines.push(
      `  ${spelling.padEnd(18)} ${description === undefined ? "" : pick(description, lang)}`,
    );
  }

  lines.push("", pick(HELP_CONFIG_NOTE, lang), "");
  return lines.join("\n");
}
