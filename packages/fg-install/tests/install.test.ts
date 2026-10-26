/**
 * TIER 1 — target resolution, the shadow rule, the atomic swap (incl. a mid-swap failure),
 * idempotency, and an uninstall that never touches plugin data.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  LockedError,
  type SwapFs,
  inspectInstalled,
  installPlugin,
  uninstallPlugin,
} from "../src/install.ts";
import { layoutOf, shadowOf } from "../src/layout.ts";
import { cleanScratch, fakeRuCode, fixturePayload, scratch, shipOwnCopy } from "./support.ts";

afterEach(cleanScratch);

const read = (path: string) => readFileSync(path, "utf8");

/** A pid that existed and is now gone. */
function deadPid(): number {
  return Number(
    spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
      encoding: "utf8",
    }).stdout,
  );
}

/** `installPlugin` for a layout — fg's scratch dir is `layout.workDir`, NEVER inside `<plugins>/`. */
const put = (
  layout: ReturnType<typeof layoutOf>,
  payload: ReturnType<typeof fixturePayload>,
  fs?: SwapFs,
) => installPlugin(layout.target, layout.workDir, payload, fs);
const work = (layout: ReturnType<typeof layoutOf>, ...names: string[]) =>
  join(layout.workDir, ...names);
const names = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).toSorted() : []);

/** Plant a lock owned by `pid` (a directory with a `pid` file, as the installer of the lock makes it). */
function plantLock(layout: ReturnType<typeof layoutOf>, pid: number | undefined): string {
  const lock = work(layout, "lock");
  mkdirSync(lock, { recursive: true });
  if (pid !== undefined) writeFileSync(join(lock, "pid"), String(pid));
  return lock;
}

