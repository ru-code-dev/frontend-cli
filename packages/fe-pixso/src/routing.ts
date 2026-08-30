/**
 * THE ROUTE DECISION — the source argument picks the transport, the user never does.
 *
 * V1 SCOPE, owner-corrected (design 2.1:112-122). Two routes and two refusals, in this order:
 *
 *   `http(s)://…`  → REMOTE: `fetchScan({ url, token, endpoint: remoteUrl })`. The token is
 *                    REQUIRED; missing → a localized, actionable refusal, exit 2.
 *   anything else  → LOCAL:  `fetchScan({ itemId: source, endpoint: localUrl })`, no token.
 *   absent         → a localized refusal naming both accepted forms, exit 2.
 *
 * Two things are deliberately NOT here. There is no capture-path route — design 2.1:121-122
 * dropped it in the 5th feedback round ("tests use a fake MCP instead, the pattern core itself
 * uses"), so `loadCapture` is not reachable from the CLI at all, and a filesystem path typed as
 * the source is simply a guid the local plugin will not know. And there is no no-source
 * SELECTION mode: it is deferred to `WORKFLOW/core-to-do.md` because it needs a guard in core
 * relaxed first (`ru-code-packages/packages/pixso-core/src/api/scan.ts:242-243` throws when
 * neither `url` nor `itemId` is given), which this package may not touch.
 *
 * The http(s) test is `pixso-cli`'s own, kept to the character
 * (`ru-code-packages/packages/pixso-cli/src/commands.ts:98`): a prefix check on the two
 * schemes, not a `URL` construction. Whether the link is a USABLE Pixso link is the engine's
 * question and it answers it precisely (`scan.ts:259-261` names the parse kind); duplicating
 * that judgement here would be a second, weaker parser.
 */
import type { Localized } from "@smart-tools/fe-cli-kit";
import type { FetchScanOptions, PixsoClient } from "@smart-tools/pixso-core/node";

import type { PixsoRuntime } from "./runtime.ts";
import { missingSource, missingToken } from "./strings.ts";

/** The exit code both refusals carry. `2` is the usage-error code the design fixes for the
 *  whole surface (design 2.1:82, 2.1:118). */
export const USAGE_EXIT = 2;

export type PixsoRoute =
  | {
      readonly kind: "remote";
      readonly url: string;
      readonly token: string;
      readonly endpoint: string;
    }
  | { readonly kind: "local"; readonly itemId: string; readonly endpoint: string };

export type RouteResolution =
  | { readonly ok: true; readonly route: PixsoRoute }
  | { readonly ok: false; readonly message: Localized; readonly exitCode: number };

/** True for the REMOTE route's source form. */
export function isDesignLink(source: string): boolean {
  return source.startsWith("http://") || source.startsWith("https://");
}

/** The whole decision, pure: a source plus resolved config in, a route or a refusal out. */
export function resolveRoute(source: string | undefined, runtime: PixsoRuntime): RouteResolution {
  if (source === undefined || source === "") {
    return { ok: false, message: missingSource, exitCode: USAGE_EXIT };
  }
  if (!isDesignLink(source)) {
    return { ok: true, route: { kind: "local", itemId: source, endpoint: runtime.localUrl } };
  }
  const token = runtime.token;
  if (token === undefined || token === "") {
    return { ok: false, message: missingToken, exitCode: USAGE_EXIT };
  }
  return {
    ok: true,
    route: { kind: "remote", url: source, token, endpoint: runtime.remoteUrl },
  };
}

/**
 * The route as `fetchScan` wants it, with the test transport threaded through.
 *
 * `client` is spread CONDITIONALLY rather than written as `client: deps.client`, because under
 * `exactOptionalPropertyTypes` (`tsconfig.base.json`) an explicit `undefined` is not assignable
 * to `FetchScanOptions.client?: PixsoClient` — and, more to the point, passing the key at all
 * with `undefined` in it would be a different call than not passing it: core reads
 * `options.client ?? makePixsoClient(...)` (`scan.ts:279-287`), so omitting the key IS the
 * "default to core's own behaviour" branch.
 */
export function fetchOptionsOf(
  route: PixsoRoute,
  client?: PixsoClient | undefined,
): FetchScanOptions {
  const transport = client === undefined ? {} : { client };
  return route.kind === "remote"
    ? { url: route.url, token: route.token, endpoint: route.endpoint, ...transport }
    : { itemId: route.itemId, endpoint: route.endpoint, ...transport };
}
