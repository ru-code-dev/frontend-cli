/**
 * THE SEAM between the cli's configuration resolution and this package's two endpoints.
 *
 * WHO OWNS WHAT. Resolution PRECEDENCE — CLI flag (`--endpoint`/`--token`) > env/.env key >
 * `cli/src/constants.ts` default (design 2.1:105-111) — is the cli's job and is deliberately
 * NOT reimplemented here. This package only needs the ANSWER, so it takes one: `PixsoRuntime`
 * is three resolved values, and `pixsoRuntimeOf` is the one place they are lifted out of the
 * frozen `CommandContext` (`packages/cli-kit/src/index.ts:53-63`), which carries no dedicated
 * slot for them and — being frozen — is not getting one.
 *
 * WHERE THEY ARE READ FROM, in order:
 *   1. `ctx.flags[<name>]` — the resolved value, when the cli put one there. This is the slot
 *      that lets the cli's precedence win, because by the time it writes here it has already
 *      applied the flag-over-env-over-default order.
 *   2. `ctx.env[<name>]` — the same three names are the recognized environment/`.env` keys
 *      (design 2.1:109-110), and the cli loads `./.env` into `process.env` at startup
 *      (design 2.1:126-127), so this arm alone already makes every command work.
 *   3. `pixso-core`'s own endpoint constants, which is exactly what design 2.1:106-108 fixes
 *      as the default for each name. A missing token has NO default and stays `undefined` —
 *      the remote route turns that into an actionable, localized refusal (`routing.ts`).
 *
 * The names are the owner-fixed ones (design 2.1:105-110, "EXACT names, 0 changes allowed").
 * Empty string is treated as absent throughout: a `.env` line with nothing after the `=` is a
 * value that was never set, and letting `""` through would reach `fetchScan` as a token and be
 * refused there instead (`ru-code-packages/packages/pixso-core/src/api/scan.ts:263-264`), with
 * an English engine message instead of ours.
 */
import type { CommandContext } from "@smart-tools/fe-cli-kit";
import { PIXSO_MCP_ENDPOINT, PIXSO_REMOTE_MCP_ENDPOINT } from "@smart-tools/pixso-core";

/** The remote MCP endpoint's name, as flag key and as environment/`.env` key. */
export const REMOTE_URL_KEY = "PIXSO_REMOTE_MCP_URL";
/** The local (desktop plugin) MCP endpoint's name. */
export const LOCAL_URL_KEY = "PIXSO_LOCAL_MCP_URL";
/** The remote token's name. No default — absence is a refusal, not a fallback. */
export const TOKEN_KEY = "PIXSO_REMOTE_MCP_TOKEN";

/**
 * The three resolved values a pixso command runs against. `token` is optional because the
 * LOCAL route genuinely does not need one (`scan.ts:283-287` only adds the `Token` header when
 * one was passed); it is the REMOTE route that requires it, and that requirement is stated
 * once, in `routing.ts`, rather than being encoded as a non-optional field here.
 */
export interface PixsoRuntime {
  readonly remoteUrl: string;
  readonly localUrl: string;
  readonly token?: string | undefined;
}

/** flag → env → undefined, with `""` counted as absent. */
function resolved(ctx: CommandContext, key: string): string | undefined {
  const fromFlag = ctx.flags[key];
  if (typeof fromFlag === "string" && fromFlag !== "") return fromFlag;
  const fromEnv = ctx.env[key];
  return fromEnv !== undefined && fromEnv !== "" ? fromEnv : undefined;
}

/** Lift the runtime out of a command context. Total and pure — no process access. */
export function pixsoRuntimeOf(ctx: CommandContext): PixsoRuntime {
  return {
    remoteUrl: resolved(ctx, REMOTE_URL_KEY) ?? PIXSO_REMOTE_MCP_ENDPOINT,
    localUrl: resolved(ctx, LOCAL_URL_KEY) ?? PIXSO_MCP_ENDPOINT,
    token: resolved(ctx, TOKEN_KEY),
  };
}
