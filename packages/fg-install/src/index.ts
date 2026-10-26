/**
 * `@smart-tools/fg-install` — `fg install`, `fg install --check`, `fg uninstall`: the pixso
 * plugin into ru-code, located by ru-code's own preflight (brief a1, `WORKFLOW/features/pixso-install`).
 *
 * The runtime surface is the commands and the pieces the tests drive directly. The build-time
 * packer lives behind the separate `./pack` export so nothing of it reaches `fg.mjs`.
 */
export { createInstallCommands, installCommands, type InstallDeps } from "./commands.ts";
export * as installConstants from "./constants.ts";
export { embeddedPayload } from "./embedded.ts";
export {
  type InstalledState,
  LockedError,
  type SwapFs,
  inspectInstalled,
  installPlugin,
  uninstallPlugin,
} from "./install.ts";
export { type Layout, type Shadow, layoutOf, shadowOf } from "./layout.ts";
export {
  type InstallPayload,
  type ManifestProblem,
  type PackedFile,
  type PackedPayload,
  type PayloadFile,
  payloadOf,
  sha256,
  unpackPayload,
  validateManifest,
} from "./payload.ts";
export {
  CHECK_KEYS,
  type PreflightResult,
  type PreflightRun,
  parsePreflightStdout,
  runPreflight,
} from "./preflight.ts";
export {
  type IsAlive,
  type RestartCommand,
  type Running,
  isProcessAlive,
  nodeOfLauncher,
  restartCommandOf,
  runningOf,
} from "./runtime.ts";
