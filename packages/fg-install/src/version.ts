/**
 * IS THIS ru-code NEW ENOUGH FOR THE EMBEDDED PLUGIN — the one check behind
 * {@link MINIMUM_APP_VERSION}. The installed version is the pointer's `version`
 * (`<bin>/current.json`, read by {@link pointerOf} — the same file the frozen launcher boots from).
 */
import { MINIMUM_APP_VERSION } from "./constants.ts";
import { type Layout, pointerOf } from "./layout.ts";

type Parsed = readonly [number, number, number];

/**
 * `X.Y.Z` → three numbers, the way ru-code's frozen wrapper parses a version
 * (R/apps/server/src/ru-code/auto-update/wrapper/wrapperSource.ts:138-144): anchored at the start,
 * an optional leading `v`, and anything after the patch number — a pre-release `-rc.1`, a build
 * `+abc` — is ignored for ordering, so `0.0.34-rc.1` counts as 0.0.34. `undefined` without a
 * leading `X.Y.Z`.
 */
function parseVersion(version: string): Parsed | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(version);
  return m === null ? undefined : [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * `actual >= minimum`, major then minor then patch — ru-code's own
 * R/apps/server/src/ru-code/preflight/common/version.ts:13-22. Unparsable → `false`, as there.
 */
export function isAtLeast(actual: string, minimum: string): boolean {
  const a = parseVersion(actual);
  const m = parseVersion(minimum);
  if (a === undefined || m === undefined) return false;
  if (a[0] !== m[0]) return a[0] > m[0];
  if (a[1] !== m[1]) return a[1] > m[1];
  return a[2] >= m[2];
}

export type AppVersion =
  /** `installed` is at least {@link MINIMUM_APP_VERSION}. */
  | { readonly kind: "ok"; readonly installed: string }
  /** `installed` is older — the plugin would load as `failed`. */
  | { readonly kind: "old"; readonly installed: string }
  /** No valid pointer, or its `version` is not `X.Y.Z…` — the version cannot be verified. */
  | { readonly kind: "unknown" };

export async function appVersionOf(layout: Layout): Promise<AppVersion> {
  const pointer = await pointerOf(layout);
  if (pointer === undefined || parseVersion(pointer.version) === undefined)
    return { kind: "unknown" };
  const installed = pointer.version;
  return isAtLeast(installed, MINIMUM_APP_VERSION)
    ? { kind: "ok", installed }
    : { kind: "old", installed };
}
