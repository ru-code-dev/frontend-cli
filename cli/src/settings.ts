/**
 * THE PRECEDENCE CHAIN, as a pure function — and the channel that carries its answer to a
 * command.
 *
 * Precedence is PER VALUE, not per source (design 2.1:110-111): a `--token` on the command line
 * does not discard an endpoint that came from `.env`. Each of the three settings independently
 * takes the first of:
 *
 *   1. the CLI flag        `--endpoint` / `--token`
 *   2. the environment     `PIXSO_REMOTE_MCP_URL` / `PIXSO_LOCAL_MCP_URL` /
 *                          `PIXSO_REMOTE_MCP_TOKEN`   (process env, with `./.env` merged in)
 *   3. the built-in default in `cli/src/constants.ts`
 *
 * `resolveSettings` takes the environment as an ARGUMENT rather than reading `process.env`,
 * which is what makes the chain testable with fabricated environments and keeps the whole file
 * free of process access.
 */
import { PIXSO_LOCAL_MCP_URL, PIXSO_REMOTE_MCP_TOKEN, PIXSO_REMOTE_MCP_URL } from "./constants.ts";
import type { PixsoRuntime } from "./registry.ts";

/** The three owner-fixed names (design 2.1:105-109). Env keys AND `CommandContext.env` keys. */
export const SETTING_KEYS = {
  remoteUrl: "PIXSO_REMOTE_MCP_URL",
  localUrl: "PIXSO_LOCAL_MCP_URL",
  token: "PIXSO_REMOTE_MCP_TOKEN",
} as const;

/** The two flags that can override a setting, as `parseArgs` hands them over. */
export interface SettingFlags {
  readonly endpoint?: string | undefined;
  readonly token?: string | undefined;
}

/** An environment, injectable. `process.env`'s shape, without being `process.env`. */
export type Env = Readonly<Record<string, string | undefined>>;

/**
 * Take the first non-empty value in the chain. Empty string counts as ABSENT for the URLs:
 * `PIXSO_REMOTE_MCP_URL=` in a `.env` is a user clearing a line, not a request to talk to the
 * empty endpoint, and an empty endpoint could only fail later and more confusingly.
 */
function firstSet(...candidates: readonly (string | undefined)[]): string | undefined {
  return candidates.find((c) => c !== undefined && c !== "");
}

/**
 * Resolve all three settings. Total: every field always gets a string, because the constants
 * layer always has one.
 *
 * `--endpoint` deliberately overrides BOTH URLs. There is one endpoint flag and two endpoint
 * settings because the route is chosen automatically from the source argument, never by the
 * user (design 2.1:112-121) — so at the moment `--endpoint` is typed, the user cannot say which
 * of the two they mean, and exactly one of them will be consulted by the invocation. Overriding
 * both makes `--endpoint` mean "talk to THIS endpoint", which is the only thing it can honestly
 * mean; overriding one would silently do nothing for half the inputs.
 */
export function resolveSettings(flags: SettingFlags, env: Env): PixsoRuntime {
  return {
    remoteUrl:
      firstSet(flags.endpoint, env[SETTING_KEYS.remoteUrl], PIXSO_REMOTE_MCP_URL) ??
      PIXSO_REMOTE_MCP_URL,
    localUrl:
      firstSet(flags.endpoint, env[SETTING_KEYS.localUrl], PIXSO_LOCAL_MCP_URL) ??
      PIXSO_LOCAL_MCP_URL,
    // The token chain does NOT treat empty as absent the way the URLs do: the default IS the
    // empty string (`constants.ts`), so "absent" and "empty" are the same state and collapsing
    // them changes nothing. `?? ""` keeps the field a string rather than optional-undefined.
    token: flags.token ?? env[SETTING_KEYS.token] ?? PIXSO_REMOTE_MCP_TOKEN,
  };
}

/**
 * THE CHANNEL. Project resolved settings back onto the three owner-fixed names, to be merged
 * into `CommandContext.env` before a command runs.
 *
 * Why `env` and not a dedicated field: the cli-kit contract is FROZEN
 * (`packages/cli-kit/src/index.ts` — `CommandContext` has `source`, `out`, `lang`, `env`,
 * `flags`, `stdout`, `stderr` at `:53-63`, and no runtime slot), so a feature package can only
 * be handed strings through `env` or `flags`. `env` is the right one of those two, and not by
 * elimination: the design fixes these three names as the environment keys themselves
 * ("The SAME three names are the recognized `.env`/environment keys", design 2.1:109). A
 * command reading `ctx.env.PIXSO_LOCAL_MCP_URL` is therefore reading the documented key — it
 * simply gets the FULLY RESOLVED value, flag overrides already applied, instead of the raw one.
 * The CLI owns precedence (brief 3.2 deliverable 2: "resolution precedence is the cli's job")
 * and the feature package owns the reading; this function is the seam between them.
 */
export function settingsToEnv(runtime: PixsoRuntime): Record<string, string> {
  return {
    [SETTING_KEYS.remoteUrl]: runtime.remoteUrl,
    [SETTING_KEYS.localUrl]: runtime.localUrl,
    [SETTING_KEYS.token]: runtime.token ?? "",
  };
}
