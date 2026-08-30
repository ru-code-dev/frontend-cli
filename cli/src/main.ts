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
import { pathToFileURL } from "node:url";

import { type CliCommand, type CommandContext, pick } from "@smart-tools/fe-cli-kit";

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
      const ctx: CommandContext = {
        source: parsed.source,
        out: parsed.out,
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
        stdout: deps.stdout,
        stderr: deps.stderr,
      };
      try {
        return await parsed.command.run(ctx);
      } catch (cause) {
        // The top-level catch. A user sees one localized line wrapping whatever the engine
        // said; core's own error text passes through untranslated because core owns it. The
        // stack is reachable, but only for whoever asked for it with the hidden `--debug`.
        const detail = cause instanceof Error ? cause.message : String(cause);
        deps.stderr(`${pick(commandFailed(detail), lang)}\n`);
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
 */
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = await run(process.argv.slice(2));
}
