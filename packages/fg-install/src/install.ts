/**
 * THE WRITES — install (atomic swap), uninstall, and the read-only comparison both start from.
 *
 * Outside `<plugins>/<id>` itself, fg's own scratch lives in ONE directory it owns,
 * `<OUR_ROOT>/.fg-install/` (`workDir`), with FIXED names: `lock/` (the lock), `lock.takeover/`
 * (held only while a stale lock is taken over), `new/` (the stage),
 * `old/` (the previous copy while the swap is in flight). NOTHING of fg's is ever put inside
 * `<plugins>/`: ru-code reads EVERY subdirectory of it as a plugin, dot-folders included
 * (R/apps/server/src/ru-code/plugins/scan.ts:62-88 — `readDirectory` then `readPluginManifest`
 * on each, no hidden-name skip), so a stage, a backup, a lock or a crash leftover there would
 * surface in ru-code as a broken plugin. Plugin data (`<stateDir>/plugins/<id>`) and the
 * switches file (`<stateDir>/plugins/disabled.json`) live elsewhere and are never opened.
 *
 * NO MARKER FILE. "Ours" is decided by comparing the folder's bytes with the embedded payload, so
 * nothing extra is ever written into a folder ru-code scans and serves.
 */
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import { LOCK_DIR_NAME, LOCK_TAKEOVER_DIR_NAME, NEW_DIR_NAME, OLD_DIR_NAME } from "./constants.ts";
import { type InstallPayload, sha256 } from "./payload.ts";
import { type IsAlive, isProcessAlive } from "./runtime.ts";

/** What is at the target, measured against the payload. */
export type InstalledState = "absent" | "identical" | "different";

/** Every regular file under `dir`, as POSIX paths relative to it; `null` if anything is not a plain file or dir. */
async function filesUnder(dir: string): Promise<string[] | null> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isDirectory()) continue;
    if (!entry.isFile()) return null;
    out.push(relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"));
  }
  return out.toSorted();
}

/**
 * `identical` only when the folder holds EXACTLY the payload's files with the payload's bytes —
 * an extra file, a missing one, a changed byte or a symlink anywhere make it `different`.
 */
export async function inspectInstalled(
  target: string,
  payload: InstallPayload,
): Promise<InstalledState> {
  const kind = await entryKind(target);
  if (kind === "absent") return "absent";
  // A file or a symlink squatting on the name is not ours: install replaces it with a real folder
  // (ru-code wants real files, scan.ts:16-21, manifest.ts:199-215).
  if (kind === "other") return "different";
  const present = await filesUnder(target);
  const expected = payload.files.map((f) => f.path).toSorted();
  if (present === null || present.join("\n") !== expected.join("\n")) return "different";
  for (const file of payload.files) {
    const bytes = await readFile(join(target, ...file.path.split("/")));
    if (sha256(bytes) !== file.sha256) return "different";
  }
  return "identical";
}

/** What sits at `path`, without following a link. */
async function entryKind(path: string): Promise<"absent" | "directory" | "other"> {
  try {
    return (await lstat(path)).isDirectory() ? "directory" : "other";
  } catch {
    return "absent";
  }
}

/**
 * The filesystem calls the swap makes — injectable so a test can fail one mid-swap, corrupt a
 * write, or pin the umask. Everything but `rename` is optional and defaults to the real thing.
 */
export interface SwapFs {
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly writeFile?: ((path: string, bytes: Uint8Array) => Promise<void>) | undefined;
  /** The process umask, for the stage's directory mode. Default: `process.umask()`. */
  readonly umask?: (() => number) | undefined;
}

const realFs: SwapFs = { rename };

/** Another fg run holds the lock. */
export class LockedError extends Error {
  override readonly name = "LockedError";
  readonly pid: number | undefined;
  readonly lockPath: string;
  constructor(pid: number | undefined, lockPath: string) {
    super(
      `another fg install/uninstall is running${pid === undefined ? "" : ` (pid ${pid})`}: ${lockPath}`,
    );
    this.pid = pid;
    this.lockPath = lockPath;
  }
}

/** A lock directory whose `pid` file never appeared is taken over only after this long (a holder that died between `mkdir` and `write`); the same age clears a `lock.takeover/` left by a run that died mid-takeover. */
const LOCK_ORPHAN_MS = 10_000;

