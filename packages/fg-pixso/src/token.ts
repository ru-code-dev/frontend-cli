/**
 * `fguard token [<value>]` — store the remote Pixso token in the bundle-side `.env` (E1).
 *
 * The file is `<binDir>/.env`: the directory the running `fg.mjs` lives in, which `bash install`
 * makes `<root>/fg/bin`. The CLI reads it below the environment and the project `.env`
 * (`cli/src/dotenv.ts`), so this is the user-level default a project can still override (E3).
 *
 * The line is SET OR REPLACED; every other line of the file is kept as it was. The written bytes
 * are proven before they land: node's own parser (`util.parseEnv`, the one `process.loadEnvFile`
 * uses) must read the exact value back, which decides between a bare, a single-quoted and a
 * double-quoted spelling — and refuses a value no spelling can carry (a newline).
 *
 * Without a value the token is read with HIDDEN input on a terminal (nothing echoed, so it is
 * neither on screen nor in the shell history); from a pipe, the first line of stdin.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";

import type { CliCommand, CommandContext, Localized } from "@smart-tools/fg-cli-kit";
import { emitPaths, pick } from "@smart-tools/fg-cli-kit";

import { TOKEN_KEY } from "./runtime.ts";
import * as s from "./strings.ts";

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

/** Reads a secret line. Injectable: a test hands one in, production asks the terminal. */
export type ReadSecret = (prompt: string) => Promise<string>;

/** Any definition of the token key, `export`-prefixed or not — the lines `set` replaces. */
const KEY_LINE = new RegExp(`^\\s*(?:export\\s+)?${TOKEN_KEY}\\s*=`, "u");

/**
 * `text` with the token line set to `value`: existing definitions dropped, ONE new line appended.
 * `undefined` when no spelling survives node's parser byte-for-byte.
 */
export function withToken(text: string, value: string): string | undefined {
  const kept = text
    .split(/\r?\n/u)
    .filter((line) => !KEY_LINE.test(line))
    .join("\n")
    .replace(/\n+$/u, "");
  for (const spelled of [value, `'${value}'`, `"${value}"`]) {
    const next = `${kept === "" ? "" : `${kept}\n`}${TOKEN_KEY}=${spelled}\n`;
    if (parseEnv(next)[TOKEN_KEY] === value) return next;
  }
  return undefined;
}

/** The terminal's hidden prompt, or the first stdin line when stdin is not a terminal. */
export const readSecretFromStdin: ReadSecret = (prompt) =>
  new Promise((resolve) => {
    const input = process.stdin;
    if (input.isTTY !== true) {
      let data = "";
      input.setEncoding("utf8");
      input.on("data", (chunk: string) => (data += chunk));
      input.on("end", () => resolve(data.split(/\r?\n/u)[0] ?? ""));
      return;
    }
    process.stderr.write(prompt);
    input.setRawMode(true);
    input.setEncoding("utf8");
    let value = "";
    const done = (result: string): void => {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
      process.stderr.write("\n");
      resolve(result);
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(value);
        if (ch === "\u0003" || ch === "\u0004") return done("");
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    input.on("data", onData);
    input.resume();
  });

function refuse(ctx: CommandContext, message: Localized, code: number): number {
  ctx.ui.fail(message);
  return code;
}

/** The `token` verb. */
export function tokenCommand(pixsoGroup: CliCommand["group"], readSecret: ReadSecret): CliCommand {
  return {
    flag: "token",
    group: pixsoGroup,
    summary: s.tokenSummary,
    defaultOut: null,
    details: s.tokenDetails,
    examples: ["fguard token", "fguard token <токен>"],
    args: [{ name: s.tokenArg.name, description: s.tokenArg.description, required: false }],
    async run(ctx: CommandContext): Promise<number> {
      ctx.ui.header([s.tokenHeader]);
      if (ctx.binDir === undefined) return refuse(ctx, s.tokenNoBinDir, EXIT_FAILURE);
      const value = (ctx.source ?? (await readSecret(pick(s.tokenPrompt, ctx.lang)))).trim();
      if (value === "") return refuse(ctx, s.tokenEmpty, EXIT_USAGE);
      const file = join(ctx.binDir, ".env");
      try {
        const next = withToken(existsSync(file) ? readFileSync(file, "utf8") : "", value);
        if (next === undefined) return refuse(ctx, s.tokenUnwritable, EXIT_USAGE);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, next, { mode: 0o600 });
        // `mode` applies only when the file is CREATED; an existing one is narrowed here.
        chmodSync(file, 0o600);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return refuse(ctx, s.tokenWriteFailed(detail), EXIT_FAILURE);
      }
      ctx.ui.end();
      emitPaths(ctx, [file]);
      ctx.ui.summary({
        ok: true,
        headline: s.tokenSaved,
        rows: [{ key: s.tokenFileRow, value: file, kind: "path" }],
      });
      return EXIT_OK;
    },
  };
}
