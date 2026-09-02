#!/usr/bin/env node
/**
 * `fe` — the published bin, and the only publishable package in this repo.
 *
 * This file is DISPATCH AND NOTHING ELSE. Parsing lives in `parse.ts`, rendering in `help.ts`,
 * the precedence chain in `settings.ts`, the strings in `messages.ts`, the feature seam in
 * `registry.ts` — each of them pure and separately testable. What is left here is the part that
 * cannot be pure: deciding what to print, where to print it, and what number to exit with.
 *
 * Even that is testable, because every impure thing arrives as an injected dependency
 * (`RunDeps`) with a process-shaped default. `run([...])` in a unit test touches no environment,
 * no filesystem and no stream it was not handed. The only code in this package that reads
 * `process` outside a default is the entry guard at the bottom.
 *
 * `run` returns an exit code rather than calling `process.exit`, which is what makes the whole
 * CLI drivable in-process (design 2.1:150-153).
 *
 * The package's `exports` map is deliberately EMPTY — this is a binary, not a library, and an
 * empty map is the only way to say so in a way module resolution enforces
 * (`ru-code-packages/packages/pixso-cli/package.json:13`, rationale at that package's
 * `src/main.ts:14-17`). Tests therefore import `../src/*.ts` relatively.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  type CliCommand,
  type CommandContext,
  type Lang,
  type TerminalUi,
  createUi,
  pick,
} from "@smart-tools/fe-cli-kit";

import { type DotEnvResult, loadDotEnv } from "./dotenv.ts";
import { helpText } from "./help.ts";
import { DEBUG_HINT, USAGE_HINT, commandFailed } from "./messages.ts";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, parseInvocation } from "./parse.ts";
import { COMMANDS } from "./registry.ts";
import { type Env, resolveSettings, settingsToEnv } from "./settings.ts";
import { CLI_VERSION } from "./version.ts";

export { COMMANDS } from "./registry.ts";

/** Everything `run` would otherwise reach for globally. Every field has a process default. */
export interface RunDeps {
  readonly commands: readonly CliCommand[];
  readonly version: string;
  /** Read AFTER `loadEnv`, so a `.env` written into `process.env` is visible to it. */
  readonly readEnv: () => Env;
  readonly cwd: () => string;
  readonly loadEnv: (cwd: string) => DotEnvResult;
  readonly stdout: (s: string) => void;
  readonly stderr: (s: string) => void;
  /**
   * The terminal UI, built per invocation because it needs the language the argv resolved to.
   *
   * It is a FACTORY rather than a value for that reason alone: `--lang` is known only after
   * `parseInvocation` has run, and a UI that had to be told the language afterwards would be a
   * UI that could draw one label in the wrong one. The production factory points it at
   * `process.stderr` — never `stdout`, which stays exactly the bytes a caller piped — and hands
   * it `process.env`, which is where `NO_COLOR`, `FORCE_COLOR` and `COLORTERM` are read from
   * (`packages/cli-kit/src/ui.ts`).
   */
  readonly ui: (lang: Lang) => TerminalUi;
}

/** The production wiring. Referenced only by `run`'s default argument and the entry guard. */
export function defaultDeps(): RunDeps {
  return {
    commands: COMMANDS,
    version: CLI_VERSION,
    readEnv: () => process.env,
    cwd: () => process.cwd(),
    loadEnv: loadDotEnv,
    stdout: (s) => void process.stdout.write(s),
    stderr: (s) => void process.stderr.write(s),
    ui: (lang) => createUi({ stream: process.stderr, lang, env: process.env, wordmark: "fe" }),
  };
}

/**
 * THE CLI, minus argv and exit.
 *
 * Order of operations, and why:
 *
 *  1. `.env` FIRST, before anything reads the environment — otherwise the precedence chain would
 *     resolve against a half-populated environment and `.env` would work or not depending on
 *     which flag was passed. Its failure is reported in the language the argv asks for, which
 *     `parseInvocation` re-derives independently; `preresolveLang` is cheap and pure, so
 *     deriving it twice is better than threading a half-parsed state through the loader.
 *  2. Parse, which never throws.
 *  3. Act. Only the `command` arm can fail at runtime, and it is the only thing inside a
 *     `try`.
 */