describe("layoutOf — every path is a NAME inside OUR_ROOT", () => {
  it("puts the plugin at <root>/plugins/<id> and its data at <root>/userdata/plugins/<id>", () => {
    const layout = layoutOf("/home/work/u/.ru-code", "pixso");
    expect(layout.target).toBe("/home/work/u/.ru-code/plugins/pixso");
    expect(layout.dataDir).toBe("/home/work/u/.ru-code/userdata/plugins/pixso");
    expect(layout.cliJs).toBe("/home/work/u/.ru-code/bin/cli.js");
    expect(layout.launcher).toBe("/home/work/u/.ru-code/bin/ru-code");
    expect(layout.runtimeState).toBe("/home/work/u/.ru-code/userdata/server-runtime.json");
  });

  it("ignores T3CODE_HOME and RU_CODE_PLUGINS_DIR (owner decision: dev/test overrides)", () => {
    const before = { t: process.env["T3CODE_HOME"], p: process.env["RU_CODE_PLUGINS_DIR"] };
    process.env["T3CODE_HOME"] = "/elsewhere";
    process.env["RU_CODE_PLUGINS_DIR"] = "/elsewhere/plugins";
    try {
      expect(layoutOf("/r/.ru-code", "pixso").target).toBe("/r/.ru-code/plugins/pixso");
    } finally {
      for (const [key, value] of [
        ["T3CODE_HOME", before.t],
        ["RU_CODE_PLUGINS_DIR", before.p],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("shadowOf — ru-code's own copy wins (PluginHost.ts:773-813)", () => {
  it("is `shadowed` when the pointed version ships plugins/<id>", async () => {
    const root = scratch();
    fakeRuCode(root, { version: "0.0.40" });
    const shipped = shipOwnCopy(root, "pixso", "0.0.40");
    expect(await shadowOf(layoutOf(root, "pixso"), "pixso")).toEqual({
      kind: "shadowed",
      shippedDir: shipped,
      version: "0.0.40",
    });
  });

  it("is `clear` when the pointed version ships no such folder — even if ANOTHER version does", async () => {
    const root = scratch();
    fakeRuCode(root, { version: "0.0.40" });
    shipOwnCopy(root, "pixso", "0.0.33");
    expect((await shadowOf(layoutOf(root, "pixso"), "pixso")).kind).toBe("clear");
  });

  it("is `clear` when the shipped entry is a FILE, not a folder (scan.ts:86-87)", async () => {
    const root = scratch();
    fakeRuCode(root, { version: "0.0.40" });
    mkdirSync(join(root, "bin", "versions", "0.0.40", "plugins"), { recursive: true });
    writeFileSync(join(root, "bin", "versions", "0.0.40", "plugins", "pixso"), "");
    expect((await shadowOf(layoutOf(root, "pixso"), "pixso")).kind).toBe("clear");
  });

  for (const [what, body] of [
    ["no current.json", undefined],
    ["garbage JSON", "{nope"],
    ["schema 2", JSON.stringify({ schema: 2, version: "1", entry: "versions/1/cli.js" })],
    ["no entry", JSON.stringify({ schema: 1, version: "1" })],
  ] as const) {
    it(`is \`unknown\` with ${what}`, async () => {
      const root = scratch();
      mkdirSync(join(root, "bin"), { recursive: true });
      if (body !== undefined) writeFileSync(join(root, "bin", "current.json"), body);
      expect((await shadowOf(layoutOf(root, "pixso"), "pixso")).kind).toBe("unknown");
    });
  }
});

describe("installPlugin — atomic, verified, idempotent", () => {
  it("writes exactly the payload's bytes into <plugins>/<id>; <plugins> holds ONLY plugins; fg's scratch is empty afterwards", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    const payload = fixturePayload(root);
    const outcome = await put(layout, payload);
    expect(outcome).toEqual({ changed: true, previous: "absent" });
    for (const file of payload.files) {
      expect(readFileSync(join(layout.target, file.path))).toEqual(Buffer.from(file.bytes));
    }
    expect(names(layout.pluginsDir)).toEqual(["pixso"]);
    // lock released, stage renamed into place, no backup: the scratch dir is empty.
    expect(names(layout.workDir)).toEqual([]);
    expect(await inspectInstalled(layout.target, payload)).toBe("identical");
  });

  it("the stage and the backup are under <OUR_ROOT>/.fg-install, and the ONLY renames are target→old and new→target (audit V6)", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    await put(layout, fixturePayload(root, "old"));
    const calls: Array<[string, string]> = [];
    const spy: SwapFs = {
      rename: async (from, to) => {
        calls.push([from, to]);
        await rename(from, to);
      },
    };
    const written: string[] = [];
    await put(layout, fixturePayload(root, "new"), {
      ...spy,
      writeFile: async (path, bytes) => {
        written.push(path);
        await writeFile(path, bytes);
      },
    });
    expect(calls).toEqual([
      [layout.target, work(layout, "old")],
      [work(layout, "new"), layout.target],
    ]);
    // …so neither the stage's parent nor anything written is inside <plugins>/.
    expect(written.length).toBeGreaterThan(0);
    for (const path of written) {
      expect(path.startsWith(`${layout.workDir}/new/`), path).toBe(true);
      expect(path.startsWith(`${layout.pluginsDir}/`), path).toBe(false);
    }
  });

  it("is a no-op when identical bytes are already installed", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    const payload = fixturePayload(root);
    await put(layout, payload);
    const inode = statSync(layout.target).ino;
    const outcome = await put(layout, payload);
    expect(outcome).toEqual({ changed: false, previous: "identical" });
    // Same folder object: nothing was swapped.
    expect(statSync(layout.target).ino).toBe(inode);
  });

  it("replaces a different build WHOLE — a file only the old build had is gone", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    await put(layout, fixturePayload(root, "old"));
    writeFileSync(join(layout.target, "stray.txt"), "left by the old build");
    const outcome = await put(layout, fixturePayload(root, "new"));
    expect(outcome).toEqual({ changed: true, previous: "different" });
    expect(read(join(layout.target, "server", "index.mjs"))).toContain("server new");
    expect(existsSync(join(layout.target, "stray.txt"))).toBe(false);
    expect(names(layout.pluginsDir)).toEqual(["pixso"]);
    expect(names(layout.workDir)).toEqual([]);
  });

  it("ROLLS BACK when the swap fails mid-way: the old plugin is intact and nothing is left over", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    await put(layout, fixturePayload(root, "old"));
    let calls = 0;
    const failingSecondRename: SwapFs = {
      rename: async (from, to) => {
        calls += 1;
        // Call 1 moves the old folder to old/; call 2 — the new folder into place — fails.
        if (calls === 2) throw new Error("EIO: simulated failure while swapping");
        await rename(from, to);
      },
    };
    await expect(put(layout, fixturePayload(root, "new"), failingSecondRename)).rejects.toThrow(
      /simulated/,
    );
    expect(read(join(layout.target, "server", "index.mjs"))).toContain("server old");
    expect(await inspectInstalled(layout.target, fixturePayload(root, "old"))).toBe("identical");
    expect(names(layout.pluginsDir)).toEqual(["pixso"]);
    expect(names(layout.workDir)).toEqual([]);
  });

  it("a FAILING ROLLBACK keeps the ORIGINAL error (the rollback error is its `cause`), and the old plugin survives in old/", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    await put(layout, fixturePayload(root, "old"));
    let calls = 0;
    const failing: SwapFs = {
      rename: async (from, to) => {
        calls += 1;
        if (calls === 2) throw new Error("EIO: the swap failed");
        if (calls === 3) throw new Error("EIO: the rollback failed too");
        await rename(from, to);
      },
    };
    const error = await put(layout, fixturePayload(root, "new"), failing).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("EIO: the swap failed");
    expect(((error as Error).cause as Error).message).toBe("EIO: the rollback failed too");
    expect(existsSync(layout.target)).toBe(false);
    expect(read(join(work(layout, "old"), "server", "index.mjs"))).toContain("server old");
  });

  it("CRASH RECOVERY: target missing + old/ present → old/ is restored first, so a failing run leaves the old plugin in place", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    await put(layout, fixturePayload(root, "old"));
    // A run killed between the two renames: the plugin exists only as old/.
    mkdirSync(layout.workDir, { recursive: true });
    await rename(layout.target, work(layout, "old"));
    expect(existsSync(layout.target)).toBe(false);

    const failingWrite: SwapFs = {
      rename,
      writeFile: async () => {
        throw new Error("ENOSPC: simulated");
      },
    };
    await expect(put(layout, fixturePayload(root, "new"), failingWrite)).rejects.toThrow(/ENOSPC/);
    expect(await inspectInstalled(layout.target, fixturePayload(root, "old"))).toBe("identical");
    expect(existsSync(work(layout, "old"))).toBe(false);
  });

  it("with the target present, a stale old/ and new/ are cleared and the target is NOT replaced by old/", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    await put(layout, fixturePayload(root, "current"));
    mkdirSync(work(layout, "old"), { recursive: true });
    writeFileSync(join(work(layout, "old"), "plugin.json"), "{}");
    mkdirSync(work(layout, "new"), { recursive: true });
    writeFileSync(join(work(layout, "new"), "junk"), "x");
    expect(await put(layout, fixturePayload(root, "current"))).toEqual({
      changed: false,
      previous: "identical",
    });
    expect(names(layout.workDir)).toEqual([]);
    expect(await inspectInstalled(layout.target, fixturePayload(root, "current"))).toBe(
      "identical",
    );
  });

  it("a failed FIRST install leaves no target, nothing in <plugins>, nothing in the scratch dir", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    const failing: SwapFs = { rename: async () => Promise.reject(new Error("EACCES: simulated")) };
    await expect(put(layout, fixturePayload(root), failing)).rejects.toThrow();
    expect(names(layout.pluginsDir)).toEqual([]);
    expect(names(layout.workDir)).toEqual([]);
  });

  it("POST-WRITE sha256 READ-BACK: a corrupting write fails the install and the old plugin stays intact (audit V3)", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    await put(layout, fixturePayload(root, "old"));
    const corrupting: SwapFs = {
      rename,
      writeFile: async (path, bytes) => {
        const bad = Uint8Array.from(bytes);
        if (bad.length > 0) bad[0] = bad[0]! ^ 0xff;
        await writeFile(path, bad);
      },
    };
    await expect(put(layout, fixturePayload(root, "new"), corrupting)).rejects.toThrow(
      /verification failed/,
    );
    expect(await inspectInstalled(layout.target, fixturePayload(root, "old"))).toBe("identical");
    expect(names(layout.workDir)).toEqual([]);
  });

  it("EXDEV on the first rename (plugins/ on another disk): a CLEAN failure, the target untouched", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    await put(layout, fixturePayload(root, "old"));
    const exdev: SwapFs = {
      rename: async () => {
        throw Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" });
      },
    };
    await expect(put(layout, fixturePayload(root, "new"), exdev)).rejects.toThrow(/EXDEV/);
    expect(await inspectInstalled(layout.target, fixturePayload(root, "old"))).toBe("identical");
    expect(names(layout.workDir)).toEqual([]);
  });
});

