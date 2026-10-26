/**
 * EVERY ru-code FACT `fg install` DEPENDS ON — one module, one constant each, each with the
 * ru-code `path:line` it mirrors.
 *
 * Owner decision (brief a1 §2-3): fg does NOT re-implement ru-code's path logic. The app root
 * comes from ru-code's OWN preflight (`./preflight.ts` runs the embedded copy), and everything
 * below is a NAME inside that root, never a rule for finding it. `T3CODE_HOME`, `--base-dir` and
 * `RU_CODE_PLUGINS_DIR` are dev/test overrides in ru-code and are deliberately absent here.
 *
 * Path prefixes in the comments:
 *   R/ = `t3-ru-code/ru-code`, P/ = `t3-ru-code/ru-code-packages`.
 */

/** `<OUR_ROOT>/plugins` — the runtime (user) plugins root. R/apps/server/src/ru-code/plugins/paths.ts:35 */
export const PLUGINS_DIR_NAME = "plugins";

/** `<OUR_ROOT>/userdata` — the state dir of a normal (non-dev) run. R/apps/server/src/config.ts:116-119 */
export const STATE_DIR_NAME = "userdata";

/** `<stateDir>/server-runtime.json` — the running daemon's record. R/apps/server/src/config.ts:141 */
export const SERVER_RUNTIME_FILE = "server-runtime.json";

/** `<OUR_ROOT>/bin` — the installed app. R/ru-code/installer/parts/30-core.sh:262 */
export const BIN_DIR_NAME = "bin";

/** `<bin>/cli.js` — the frozen launcher; "installed" ⇔ it is a file. R/ru-code/installer/parts/10-head-config.sh:32, 30-core.sh:342-354 */
export const ENTRY_JS = "cli.js";

/** `<bin>/current.json` — the version pointer. R/ru-code/installer/parts/10-head-config.sh:37 */
export const POINTER_JSON = "current.json";

/** The pointer schema the frozen wrapper accepts. R/apps/server/src/ru-code/auto-update/wrapper/wrapperSource.ts:172 */
export const POINTER_SCHEMA = 1;

/**
 * THE OLDEST ru-code `fg install` PUTS THE EMBEDDED PLUGIN INTO — compared with the pointer's
 * `version` (`<bin>/current.json`). The embedded pixso build calls a host API (`ctx.publish`,
 * R/apps/server/src/ru-code/plugins/state.ts, added by ru-code commit `0789709c71`, 2026-09-26)
 * that release 0.0.33 does not have: there the host marks the plugin `failed` while fg reported
 * success. ru-code HEAD still says 0.0.33 (R/apps/server/package.json:3), so 0.0.34 is the first
 * release that can carry the API.
 *
 * Bump it when a new vendor plugin build needs a newer ru-code.
 */
export const MINIMUM_APP_VERSION = "0.0.34";

/** `<bin>/ru-code` — the sh launcher the installer writes. R/ru-code/branding/src/index.ts:56, 30-core.sh:500-506 */
export const APP_COMMAND = "ru-code";

/** The node flags the launcher passes before `cli.js`. R/scripts/build-installer.ts:86 */
export const NODE_FLAGS: readonly string[] = [
  "--experimental-sqlite",
  "--disable-warning=ExperimentalWarning",
];

/**
 * `ru-code restart --no-browser` — the daemon restart without a new browser tab: `restart` is
 * R/apps/server/src/bin.ts:53-68, `--no-browser` is a shared server flag (R/apps/server/src/cli/config.ts:54,224)
 * the daemon forwards to its child (R/ru-code/daemon/src/childArgs.ts:64-67).
 */
export const RESTART_ARGS: readonly string[] = ["restart", "--no-browser"];

/** `<plugin>/plugin.json`. R/apps/server/src/ru-code/plugins/manifest.ts:53 */
export const PLUGIN_MANIFEST_FILENAME = "plugin.json";

/** The only manifest API version the host loads. P/packages/plugin-sdk/src/contracts/manifest.ts:27,283-284 */
export const PLUGIN_API_VERSION = 2;

/** A plugin id. P/packages/plugin-sdk/src/contracts/manifest.ts:35 */
export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/** The manifest fields that name a file inside the plugin folder. R/apps/server/src/ru-code/plugins/manifest.ts:56 */
export const PLUGIN_MANIFEST_PATH_FIELDS = ["server", "web", "styles"] as const;

/** `server-runtime.json`'s on-disk version. R/ru-code/daemon/src/runtimeState.ts:14 */
export const RUNTIME_STATE_VERSION = 1;

/** The preflight's stdout key for the app root. R/apps/server/src/ru-code/preflight/preflight.ts:75 */
export const PREFLIGHT_ROOT_KEY = "OUR_ROOT";

/**
 * fg's OWN scratch directory, `<OUR_ROOT>/.fg-install/` — OUTSIDE `<plugins>/`, because ru-code reads
 * every subdirectory of `<plugins>/` as a plugin, dot-folders included
 * (R/apps/server/src/ru-code/plugins/scan.ts:62-88). Fixed names, no random suffixes:
 * `lock/` (atomic `mkdir` lock, a `pid` file inside), `lock.takeover/` (atomic `mkdir`, held only while
 * a stale `lock/` is being taken over), `new/` (the stage), `old/` (the previous copy while a swap is
 * in flight).
 */
export const WORK_DIR_NAME = ".fg-install";
export const LOCK_DIR_NAME = "lock";
export const LOCK_TAKEOVER_DIR_NAME = "lock.takeover";
export const NEW_DIR_NAME = "new";
export const OLD_DIR_NAME = "old";

/** A preflight that has not exited by then is killed; ru-code's own probes are 3 s and 2 s. */
export const PREFLIGHT_TIMEOUT_MS = 60_000;

/** `ru-code restart` launches with up to 3 attempts (R/ru-code/daemon/src/launch.ts:116-208). */
export const RESTART_TIMEOUT_MS = 180_000;