export async function run(argv: readonly string[], deps: RunDeps = defaultDeps()): Promise<number> {
  const parsed = parseInvocation(argv, deps.commands);
  const lang = parsed.lang;

  const env = deps.loadEnv(deps.cwd());
  if (env.error !== undefined) {
    deps.stderr(`${pick(env.error, lang)}\n`);
    return EXIT_USAGE;
  }

  switch (parsed.kind) {
    case "help": {
      // Exit 2 means "you did not name a command"; the help still goes to stdout, because it is
      // the answer to the question the user failed to ask, not an error message.
      deps.stdout(helpText(deps.commands, lang, deps.version));
      return parsed.exitCode;
    }
    case "version": {
      deps.stdout(`${deps.version}\n`);
      return EXIT_OK;
    }
    case "error": {
      deps.stderr(`${pick(parsed.message, lang)}\n`);
      if (parsed.withHelp) deps.stderr(helpText(deps.commands, lang, deps.version));
      else deps.stderr(`${pick(USAGE_HINT, lang)}\n`);
      return EXIT_USAGE;
    }
    case "command": {
      const runtime = resolveSettings(
        { endpoint: parsed.endpoint, token: parsed.token },
        deps.readEnv(),
      );
      // Built HERE and not before: `--help`, `--version` and every parse error return above
      // this line, and none of them should print a banner. The UI draws nothing at all until a
      // command asks it to (`packages/cli-kit/src/ui.ts` — the banner is lazy, on the first
      // `phase`), so an invocation that never reaches a command leaves stderr untouched.
      const ui = deps.ui(lang);
      const ctx: CommandContext = {
        source: parsed.source,
        out: parsed.out,
        // The invocation's working directory, injected rather than read inside a command —
        // `deps.cwd()` is the same function `.env` loading already goes through, so a run and
        // its `.env` can never disagree about where "here" is. It matters more than it used to:
        // `-o` is optional for every command now, and the defaults are cwd-relative
        // (`packages/cli-kit/src/out.ts`), so this decides where a bare run WRITES.
        cwd: deps.cwd(),
        lang,
        // The resolved settings OVERLAY the ambient environment under the three owner-fixed
        // names, so a command reading `ctx.env.PIXSO_LOCAL_MCP_URL` gets the value the
        // precedence chain decided — flag overrides applied — rather than the raw variable.
        // `settings.ts` documents why `env` is the channel; in short, the cli-kit contract is
        // frozen and those three names are the design's own env keys.
        env: { ...deps.readEnv(), ...settingsToEnv(runtime) },
        // ...and into `flags` under the same three names, which is the slot a feature package
        // reads FIRST: "the resolved value, when the cli put one there. This is the slot that
        // lets the cli's precedence win, because by the time it writes here it has already
        // applied the flag-over-env-over-default order"
        // (`packages/fe-pixso/src/runtime.ts:11-16`). Both slots carry the same resolved values,
        // so either read order reaches the same answer; writing both means the seam does not
        // depend on which one a future feature package happens to consult.
        flags: { ...parsed.flags, ...settingsToEnv(runtime) },
        // Wrapped so a command's stdout line cannot land in the middle of a live progress bar:
        // the bar occupies a row with no newline on it, and `suspend` erases that row before
        // the write so the next animator frame redraws the bar BELOW the printed line rather
        // than over it. The bytes handed to `deps.stdout` are untouched — this changes where
        // the terminal cursor is, never what stdout carries.
        stdout: (s) => {
          ui.suspend();
          deps.stdout(s);
        },
        // Same wrapping, plus the ONE-VOICE rule: once the UI has drawn its card, the card is
        // the last thing on stderr. Every `ctx.stderr` call site in the repo is a refusal path
        // that writes the very sentence it has just handed to `ui.fail`
        // (`packages/fe-pixso/src/commands.ts:79-83`,
        // `packages/fe-project-report/src/command.ts:144-146`) — the habit from before the card
        // existed. The card carries that sentence in every mode, plain non-TTY lane included,
        // so letting the bare line through prints it twice. Dropping it here rather than in
        // those two files keeps the policy where the streams are owned, and holds for any
        // command added later. `silentUi.ended()` is false forever, so a context with no
        // terminal — every hand-built test context — still gets the bare line.
        stderr: (s) => {
          if (ui.ended()) return;
          ui.suspend();
          deps.stderr(s);
        },
        ui,
      };
      try {
        return await parsed.command.run(ctx);
      } catch (cause) {
        // The top-level catch. A user sees one localized line wrapping whatever the engine
        // said; core's own error text passes through untranslated because core owns it. The
        // stack is reachable, but only for whoever asked for it with the hidden `--debug`.
        const detail = cause instanceof Error ? cause.message : String(cause);
        // The card first, so whatever phase was in flight is marked `✗` and the animator that
        // was easing its bar is stopped before anything else prints. `fail` is terminal and
        // idempotent, so a command that already drew its own card is not given a second one
        // (`packages/cli-kit/src/ui.ts`).
        ui.fail(commandFailed(detail));
        // ONE VOICE, the same rule and the same predicate as the `ctx.stderr` wrapper above:
        // the card already carries this sentence, so the bare line is written only when there
        // was no card. `silentUi` never draws one and answers `ended()` false forever
        // (`packages/cli-kit/src/ui.ts`) — so a context wired to it, which is every hand-built
        // test context, still gets the failure rather than losing it to a UI that drew nothing.
        if (!ui.ended()) deps.stderr(`${pick(commandFailed(detail), lang)}\n`);
        if (parsed.debug) {
          deps.stderr(`${cause instanceof Error ? (cause.stack ?? detail) : detail}\n`);
        } else {
          deps.stderr(`${pick(DEBUG_HINT, lang)}\n`);
        }
        return EXIT_FAILURE;
      }
    }
  }
}

