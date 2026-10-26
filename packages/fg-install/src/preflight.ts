/**
 * RUN ru-code's OWN preflight and read its stdout contract — never re-implement it.
 *
 * Owner decision (brief a1 §2): the app root is whatever ru-code's install-time preflight says it
 * is, so fg can never disagree with the installer about where ru-code lives. The installer runs
 * the script as `"$NODE_PATH" <script>` with no flags and greps `KEY=VALUE` lines off stdout
 * (R/ru-code/installer/parts/30-core.sh:234-263); this module does the same with
 * `process.execPath`, from a private temp dir that is removed afterwards.
 *
 * Exit 1 is NOT a failure here: the preflight exits 1 when any check (node/cli/git) fails, after
 * having printed every key (R/apps/server/src/ru-code/preflight/preflight.ts:75-95,139-147). The
 * installer applies its own per-check policy to those keys; fg surfaces them and goes on. The one
 * thing that IS fatal is the one the installer also dies on: no `OUR_ROOT` (`30-core.sh:260`).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PREFLIGHT_ROOT_KEY, PREFLIGHT_TIMEOUT_MS } from "./constants.ts";

/** What the script printed and how it ended. */
export interface PreflightRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** `true` when the run was killed for exceeding its time budget. */
  readonly timedOut: boolean;
}

/** The parsed stdout contract. */
export interface PreflightResult {
  /** Every `KEY=VALUE` line, FIRST occurrence wins — the installer's `grep … | head -n 1`. */
  readonly keys: ReadonlyMap<string, string>;
  /** `OUR_ROOT`, backslashes turned into slashes (`30-core.sh:257`); `undefined` when absent or empty. */
  readonly ourRoot: string | undefined;
  /** `CHECK_NODE`, `CHECK_CLI`, `CHECK_GIT`, `CHECK_CLI_KIND`, in that order, when present. */
  readonly checks: readonly { readonly key: string; readonly value: string }[];
  readonly exitCode: number | null;
}

/** The check keys, in the order the preflight prints them (`preflight.ts:139-142`). */
export const CHECK_KEYS = ["CHECK_NODE", "CHECK_CLI", "CHECK_GIT", "CHECK_CLI_KIND"] as const;

/**
 * stdout → keys, exactly as `30-core.sh:242-258` reads it.
 *
 * - a key is the text before the FIRST `=`, the value everything after it (`cut -d= -f2-`);
 * - the first line carrying a key wins (`head -n 1`);
 * - a trailing `\r` is dropped, so a CRLF stream reads the same as an LF one;
 * - `OUR_ROOT` has `\` turned into `/` (`30-core.sh:257`), and an empty one counts as missing
 *   (`30-core.sh:260`, `[ -n "$APP_ROOT" ] || fail_crash`).
 */
export function parsePreflightStdout(stdout: string, exitCode: number | null): PreflightResult {
  const keys = new Map<string, string>();
  for (const raw of stdout.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const at = line.indexOf("=");
    if (at <= 0) continue;
    const key = line.slice(0, at);
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || keys.has(key)) continue;
    keys.set(key, line.slice(at + 1));
  }
  const root = keys.get(PREFLIGHT_ROOT_KEY)?.replaceAll("\\", "/");
  const checks = CHECK_KEYS.flatMap((key) => {
    const value = keys.get(key);
    return value === undefined ? [] : [{ key, value }];
  });
  return { keys, ourRoot: root === undefined || root === "" ? undefined : root, checks, exitCode };
}

/** The signals that end a run from outside; the preflight's temp dir and child must not outlive them. */
const INTERRUPTS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** SIGKILL the child — and, when it leads its own process group, everything it spawned. */
function killTree(child: ChildProcess | undefined, grouped: boolean): void {
  if (child?.pid === undefined) return;
  try {
    if (grouped) process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

/**
 * Write `script` to a fresh private temp dir, run it with `execPath`, return what it printed.
 * The temp dir is removed in every outcome. Never throws for a non-zero exit — only for a spawn
 * or filesystem failure, which the command reports.
 *
 * INTERRUPTS. For the run's duration SIGINT / SIGTERM / SIGHUP handlers are installed: each one
 * kills the child, removes the temp dir (synchronously — nothing async survives a signal), removes
 * the handlers and RE-RAISES the same signal, so fg dies exactly as it would have without them
 * (right exit status for the shell) but leaves nothing behind. On POSIX the child leads its own
 * process group (`detached`), which is what lets the kill reach the probes it spawned (git, the
 * qwen CLI) and not only the node process itself; the price is that a terminal's Ctrl-C no longer
 * reaches it by itself — the handler does that. On Windows there are no groups and `detached`
 * would open a console, so the child stays attached and only it is killed.
 */
export async function runPreflight(
  script: Uint8Array,
  options: {
    readonly execPath: string;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly timeoutMs?: number;
  },
): Promise<PreflightRun> {
  const dir = await mkdtemp(join(tmpdir(), "fg-install-preflight-"));
  const grouped = process.platform !== "win32";
  let child: ChildProcess | undefined;
  const handlers = INTERRUPTS.map((signal) => {
    const handler = (): void => {
      killTree(child, grouped);
      rmSync(dir, { recursive: true, force: true });
      removeHandlers();
      process.kill(process.pid, signal);
    };
    return [signal, handler] as const;
  });
  function removeHandlers(): void {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  }
  for (const [signal, handler] of handlers) process.on(signal, handler);
  try {
    const file = join(dir, "preflight.mjs");
    await writeFile(file, script, { mode: 0o600 });
    return await runProcess(options.execPath, [file], {
      env: options.env,
      timeoutMs: options.timeoutMs ?? PREFLIGHT_TIMEOUT_MS,
      group: grouped,
      onSpawn: (spawned) => void (child = spawned),
    });
  } finally {
    removeHandlers();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Spawn, collect both streams, resolve on `close`. A run past `timeoutMs` is SIGKILLed and
 * reported as `timedOut`. Shared by the preflight and the restart (`./runtime.ts`).
 */
export function runProcess(
  command: string,
  args: readonly string[],
  options: {
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly timeoutMs: number;
    /** Lead a process group of its own, and kill the whole group on timeout. POSIX only. */
    readonly group?: boolean;
    /** Called with the child right after it is spawned, so a caller can kill it. */
    readonly onSpawn?: (child: ChildProcess) => void;
  },
): Promise<PreflightRun> {
  return new Promise((resolve, reject) => {
    const group = options.group === true;
    const child = spawn(command, [...args], {
      env: { ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: group,
    });
    options.onSpawn?.(child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, group);
    }, options.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}
