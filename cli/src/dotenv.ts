/**
 * `./.env`, loaded at startup — the ONE place in this CLI that touches the filesystem outside a
 * command.
 *
 * Zero dependencies by construction: Node has shipped `process.loadEnvFile()` since v20.12 /
 * v21.7, so the design takes the built-in rather than `dotenv` (design 2.1:126-128) and the
 * bundle stays a single self-contained file.
 *
 * TWO behaviours were VERIFIED against node v24.14.1 rather than assumed, because both shape
 * the code below:
 *
 *  1. `loadEnvFile` does NOT clobber variables already in `process.env`. With `FOO=fromproc` in
 *     the real environment and `FOO=fromfile` in the file, `process.env.FOO` stays `fromproc`.
 *     That is the conventional dotenv precedence and it means `.env` and the real environment
 *     collapse into ONE tier of `resolveSettings`'s chain, exactly as the design describes it
 *     ("env/.env key", design 2.1:110) — no separate merge step is needed here.
 *  2. Node's parser is LENIENT. A line with no `=`, or `=novalue`, is skipped without error;
 *     it does not throw on syntactic junk. What throws is an unreadable file: a directory named
 *     `.env` gives `ERR_INVALID_ARG_TYPE`, a missing one gives `ENOENT`.
 *
 * (2) is why the wrapper exists and why the brief's "malformed .env yields a localized error,
 * not a stack trace" is implemented as catch-everything rather than catch-a-parse-error: the
 * failure modes that actually occur are I/O-shaped, and an uncaught one of them would spill a
 * node stack trace at a user who mistyped a path.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Localized } from "@smart-tools/fg-cli-kit";

import { envLoadFailed } from "./messages.ts";

/**
 * What the loader reports. `loaded: false` with no error is the ordinary case of "there is no
 * `.env` here", which is not a problem and must not print anything.
 */
export type DotEnvResult =
  | { readonly loaded: boolean; readonly error?: undefined }
  | { readonly loaded: false; readonly error: Localized };

/**
 * Load `<cwd>/.env`, then `<binDir>/.env`, each only if it exists. Never throws.
 *
 * THE ORDER IS THE PRECEDENCE. `process.loadEnvFile` never overwrites a variable that is already
 * set (behaviour 1 above), so whatever is loaded first wins: the real environment, then the
 * project's `./.env`, then the bundle-side file `fguard token` writes beside `fg.mjs`
 * (`<root>/fg/bin/.env` once installed — E3: flag > env / project `.env` > bundle `.env` >
 * constants). The flag is applied above all three by `resolveSettings`.
 *
 * `cwd` and `binDir` are parameters, not `process.cwd()` / `import.meta.url`, so a test can point
 * them at temp directories without chdir-ing the whole runner. The load itself is unavoidably
 * global — `process.loadEnvFile` writes into `process.env` and offers no other target — which is
 * the reason `resolveSettings` reads an injected environment instead of `process.env`: the global
 * write stays confined to this one function, and everything downstream is pure.
 */
export function loadDotEnv(cwd: string, binDir?: string): DotEnvResult {
  let loaded = false;
  const files = [join(cwd, ".env")];
  if (binDir !== undefined) {
    const bundle = join(binDir, ".env");
    if (bundle !== files[0]) files.push(bundle);
  }
  for (const path of files) {
    if (!existsSync(path)) continue;
    try {
      process.loadEnvFile(path);
      loaded = true;
    } catch (cause) {
      return {
        loaded: false,
        error: envLoadFailed(path, cause instanceof Error ? cause.message : String(cause)),
      };
    }
  }
  return { loaded };
}