/**
 * ENTRY GUARD — `pixso-cli`'s idiom and its recorded reason: a test that imports the thing under
 * test must not thereby execute it. Without the guard, merely importing this module ran the CLI
 * against the test runner's argv, printing usage into the suite's output and setting
 * `process.exitCode` (`ru-code-packages/packages/pixso-cli/src/main.ts:73-86`).
 *
 * The comparison is on REAL paths, and that is the whole point. `npm install` materialises
 * `bin/fe` as a SYMLINK into `dist/main.mjs`; Node then sets `process.argv[1]` to the symlink
 * while `import.meta.url` is the resolved target, so a naive `pathToFileURL(argv[1]).href ===
 * import.meta.url` is false and the published binary exits 0 having done nothing. Resolving
 * both sides with `realpathSync` makes the installed shape — the one every user actually runs —
 * take the same branch as `node dist/main.mjs`. Covered by
 * `cli/tests/installed-bin.integration.test.ts`, which packs, installs and runs the symlink.
 *
 * `realpathSync` throws on a path that does not exist or cannot be read (a deleted script, a
 * broken link, an argv[1] that is not a file at all). That is not a reason to run: it only means
 * we cannot prove this module IS the entry, so the guard stays closed and falls back to the
 * unresolved comparison, which is exactly the old behaviour.
 */
const entry = process.argv[1];
if (entry !== undefined && isEntry(entry, import.meta.url)) {
  process.exitCode = await run(process.argv.slice(2));
}

/** Exported for the unit test; see the ENTRY GUARD note above for why it resolves both sides. */
export function isEntry(argv1: string, moduleUrl: string): boolean {
  const real = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  return real(fileURLToPath(moduleUrl)) === real(argv1);
}
