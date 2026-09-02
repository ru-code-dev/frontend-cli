/**
 * `--help`, GENERATED — never written down, and now a TABLE rather than a transcript.
 *
 * The design's rule is that help "can never drift from what actually runs" because there is no
 * second list to drift from (design 2.1:81-82). That has not changed. What changed is the
 * SHAPE, and the diagnosis is on record: the old page printed each command's flag, its alias,
 * its long summary and every argument description in full, which put a 160-column usage line and
 * the same three-line pixso paragraph four times on one page
 * (`WORKFLOW/features/cli-ux/plans/current-output.txt`, diagnosis 3). The owner's verdict was
 * "unreadable".
 *
 * The replacement is `ux-design.md` §2.7 and §2.8, implemented here literally:
 *
 *  - GROUPS come from the commands (`CliCommand.group`), de-duplicated by id and sorted by
 *    `order`. There is no list of sections in this file, so a section cannot outlive its
 *    commands.
 *  - The SHORT ALIAS is the display name (U8). The long spelling stays accepted and appears on
 *    the per-command page, where a reader is looking for exactly that.
 *  - COLUMNS ARE COMPUTED from the longest name, argument and summary actually registered —
 *    never hard-coded — and the page is kept inside 100 columns.
 *  - The `без -o →` column is `CliCommand.defaultOut`, which is the question a user asks first
 *    now that `-o` is optional everywhere.
 *  - Argument descriptions are NOT on this page. `ArgSpec.hint` — one line — is, when a command
 *    ships one; the full sentence is `fg --help --<command>`'s (§2.8).
 *  - `--debug` stays hidden.
 *
 * Pure: strings in, a string out, no I/O. The caller decides where it goes.
 */
import {
  type CliCommand,
  type CommandGroup,
  type Lang,
  argName,
  pick,
  usageLineOf,
} from "@smart-tools/fg-cli-kit";

import {
  HELP_COMMANDS_NONE,
  HELP_DEFAULT_OUT_HEADING,
  HELP_ENV_HEADING,
  HELP_ENV_NAMES,
  HELP_ENV_NOTE,
  HELP_ALSO_LABEL,
  HELP_EXAMPLES_HEADING,
  HELP_GLOBALS_HEADING,
  HELP_GLOBAL_ROWS,
  HELP_TAGLINE,
  HELP_USAGE_HEADING,
  HELP_USAGE_LINE,
} from "./messages.ts";

/** The design's ceiling. Nothing this file emits is allowed past it (design 2.7). */
export const HELP_WIDTH = 100;

/** Two spaces of gutter between every computed column — the design's own spacing. */
const GAP = 2;

/** The page's left margin, and the indent every row inside a block carries. */
const INDENT = "  ";

/** The deeper indent an argument row sits at, under the command it belongs to (design 2.7). */
const SUB_INDENT = "      ";

/** Pad to a column, measured in code points. NEVER truncates: a column is widened for its
 *  content, never the other way round (U6's rule, generalised to every column here). */
function pad(text: string, width: number): string {
  const gap = width - [...text].length;
  return gap > 0 ? text + " ".repeat(gap) : text;
}

/** The display name of a command — the SHORT alias when there is one (U8). */
export function displayName(command: CliCommand): string {
  return command.alias ?? command.flag;
}

/**
 * A command's arguments as the usage line spells them: required bare, optional in brackets.
 * Shared by the table's argument column (positionals only) and the per-command usage line.
 */
function bracketed(name: string, required: boolean): string {
  return required ? name : `[${name}]`;
}

/** The POSITIONAL argument, which is the only one the main table's second column shows. */
function positionalOf(command: CliCommand, lang: Lang): string {
  const first = command.args.find((arg) => !argName(arg, lang).startsWith("-"));
  if (first !== undefined) return bracketed(argName(first, lang), first.required);
  // A command with no positional still owes the column something readable: its optional flags
  // collapsed to the shortest true statement, e.g. `--iconf [--ui-kit]`.
  const flags = command.args.filter((arg) => argName(arg, lang).startsWith("-"));
  const uiKit = flags.find((arg) => argName(arg, lang).startsWith("--ui-kit"));
  return uiKit === undefined ? "" : "[--ui-kit]";
}