describe("installPlugin — the folder's mode (audit 3)", () => {
  it("is 0o777 & ~umask, like a copy ru-code stages itself — not mkdtemp's 0700", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    await put(layout, fixturePayload(root));
    expect(statSync(layout.target).mode & 0o777).toBe(0o777 & ~process.umask());
  });

  for (const umask of [0o077, 0o027, 0o002]) {
    it(`honours the umask it is given: ${umask.toString(8).padStart(3, "0")} → ${(0o777 & ~umask).toString(8)}`, async () => {
      const root = scratch();
      const layout = layoutOf(root, "pixso");
      await put(layout, fixturePayload(root), { rename, umask: () => umask });
      expect(statSync(layout.target).mode & 0o777).toBe(0o777 & ~umask);
    });
  }
});

describe("the lock — <workDir>/lock/ with a pid file", () => {
  it("a LIVE holder → LockedError(pid), nothing is touched, and the holder's lock and scratch survive", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    const lock = plantLock(layout, process.pid);
    mkdirSync(work(layout, "new"), { recursive: true });
    writeFileSync(join(work(layout, "new"), "in-flight"), "A's stage");
    const error = await put(layout, fixturePayload(root)).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(LockedError);
    expect((error as LockedError).pid).toBe(process.pid);
    expect((error as LockedError).lockPath).toBe(lock);
    expect(read(join(lock, "pid"))).toBe(String(process.pid));
    expect(read(join(work(layout, "new"), "in-flight"))).toBe("A's stage");
    expect(existsSync(layout.target)).toBe(false);
  });

  it("a STALE lock (dead pid) is taken over, the install goes through, and the lock is released", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    plantLock(layout, deadPid());
    expect(await put(layout, fixturePayload(root))).toEqual({ changed: true, previous: "absent" });
    expect(existsSync(work(layout, "lock"))).toBe(false);
  });

  it("a lock with no pid yet is a live (just-created) holder; the same lock long abandoned is stale", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    const lock = plantLock(layout, undefined);
    await expect(put(layout, fixturePayload(root))).rejects.toBeInstanceOf(LockedError);
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    expect((await put(layout, fixturePayload(root))).changed).toBe(true);
  });

  it("the lock is RELEASED when the run fails", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    const failing: SwapFs = { rename: async () => Promise.reject(new Error("EACCES: simulated")) };
    await expect(put(layout, fixturePayload(root), failing)).rejects.toThrow();
    expect(existsSync(work(layout, "lock"))).toBe(false);
  });

  it("holds the lock while it works: a concurrent run is refused mid-swap", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    let second: unknown;
    const probing: SwapFs = {
      rename: async (from, to) => {
        second = await put(layout, fixturePayload(root, "other")).then(
          () => undefined,
          (e: unknown) => e,
        );
        await rename(from, to);
      },
    };
    await put(layout, fixturePayload(root), probing);
    expect(second).toBeInstanceOf(LockedError);
    expect((second as LockedError).pid).toBe(process.pid);
  });

  it("uninstall takes the same lock: live → refused, stale → taken over", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    await put(layout, fixturePayload(root));
    plantLock(layout, process.pid);
    await expect(uninstallPlugin(layout.target, layout.workDir)).rejects.toBeInstanceOf(
      LockedError,
    );
    expect(existsSync(layout.target)).toBe(true);
    plantLock(layout, deadPid());
    expect(await uninstallPlugin(layout.target, layout.workDir)).toBe(true);
    expect(existsSync(work(layout, "lock"))).toBe(false);
  });
});

