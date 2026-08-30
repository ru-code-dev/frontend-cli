/**
 * `@smart-tools/fe-pixso` — the pixso feature package, and the engine boundary.
 *
 * `cli` imports `pixsoCommands` and concatenates it into the registry; adding a feature to the
 * product is a new package plus one import line (design 2.1:79-81). Everything that knows what
 * `@smart-tools/pixso-core` is lives behind this door — `commands.ts` is the only module in the
 * repo that imports it (design 2.1:143-145).
 *
 * The surface is deliberately small. `pixsoCommands` is what the product consumes;
 * `createPixsoCommands` exists for the tier-1 suites, which drive the real handlers through the
 * real core pipeline against an injected fake transport (design 2.1:149-153); the routing and
 * runtime pieces are exported because the cli's own help/diagnostics may want to name the same
 * three configuration keys rather than re-spell them.
 */
export { createPixsoCommands, pixsoCommands, type PixsoDeps } from "./commands.ts";

export {
  fetchOptionsOf,
  isDesignLink,
  resolveRoute,
  USAGE_EXIT,
  type PixsoRoute,
  type RouteResolution,
} from "./routing.ts";

export {
  pixsoRuntimeOf,
  LOCAL_URL_KEY,
  REMOTE_URL_KEY,
  TOKEN_KEY,
  type PixsoRuntime,
} from "./runtime.ts";

export { ASSET_FILES } from "./strings.ts";