/**
 * The groups the registry actually contains, de-duplicated by id and ordered.
 *
 * FIRST APPEARANCE breaks a tie on `order`, so two packages that pick the same number produce a
 * stable page rather than one that depends on sort stability.
 */
export function groupsOf(commands: readonly CliCommand[]): readonly CommandGroup[] {
  const seen = new Map<string, { group: CommandGroup; at: number }>();
  for (const [at, command] of commands.entries()) {
    if (!seen.has(command.group.id)) seen.set(command.group.id, { group: command.group, at });
  }
  return [...seen.values()]
    .toSorted((a, b) => a.group.order - b.group.order || a.at - b.at)
    .map((entry) => entry.group);
}

/**
 * THE WHOLE HELP PAGE — design 2.7.
 *
 * Every column below is measured across the WHOLE registry rather than per group, so the four
 * pixso rows and the three analysis rows line up as one table. That is the difference between a
 * page and a stack of blocks.
 */
export function helpText(commands: readonly CliCommand[], lang: Lang, version: string): string {
  const lines: string[] = [
    `fg v${version} — ${pick(HELP_TAGLINE, lang)}`,
    "",
    pick(HELP_USAGE_HEADING, lang),
    `${INDENT}${pick(HELP_USAGE_LINE, lang)}`,
    "",
  ];

  if (commands.length === 0) {
    lines.push(pick(HELP_COMMANDS_NONE, lang), "");
  } else {
    const nameW = widest(commands.map(displayName)) + GAP;
    const argW = widest(commands.map((c) => positionalOf(c, lang))) + GAP;
    const summaryW = widest(commands.map((c) => pick(c.summary, lang))) + GAP;
    // Where the `без -o →` column starts. Announced once, on the first group's heading row,
    // because a heading repeated over every block is noise.
    const outAt = INDENT.length + nameW + argW + summaryW;

    let first = true;
    for (const group of groupsOf(commands)) {
      const title = pick(group.title, lang);
      lines.push(first ? `${pad(title, outAt)}${pick(HELP_DEFAULT_OUT_HEADING, lang)}` : title);
      first = false;
      for (const command of commands.filter((c) => c.group.id === group.id)) {
        const row =
          INDENT +
          pad(displayName(command), nameW) +
          pad(positionalOf(command, lang), argW) +
          pad(pick(command.summary, lang), summaryW) +
          (command.defaultOut === null ? "" : pick(command.defaultOut, lang));
        lines.push(row.trimEnd());
        lines.push(...hintRows(command, lang));
      }
      lines.push("");
    }
  }

  lines.push(pick(HELP_GLOBALS_HEADING, lang));
  const spellingW = widest(HELP_GLOBAL_ROWS.map((row) => pick(row.spelling, lang))) + GAP;
  for (const row of HELP_GLOBAL_ROWS) {
    lines.push(
      `${INDENT}${pad(pick(row.spelling, lang), spellingW)}${pick(row.description, lang)}`,
    );
  }

  lines.push("", ...envBlock(lang), "");
  return lines.join("\n");
}

/**
 * The indented rows under a command — one per argument that ships a `hint`.
 *
 * A command with no hints contributes nothing, which is why the pixso rows are one line each:
 * their two arguments are the positional (already the second column) and `-o` (already a global
 * row), and repeating either under every command is exactly what made the old page four copies
 * of the same paragraph.
 */
function hintRows(command: CliCommand, lang: Lang): readonly string[] {
  const hinted = command.args.filter((arg) => arg.hint !== undefined);
  if (hinted.length === 0) return [];
  const width = widest(hinted.map((arg) => argName(arg, lang))) + 3;
  return hinted.map(
    (arg) =>
      `${SUB_INDENT}${pad(argName(arg, lang), width)}${pick(arg.hint ?? HELP_TAGLINE, lang)}`,
  );
}