describe("stale takeover — serialised by <workDir>/lock.takeover/", () => {
  /** Run A's pid in the simulations below; their `isAlive` calls it alive. */
  const A_PID = 4_000_001;

  /**
   * Run A taking over the stale lock, done synchronously at the instant run B consults `isAlive`,
   * by the same protocol as `acquireLock`: `mkdir lock.takeover/` (refused if it exists), replace
   * `lock/` with one holding A's pid, release `lock.takeover/`. `true` when A got the lock.
   */
  function takeOverAsA(layout: ReturnType<typeof layoutOf>): boolean {
    try {
      mkdirSync(work(layout, "lock.takeover"));
    } catch {
      return false;
    }
    try {
      rmSync(work(layout, "lock"), { recursive: true, force: true });
      mkdirSync(work(layout, "lock"));
      writeFileSync(work(layout, "lock", "pid"), String(A_PID));
      return true;
    } finally {
      rmSync(work(layout, "lock.takeover"), { recursive: true, force: true });
    }
  }

  it("B judges the lock stale, A completes a takeover, then B goes on → B is refused, A's lock survives", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    const dead = deadPid();
    plantLock(layout, dead);
    let aGotIt = false;
    const isAlive = (pid: number): boolean => {
      if (pid === dead && !aGotIt) aGotIt = takeOverAsA(layout);
      return pid === A_PID;
    };
    const error = await installPlugin(
      layout.target,
      layout.workDir,
      fixturePayload(root),
      undefined,
      isAlive,
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(aGotIt).toBe(true);
    expect(error).toBeInstanceOf(LockedError);
    expect((error as LockedError).pid).toBe(A_PID);
    expect(read(work(layout, "lock", "pid"))).toBe(String(A_PID));
    expect(names(layout.workDir)).toEqual(["lock"]);
    expect(existsSync(layout.target)).toBe(false);
  });

  it("A tries a takeover while B is inside its own → A is refused at lock.takeover, only B holds the lock", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    plantLock(layout, deadPid());
    let calls = 0;
    let aGotIt: boolean | undefined;
    const isAlive = (pid: number): boolean => {
      calls += 1;
      // call 1: B's first judgement; call 2: B's re-read, made while B holds lock.takeover/.
      if (calls === 2) aGotIt = takeOverAsA(layout);
      return pid === A_PID;
    };
    expect(
      await installPlugin(layout.target, layout.workDir, fixturePayload(root), undefined, isAlive),
    ).toEqual({
      changed: true,
      previous: "absent",
    });
    expect(aGotIt).toBe(false);
    expect(names(layout.workDir)).toEqual([]);
  });

  it("two REAL concurrent installs on a dead-pid lock: exactly one wins, the other gets LockedError (50×)", async () => {
    const dead = deadPid();
    for (let round = 0; round < 50; round += 1) {
      const root = scratch();
      const layout = layoutOf(root, "pixso");
      const payload = fixturePayload(root);
      plantLock(layout, dead);
      const results = await Promise.allSettled([put(layout, payload), put(layout, payload)]);
      const won = results.filter((r) => r.status === "fulfilled");
      const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(won).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0]?.reason).toBeInstanceOf(LockedError);
      expect(await inspectInstalled(layout.target, payload)).toBe("identical");
      expect(names(layout.workDir)).toEqual([]);
    }
  }, 60_000);

  it("a lock.takeover/ older than LOCK_ORPHAN_MS is cleared; a fresh one → LockedError and is left alone", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    plantLock(layout, deadPid());
    const takeover = work(layout, "lock.takeover");
    mkdirSync(takeover);
    const error = await put(layout, fixturePayload(root)).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(LockedError);
    expect((error as LockedError).lockPath).toBe(takeover);
    expect(existsSync(takeover)).toBe(true);
    const old = new Date(Date.now() - 60_000);
    utimesSync(takeover, old, old);
    expect(await put(layout, fixturePayload(root))).toEqual({ changed: true, previous: "absent" });
    expect(names(layout.workDir)).toEqual([]);
  });
});