/** Whether `path` was last modified more than {@link LOCK_ORPHAN_MS} ago (`false` if it is gone). */
async function abandoned(path: string): Promise<boolean> {
  try {
    return Date.now() - (await stat(path)).mtimeMs > LOCK_ORPHAN_MS;
  } catch {
    return false;
  }
}

async function lockHolder(lockPath: string): Promise<number | "orphan" | "unknown"> {
  try {
    const pid = Number((await readFile(join(lockPath, "pid"), "utf8")).trim());
    if (Number.isInteger(pid) && pid > 0) return pid;
  } catch {
    // no pid file (yet), or garbage — decided below by the directory's age
  }
  return (await abandoned(lockPath)) ? "orphan" : "unknown";
}

/** Returns when the lock is stale (dead holder, or an orphan that never got a pid); otherwise throws {@link LockedError}. */
async function refuseUnlessStale(lockPath: string, isAlive: IsAlive): Promise<void> {
  const holder = await lockHolder(lockPath);
  if (holder === "orphan" || (typeof holder === "number" && !isAlive(holder))) return;
  throw new LockedError(typeof holder === "number" ? holder : undefined, lockPath);
}

/** `mkdir` as an atomic test-and-set: `false` when the directory already exists. */
async function created(path: string): Promise<boolean> {
  try {
    await mkdir(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/**
 * THE LOCK: `<workDir>/lock/`. `mkdir` is atomic, so exactly one run creates it and writes its pid
 * into `lock/pid`. A run that finds it there reads the pid: alive → {@link LockedError}; dead (or
 * an orphan that never got a pid) → the lock is STALE and may be taken over. The caller releases it
 * in `finally`. Without it, run B's cleanup of `new/` and `old/` would destroy run A's in-flight swap.
 *
 * STALE TAKEOVER is serialised by a second atomic `mkdir`, `<workDir>/lock.takeover/`, so two runs
 * that both judge the same lock stale cannot both take it: only the run that creates
 * `lock.takeover/` proceeds; it RE-READS `lock/` (another run may have taken it over between the
 * first read and now), and only if it is still stale removes it, re-creates it and writes its pid.
 * `lock.takeover/` is always removed in `finally`. A run that finds `lock.takeover/` already there
 * gets {@link LockedError} — unless it is older than {@link LOCK_ORPHAN_MS} (its owner died inside
 * the takeover), then it is removed and tried once more.
 */
async function acquireLock(workDir: string, isAlive: IsAlive): Promise<() => Promise<void>> {
  await mkdir(workDir, { recursive: true });
  const lockPath = join(workDir, LOCK_DIR_NAME);
  const takeoverPath = join(workDir, LOCK_TAKEOVER_DIR_NAME);
  const release = () => rm(lockPath, { recursive: true, force: true });
  const claim = async (): Promise<boolean> => {
    if (!(await created(lockPath))) return false;
    await writeFile(join(lockPath, "pid"), String(process.pid));
    return true;
  };
  if (await claim()) return release;

  await refuseUnlessStale(lockPath, isAlive);
  if (!(await created(takeoverPath))) {
    if (!(await abandoned(takeoverPath))) throw new LockedError(undefined, takeoverPath);
    await rm(takeoverPath, { recursive: true, force: true });
    if (!(await created(takeoverPath))) throw new LockedError(undefined, takeoverPath);
  }
  try {
    await refuseUnlessStale(lockPath, isAlive);
    await rm(lockPath, { recursive: true, force: true });
    if (!(await claim())) throw new LockedError(undefined, lockPath);
    return release;
  } finally {
    await rm(takeoverPath, { recursive: true, force: true });
  }
}

export interface InstallOutcome {
  /** `false` when the folder already held exactly these bytes and nothing was written. */
  readonly changed: boolean;
  readonly previous: InstalledState;
  /** The previous copy, left in `old/`, if it could not be removed after a successful swap. */
  readonly leftover?: string | undefined;
}

/**
 * CRASH RECOVERY. A run killed between the swap's two renames leaves the previous plugin ONLY in
 * `old/`, with nothing at the target: put it back before anything is cleaned.
 */
async function recoverOldCopy(target: string, oldDir: string): Promise<void> {
  if ((await entryKind(oldDir)) === "absent") return;
  if ((await entryKind(target)) !== "absent") return;
  await mkdir(dirname(target), { recursive: true });
  await rename(oldDir, target);
}

/**
 * Install `payload` at `target`, atomically, scratch in `workDir`.
 *
 *  1. take the lock; restore `old/` if a crash left the target missing; clear `new/` and `old/`;
 *  2. write the whole folder into `new/` and verify every file's sha256 by reading it back;
 *  3. rename the target to `old/` (if there is one), then `new/` to the target — if THAT fails,
 *     rename `old/` back, and report the ORIGINAL error (a failed rollback rides along as `cause`);
 *  4. remove `old/`; release the lock.
 *
 * At every instant the target is either the complete old folder, absent for the gap between two
 * renames, or the complete new one — never a half-written mix. `workDir` is a sibling of
 * `<plugins>/` under `<OUR_ROOT>`, so on one filesystem the rename is atomic; across filesystems
 * (a `plugins/` that is a link onto another disk) the FIRST rename fails with EXDEV before anything
 * changed — a clean failure with the target untouched.
 */
export async function installPlugin(
  target: string,
  workDir: string,
  payload: InstallPayload,
  fs: SwapFs = realFs,
  isAlive: IsAlive = isProcessAlive,
): Promise<InstallOutcome> {
  const release = await acquireLock(workDir, isAlive);
  try {
    const newDir = join(workDir, NEW_DIR_NAME);
    const oldDir = join(workDir, OLD_DIR_NAME);
    await recoverOldCopy(target, oldDir);
    await rm(newDir, { recursive: true, force: true });
    await rm(oldDir, { recursive: true, force: true });
    return await swapIn(target, newDir, oldDir, payload, fs);
  } finally {
    await release();
  }
}

async function swapIn(
  target: string,
  newDir: string,
  oldDir: string,
  payload: InstallPayload,
  fs: SwapFs,
): Promise<InstallOutcome> {
  const previous = await inspectInstalled(target, payload);
  if (previous === "identical") return { changed: false, previous };

  await mkdir(newDir);
  try {
    const write = fs.writeFile ?? ((path: string, bytes: Uint8Array) => writeFile(path, bytes));
    for (const file of payload.files) {
      const path = join(newDir, ...file.path.split("/"));
      await mkdir(dirname(path), { recursive: true });
      await write(path, file.bytes);
    }
    for (const file of payload.files) {
      const written = await readFile(join(newDir, ...file.path.split("/")));
      if (sha256(written) !== file.sha256) {
        throw new Error(`verification failed after writing ${file.path}`);
      }
    }
    // A copy ru-code stages itself is `0o777 & ~umask` (cpSync); make the folder the same before it
    // becomes the plugin folder, whatever mode `mkdir` gave it. (Subdirs and files already are.)
    await chmod(newDir, 0o777 & ~(fs.umask ?? (() => process.umask()))());

    await mkdir(dirname(target), { recursive: true });
    if (previous !== "absent") await fs.rename(target, oldDir);
    try {
      await fs.rename(newDir, target);
    } catch (error) {
      if (previous !== "absent") {
        try {
          await fs.rename(oldDir, target);
        } catch (rollback) {
          // The ORIGINAL error stays the one reported; the failed rollback rides along as its
          // `cause`. The previous plugin is still in `old/`, and the next run restores it.
          if (error instanceof Error && error.cause === undefined) {
            Object.defineProperty(error, "cause", {
              value: rollback,
              configurable: true,
              writable: true,
            });
          }
        }
      }
      throw error;
    }
    if (previous === "absent") return { changed: true, previous };
    try {
      await rm(oldDir, { recursive: true, force: true });
      return { changed: true, previous };
    } catch {
      return { changed: true, previous, leftover: oldDir };
    }
  } finally {
    await rm(newDir, { recursive: true, force: true });
  }
}

/**
 * Remove the target — renamed to `old/` first so it disappears in one step, then deleted — under
 * the same lock. Returns `false` when there was nothing to remove (and nothing was created).
 */
export async function uninstallPlugin(
  target: string,
  workDir: string,
  isAlive: IsAlive = isProcessAlive,
): Promise<boolean> {
  if ((await entryKind(target)) === "absent" && (await entryKind(workDir)) === "absent")
    return false;
  const release = await acquireLock(workDir, isAlive);
  try {
    const newDir = join(workDir, NEW_DIR_NAME);
    const oldDir = join(workDir, OLD_DIR_NAME);
    await rm(newDir, { recursive: true, force: true });
    await rm(oldDir, { recursive: true, force: true });
    if ((await entryKind(target)) === "absent") return false;
    await rename(target, oldDir);
    await rm(oldDir, { recursive: true, force: true });
    return true;
  } finally {
    await release();
  }
}
