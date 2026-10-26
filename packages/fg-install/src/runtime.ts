/**
 * IS ru-code RUNNING, and HOW TO RESTART IT — owner decision (brief a1 §5).
 *
 * Running = `<stateDir>/server-runtime.json` decodes AND its pid is alive — the same two facts
 * ru-code's own daemon reads before deciding anything (R/ru-code/daemon/src/daemonStatus.ts:26-46).
 * Restart = what the user would type, `ru-code restart --no-browser`, through the installed
 * launcher. A plain `ru-code restart` STARTS an app that was not running and opens a browser tab
 * (R/ru-code/daemon/src/restart.ts:9-15), which is why fg asks the first question before it ever
 * asks ru-code to do the second.
 */
import { readFile } from "node:fs/promises";

import { NODE_FLAGS, RESTART_ARGS, RUNTIME_STATE_VERSION } from "./constants.ts";
import type { Layout } from "./layout.ts";
import { isFile } from "./layout.ts";

/** Is `pid` alive? Injectable so a test can say "yes" or "no" without owning a process. */
export type IsAlive = (pid: number) => boolean;

/**
 * R/ru-code/daemon/src/signal.ts:11-20, verbatim in behaviour: signal 0 probes; ESRCH is gone,
 * EPERM is alive-but-not-ours and still counts as alive.
 */
export const isProcessAlive: IsAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException | undefined)?.code === "EPERM";
  }
};

const optionalString = (v: unknown): boolean => v === undefined || typeof v === "string";

export type Running =
  | { readonly running: true; readonly pid: number; readonly origin: string }
  | {
      readonly running: false;
      readonly why: "no-file" | "unreadable" | "dead";
      readonly pid?: number | undefined;
    };

/**
 * Decode the state file the way R/ru-code/daemon/src/runtimeState.ts:13-47 does: absent, empty or
 * undecodable all mean "no known daemon". Required fields: `version === 1`, integer `pid` and
 * `port`, string `origin` and `startedAt`; `host`/`pairingUrl`, when present, are strings.
 */
export async function runningOf(
  layout: Layout,
  isAlive: IsAlive = isProcessAlive,
): Promise<Running> {
  let text: string;
  try {
    text = (await readFile(layout.runtimeState, "utf8")).trim();
  } catch {
    return { running: false, why: "no-file" };
  }
  if (text === "") return { running: false, why: "no-file" };
  let state: unknown;
  try {
    state = JSON.parse(text);
  } catch {
    return { running: false, why: "unreadable" };
  }
  if (state === null || typeof state !== "object") return { running: false, why: "unreadable" };
  const s = state as Record<string, unknown>;
  if (
    s["version"] !== RUNTIME_STATE_VERSION ||
    !Number.isInteger(s["pid"]) ||
    !Number.isInteger(s["port"]) ||
    typeof s["origin"] !== "string" ||
    typeof s["startedAt"] !== "string" ||
    !optionalString(s["host"]) ||
    !optionalString(s["pairingUrl"])
  ) {
    return { running: false, why: "unreadable" };
  }
  const pid = s["pid"] as number;
  return isAlive(pid)
    ? { running: true, pid, origin: s["origin"] as string }
    : { running: false, why: "dead", pid };
}

/** The exact process fg spawns to restart ru-code. */
export interface RestartCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * The node the installer baked into the launcher (`NODE_PATH`): the single-quoted word right after
 * `exec` in `<bin>/ru-code` (R/ru-code/installer/parts/30-core.sh:492-505, written on Windows too):
 *
 *     #!/bin/sh
 *     if [ -x '<node>' ] || [ -f '<node>' ]; then
 *       exec '<node>' <flags> <cli.js> "$@"
 *     fi
 *     exec node <flags> <cli.js> "$@"          <- unquoted: the PATH fallback, NOT matched
 *
 * The installer quotes with `sed "s/'/'\\''/g"`, i.e. a `'` inside the path is written `'\''`; this
 * reads that back. `undefined` when there is no such quoted `exec` word (a launcher of another
 * shape, or none).
 */
export function nodeOfLauncher(launcher: string): string | undefined {
  const line = /^[ \t]*exec[ \t]+(')/mu.exec(launcher);
  if (line === null) return undefined;
  let at = line.index + line[0].length - 1;
  let word = "";
  while (at < launcher.length) {
    const ch = launcher[at];
    if (ch === "'") {
      const end = launcher.indexOf("'", at + 1);
      if (end < 0) return undefined;
      word += launcher.slice(at + 1, end);
      at = end + 1;
    } else if (ch === "\\" && launcher[at + 1] === "'") {
      word += "'";
      at += 2;
    } else {
      break;
    }
  }
  return word === "" ? undefined : word;
}

/**
 * `ru-code restart --no-browser`, the way ru-code's INSTALLER runs ru-code: node directly, one
 * code path on every OS —
 *
 *     <NODE> --experimental-sqlite --disable-warning=ExperimentalWarning <OUR_ROOT>/bin/cli.js restart --no-browser
 *
 * The installer never executes the sh wrapper `<bin>/ru-code`: it runs `"$NODE_PATH" $NODE_FLAGS
 * "$BIN_DIR/$ENTRY_JS" <args>` (R/ru-code/installer/parts/40-main.sh:63-80 `launch_app`,
 * 30-core.sh:371-382 `confirmed_stop`, 30-core.sh:510-512 `verify_app`) because executing a script
 * from `<bin>` can be denied on a machine where `node cli.js` runs. The frozen `cli.js` imports
 * the current version in the same process with the same argv
 * (R/apps/server/src/ru-code/auto-update/wrapper/wrapperSource.ts:7-9,255-261), so the two words
 * reach ru-code's `restart` command untouched.
 *
 * `<NODE>` is the `NODE_PATH` the installer baked into the wrapper ({@link nodeOfLauncher}): used
 * when that file exists, otherwise `node` from PATH — exactly the wrapper's own fallback line
 * (`exec node …`, 30-core.sh:502). NEVER fg's own `process.execPath`: ru-code's daemon child
 * inherits `process.execPath` and `execArgv` (R/ru-code/daemon/src/spawnServerChild.ts:35-36), so
 * the server must come up on the node the installer chose (native addons, `node:sqlite`), not on
 * whichever node runs fg. (Windows: UNVERIFIED by run.)
 */
export async function restartCommandOf(layout: Layout): Promise<RestartCommand> {
  let baked: string | undefined;
  try {
    baked = nodeOfLauncher(await readFile(layout.launcher, "utf8"));
  } catch {
    baked = undefined;
  }
  const node = baked !== undefined && (await isFile(baked)) ? baked : "node";
  return { command: node, args: [...NODE_FLAGS, layout.cliJs, ...RESTART_ARGS] };
}