describe("nothing of fg's is ever inside <plugins>/ (ru-code reads EVERY subdirectory there — scan.ts:62-88)", () => {
  it("after a replace, a failed swap, a failed rollback, a lock refusal and an uninstall, <plugins> lists only real plugins", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    mkdirSync(join(layout.pluginsDir, "analytics"), { recursive: true });
    await put(layout, fixturePayload(root, "a"));
    await put(layout, fixturePayload(root, "b"));
    expect(names(layout.pluginsDir)).toEqual(["analytics", "pixso"]);
    let calls = 0;
    await put(layout, fixturePayload(root, "c"), {
      rename: async (from, to) => {
        calls += 1;
        if (calls >= 2) throw new Error("EIO");
        await rename(from, to);
      },
    }).catch(() => undefined);
    expect(names(layout.pluginsDir)).toEqual(["analytics"]);
    // (the old plugin sits in old/ after the failed rollback — outside plugins/)
    expect(names(layout.workDir)).toEqual(["old"]);
    plantLock(layout, process.pid);
    await put(layout, fixturePayload(root, "d")).catch(() => undefined);
    expect(names(layout.pluginsDir)).toEqual(["analytics"]);
  });
});

describe("inspectInstalled — `identical` means exactly the payload", () => {
  it("an extra file makes it `different`", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    const payload = fixturePayload(root);
    await put(layout, payload);
    writeFileSync(join(layout.target, "extra.txt"), "x");
    expect(await inspectInstalled(layout.target, payload)).toBe("different");
  });

  it("a changed byte makes it `different`", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    const payload = fixturePayload(root);
    await put(layout, payload);
    writeFileSync(join(layout.target, "web", "styles.css"), "/* v2 */\n");
    expect(await inspectInstalled(layout.target, payload)).toBe("different");
  });

  it("a symlink in place of the folder is `different` (and install replaces it with real files)", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    const payload = fixturePayload(root);
    const real = join(root, "real-pixso");
    await installPlugin(join(real, "pixso"), join(real, ".fg-install"), payload);
    mkdirSync(layout.pluginsDir, { recursive: true });
    symlinkSync(join(real, "pixso"), layout.target);
    expect(await inspectInstalled(layout.target, payload)).toBe("different");
    await put(layout, payload);
    expect(statSync(layout.target).isDirectory()).toBe(true);
    expect(await inspectInstalled(layout.target, payload)).toBe("identical");
  });
});

