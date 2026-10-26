/**
 * THE PAYLOAD THIS BUILD CARRIES — substituted by the `fg` bundle build.
 *
 * `cli/tsdown.config.ts` packs `vendor/ru-code/` with `./pack.ts` and hands the result to the
 * bundler as `define: { __FG_INSTALL_PAYLOAD__: "<json>" }`, the same textual substitution
 * `__FG_VERSION__` uses (`cli/src/version.ts`). Anywhere else — this package's own library build,
 * a unit test — the identifier is undeclared and this returns `null`; the commands then refuse
 * with a clear message rather than install nothing.
 */
import { type InstallPayload, type PackedPayload, unpackPayload } from "./payload.ts";

declare const __FG_INSTALL_PAYLOAD__: string | undefined;

/** The packed JSON, or `undefined` outside the `fg` bundle. */
const PACKED: string | undefined =
  typeof __FG_INSTALL_PAYLOAD__ === "string" ? __FG_INSTALL_PAYLOAD__ : undefined;

/** Unpack (and sha256-verify) the embedded payload; `null` when this build carries none. */
export function embeddedPayload(): InstallPayload | null {
  return PACKED === undefined ? null : unpackPayload(JSON.parse(PACKED) as PackedPayload);
}