/** The environment block: the names on the heading's row, the note under them, aligned. */
function envBlock(lang: Lang): readonly string[] {
  const heading = pick(HELP_ENV_HEADING, lang);
  const width = [...heading].length + 3;
  return [
    `${pad(heading, width)}${HELP_ENV_NAMES.join("  ")}`,
    `${" ".repeat(width)}${pick(HELP_ENV_NOTE, lang)}`,
  ];
}

/** The widest of a set of strings, in code points. `0` for an empty set. */
function widest(values: readonly string[]): number {
  return values.reduce((max, value) => Math.max(max, [...value].length), 0);
}

/**
 * THE USAGE LINE for one command — cli-kit's `usageLineOf`, and nothing of its own.
 *
 * It used to be a SECOND builder, and the two disagreed inside one session: a bare `fg --preport`
 * quoted `fg --preport <path|repo> …` while a `--format` refusal quoted
 * `fg --preport, --project-report <path|repo> [-o <path>] [--format html|compact|json|sarif]
 * [--ui-kit eds|none] [--config <file>]` — 127 columns against §2.7's ceiling of 100 (V5 findings
 * #5 and #8). One function now answers for the help page, for usage errors and for refusals, so
 * they cannot spell the same command two ways; the long alias is a line of its own below
 * ({@link commandHelpText}), which is where a reader looks for it and where it costs no width.
 */
export function commandUsageLine(command: CliCommand, lang: Lang): string {
  return usageLineOf(command, lang);
}

/**
 * ONE COMMAND, IN FULL — design 2.8, the page `fg --help --preport` prints.
 *
 * This is where a command's prose lives: the paragraph it ships as `details`, and every
 * argument's real `description`, wrapped rather than run off the right edge. Nothing here is
 * written in this file — the page is the command's own metadata, laid out.
 */
export function commandHelpText(command: CliCommand, lang: Lang): string {
  const lines: string[] = [commandUsageLine(command, lang)];
  // The long spelling, on its own line and only where it is looked for. It is accepted
  // everywhere (`--project-report`, `--init-config`, `--parse-ui-kit`), so the page has to teach
  // it — but as a second line rather than as a second column inside the usage line, which is
  // what pushed that line to 127 columns (§2.8, V5 finding #5).
  if (command.alias !== undefined) {
    lines.push(`${INDENT}${pick(HELP_ALSO_LABEL, lang)} ${command.flag}`);
  }
  lines.push("");
  if (command.details !== undefined) {
    lines.push(...wrap(pick(command.details, lang), HELP_WIDTH - INDENT.length, INDENT), "");
  }

  if (command.args.length > 0) {
    // Wide enough for the longest argument, and never narrower than the design's own column.
    const width = Math.max(widest(command.args.map((a) => argName(a, lang))) + GAP, 16);
    for (const arg of command.args) {
      const body = wrap(pick(arg.description, lang), HELP_WIDTH - INDENT.length - width, "");
      const [head = "", ...rest] = body;
      lines.push(`${INDENT}${pad(argName(arg, lang), width)}${head}`);
      for (const line of rest) lines.push(`${INDENT}${" ".repeat(width)}${line}`);
    }
    lines.push("");
  }

  if (command.examples !== undefined && command.examples.length > 0) {
    lines.push(`${INDENT}${pick(HELP_EXAMPLES_HEADING, lang)}`);
    for (const example of command.examples) lines.push(`${INDENT}${INDENT}${example}`);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Flow a paragraph onto `width`-wide rows, each prefixed with `indent`.
 *
 * Words are never broken: a token longer than the width takes its own row whole. That is U6
 * stated for prose — this file's only job is where the line breaks go, and a broken path is a
 * path a user cannot copy.
 */
function wrap(text: string, width: number, indent: string): readonly string[] {
  const rows: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/u).filter((part) => part !== "")) {
    if (line === "") line = word;
    else if ([...line].length + 1 + [...word].length <= width) line = `${line} ${word}`;
    else {
      rows.push(`${indent}${line}`);
      line = word;
    }
  }
  if (line !== "") rows.push(`${indent}${line}`);
  return rows;
}