describe("uninstallPlugin", () => {
  it("removes <plugins>/<id> and leaves <stateDir>/plugins/<id> (data) and disabled.json alone", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    await put(layout, fixturePayload(root));
    mkdirSync(layout.dataDir, { recursive: true });
    writeFileSync(join(layout.dataDir, "data.sqlite"), "user data");
    writeFileSync(join(layout.stateDir, "plugins", "disabled.json"), '{"disabled":[]}');
    mkdirSync(join(layout.pluginsDir, "analytics"));

    expect(await uninstallPlugin(layout.target, layout.workDir)).toBe(true);
    expect(existsSync(layout.target)).toBe(false);
    expect(read(join(layout.dataDir, "data.sqlite"))).toBe("user data");
    expect(read(join(layout.stateDir, "plugins", "disabled.json"))).toBe('{"disabled":[]}');
    expect(names(layout.pluginsDir)).toEqual(["analytics"]);
    expect(names(layout.workDir)).toEqual([]);
  });

  it("answers `false` when nothing is installed — and creates nothing", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    expect(await uninstallPlugin(layout.target, layout.workDir)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  it("clears a crash leftover in old/ / new/ when it removes", async () => {
    const root = scratch();
    const layout = layoutOf(root, "pixso");
    await put(layout, fixturePayload(root));
    mkdirSync(work(layout, "old"), { recursive: true });
    mkdirSync(work(layout, "new"), { recursive: true });
    expect(await uninstallPlugin(layout.target, layout.workDir)).toBe(true);
    expect(names(layout.workDir)).toEqual([]);
  });
});
