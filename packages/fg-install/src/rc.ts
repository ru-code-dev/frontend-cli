/**
 * THE `fguard` COMMAND IN NEW SHELLS — ru-code's own rc code, run with fg's values (D2, D3).
 *
 * fg writes no rc line, no `env.sh` and no launcher of its own design. It SOURCES ru-code's
 * generated installer, vendored verbatim (`vendor/ru-code/install`, shipped as `ru-code-install`),
 * through the seam ru-code's own test harness uses — `RU_CODE_INSTALL_NO_MAIN=1` loads every
 * function and runs nothing (R/ru-code/installer/parts/40-main.sh:258-261,
 * R/apps/server/src/ru-code/tests/install/harness.ts:182-205) — and calls the same functions, in
 * the same order, as ru-code's `phase_commit` (R/ru-code/installer/parts/40-main.sh:22-37):
 *
 *     create_wrapper; clean_rc; add_path        (install)       clean_rc        (uninstall)
 *
 * with fg's globals in place of ru-code's (R/ru-code/installer/parts/25-rc-path.sh:1-60 lists them):
 *
 *     APP_BIN      fguard                  the function / wrapper name
 *     BIN_DIR      <root>/fg/bin           where env.sh, the wrapper and fg.mjs live
 *     ENTRY_JS     fg.mjs                  what the function / wrapper runs
 *     NODE_PATH    <NODE>                  the node ru-code's installer chose (check_node_floor)
 *     NODE_FLAGS   (none)
 *     APP_DIR_NAME <basename root>/fg      the MARKER: every rc edit keys on "/$APP_DIR_NAME/bin"
 *
 * WHY THE TWO OWNERS NEVER TOUCH EACH OTHER. ru-code's marker is `/<base>/bin`, fg's is
 * `/<base>/fg/bin` (`<base>` = basename of the root). fg's line names `<root>/fg/bin`, which does
 * not contain `/<base>/bin`; ru-code's names `<root>/bin`, which does not contain
 * `/<base>/fg/bin` — unless the ROOT itself already contains one of the two markers, which
 * {@link markerClash} refuses before anything is written. So ru-code's scrub keeps fg's line and
 * fg's scrub keeps ru-code's (`rc_render`, 25-rc-path.sh:208-249). The legacy marker
 * `# <APP_BIN> v` becomes `# fguard v` — not ru-code's either.
 *
 * THE MODE is whatever the vendored installer has baked in `USE_RC_SOURCED_LAUNCHER` (owner's
 * production: sourced `env.sh`; HEAD: classic PATH line), overridable exactly as ru-code's is, by
 * `INSTALL_USE_RC_SOURCED_LAUNCHER` in the environment (10-head-config.sh:81).
 */
import { basename } from "node:path";

import { FG_COMMAND, FG_DISPLAY_NAME, FG_ENTRY } from "./constants.ts";
import { runProcess } from "./preflight.ts";

/** The bash that drives the vendored functions. Every value arrives through the environment. */
export const RC_SCRIPT = `
. "$FG_RC_INSTALLER"
LOGFILE="$FG_RC_LOG"
detect_os
APP_DISPLAY_NAME="$FG_RC_DISPLAY_NAME"
APP_DIR_NAME="$FG_RC_DIR_NAME"
APP_BIN="$FG_RC_BIN"
BIN_DIR="$FG_RC_BIN_DIR"
ENTRY_JS="$FG_RC_ENTRY"
NODE_PATH="$FG_RC_NODE"
NODE_FLAGS=""
if [ "$FG_RC_ACTION" = add ]; then
  create_wrapper
  clean_rc
  status=0
  add_path || status=$?
  printf 'FG_RC_LINE=%s\\n' "$PATH_LINE"
  printf 'FG_RC_MODE=%s\\n' "$USE_RC_SOURCED_LAUNCHER"
  while IFS= read -r f; do
    if rc_has_our_line "$f"; then printf 'FG_RC_FILE=%s\\n' "$f"; fi
  done < <(rc_files)
  exit "$status"
fi
clean_rc
`;

/** What a run of {@link applyRc} reports. */
export interface RcResult {
  readonly code: number | null;
  /** The line written into every rc file (install only). */
  readonly line: string | undefined;
  /** `true` when the line sources `<bin>/env.sh` (the function launcher). */
  readonly sourced: boolean;
  /** The rc files that now hold the line as a line of their own (install only). */
  readonly files: readonly string[];
  readonly stdout: string;
  readonly stderr: string;
}

/** `APP_DIR_NAME` for fg: the marker stem `<basename root>/fg`. */
export const markerOf = (root: string): string => `${basename(root)}/fg`;

/**
 * The root already contains ru-code's marker or fg's as a directory sequence — then the two
 * owners' lines could match each other's scrub, and nothing may be written. `undefined` = clear.
 */
export function markerClash(root: string): string | undefined {
  const base = basename(root);
  const withSlash = `${root.replaceAll("\\", "/")}/`;
  for (const marker of [`/${base}/bin/`, `/${base}/fg/bin/`]) {
    if (withSlash.includes(marker)) return marker.slice(0, -1);
  }
  return undefined;
}

export async function applyRc(request: {
  readonly action: "add" | "remove";
  /** The vendored ru-code installer (`ru-code-install`). */
  readonly installer: string;
  readonly root: string;
  /** `<root>/fg/bin`. */
  readonly binDir: string;
  /** `<NODE>`; unused by `remove`. */
  readonly node: string;
  /** The journal ru-code's `log` writes to; `/dev/null` when nothing is worth keeping. */
  readonly logFile: string;
  /** The shell's environment: HOME, ZDOTDIR and ru-code's own `INSTALL_*` overrides pass through. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly bash?: string | undefined;
}): Promise<RcResult> {
  const run = await runProcess(request.bash ?? "bash", ["-c", RC_SCRIPT], {
    env: {
      ...request.env,
      RU_CODE_INSTALL_NO_MAIN: "1",
      FG_RC_ACTION: request.action,
      FG_RC_INSTALLER: request.installer,
      FG_RC_LOG: request.logFile,
      FG_RC_DISPLAY_NAME: FG_DISPLAY_NAME,
      FG_RC_DIR_NAME: markerOf(request.root),
      FG_RC_BIN: FG_COMMAND,
      FG_RC_BIN_DIR: request.binDir,
      FG_RC_ENTRY: FG_ENTRY,
      FG_RC_NODE: request.node,
    },
    timeoutMs: 60_000,
  });
  const lines = run.stdout.split(/\r?\n/u);
  const value = (key: string): string | undefined =>
    lines.find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1);
  const line = value("FG_RC_LINE");
  return {
    code: run.timedOut ? null : run.code,
    line,
    sourced: line !== undefined && line.startsWith("[ -f "),
    files: lines.filter((l) => l.startsWith("FG_RC_FILE=")).map((l) => l.slice(11)),
    stdout: run.stdout,
    stderr: run.stderr,
  };
}
