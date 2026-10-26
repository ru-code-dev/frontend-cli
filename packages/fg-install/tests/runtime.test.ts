/**
 * TIER 1 — "is ru-code running" (R/ru-code/daemon/src/daemonStatus.ts:26-46) and the exact restart
 * process for each platform.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { layoutOf } from "../src/layout.ts";
import { isProcessAlive, nodeOfLauncher, restartCommandOf, runningOf } from "../src/runtime.ts";
import { cleanScratch, fakeRuCode, launcherText, runtimeState, scratch } from "./support.ts";

afterEach(cleanScratch);

/** A pid that existed and is now gone: a child that has already exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
    encoding: "utf8",
  });
  return Number(child.stdout);
}

describe("runningOf", () => {
  it("is running when the state file names a LIVE pid (this test process)", async () => {
    const root = scratch();
    runtimeState(root, process.pid);
    expect(await runningOf(layoutOf(root, "pixso"))).toEqual({
      running: true,
      pid: process.pid,
      origin: "http://127.0.0.1:7777",
    });
  });

  it("is not running when the pid is dead", async () => {
    const root = scratch();
    const pid = deadPid();
    runtimeState(root, pid);
    expect(await runningOf(layoutOf(root, "pixso"))).toEqual({ running: false, why: "dead", pid });
  });

  it("is not running when there is no state file", async () => {
    expect(await runningOf(layoutOf(scratch(), "pixso"), () => true)).toEqual({
      running: false,
      why: "no-file",
    });
  });

  for (const [what, body] of [
    ["garbage JSON", "{not json"],
    [
      "a wrong version",
      JSON.stringify({ version: 2, pid: 1, port: 1, origin: "o", startedAt: "s" }),
    ],
    [
      "a string pid",
      JSON.stringify({ version: 1, pid: "1", port: 1, origin: "o", startedAt: "s" }),
    ],
    ["no origin", JSON.stringify({ version: 1, pid: 1, port: 1, startedAt: "s" })],
  ] as const) {
    it(`is not running with ${what} — even when every pid looks alive`, async () => {
      const root = scratch();
      mkdirSync(join(root, "userdata"), { recursive: true });
      writeFileSync(join(root, "userdata", "server-runtime.json"), body);
      expect(await runningOf(layoutOf(root, "pixso"), () => true)).toEqual({
        running: false,
        why: "unreadable",
      });
    });
  }

  it("an empty file is `no-file`, like ru-code's own reader (runtimeState.ts:39-42)", async () => {
    const root = scratch();
    mkdirSync(join(root, "userdata"), { recursive: true });
    writeFileSync(join(root, "userdata", "server-runtime.json"), "  \n");
    expect(await runningOf(layoutOf(root, "pixso"), () => true)).toEqual({
      running: false,
      why: "no-file",
    });
  });
});

describe("isProcessAlive", () => {
  it("is true for this process and false for an exited child", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(deadPid())).toBe(false);
  });
});

const FLAGS = ["--experimental-sqlite", "--disable-warning=ExperimentalWarning"];

describe("restartCommandOf — node directly, like the installer (40-main.sh:63-80), one path for every OS", () => {
  it("runs the node BAKED INTO the launcher, with the node flags and bin/cli.js — never the sh launcher", async () => {
    const root = scratch();
    const baked = join(root, "baked-node");
    writeFileSync(baked, "");
    fakeRuCode(root, { node: baked });
    const layout = layoutOf(root, "pixso");
    expect(await restartCommandOf(layout)).toEqual({
      command: baked,
      args: [...FLAGS, layout.cliJs, "restart", "--no-browser"],
    });
  });

  it("a baked node that is gone → `node` from PATH (the wrapper's own `exec node` fallback), NOT process.execPath", async () => {
    const root = scratch();
    fakeRuCode(root, { node: join(root, "vanished", "node") });
    const layout = layoutOf(root, "pixso");
    const cmd = await restartCommandOf(layout);
    expect(cmd.command).toBe("node");
    expect(cmd.command).not.toBe(process.execPath);
  });

  it("no launcher at all → `node` from PATH", async () => {
    const layout = layoutOf(scratch(), "pixso");
    expect(await restartCommandOf(layout)).toEqual({
      command: "node",
      args: [...FLAGS, layout.cliJs, "restart", "--no-browser"],
    });
  });

  it("is the same on every platform: the result does not depend on process.platform", async () => {
    const root = scratch();
    fakeRuCode(root);
    const layout = layoutOf(root, "pixso");
    const original = Object.getOwnPropertyDescriptor(process, "platform")!;
    try {
      Object.defineProperty(process, "platform", { value: "win32" });
      const win = await restartCommandOf(layout);
      Object.defineProperty(process, "platform", { value: "linux" });
      expect(await restartCommandOf(layout)).toEqual(win);
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  });
});

describe("nodeOfLauncher — reads NODE_PATH back from the installer's wrapper (30-core.sh:492-505)", () => {
  it("POSIX form: the quoted word after `exec`, not the unquoted `exec node` fallback", () => {
    expect(nodeOfLauncher(launcherText("/opt/node/bin/node"))).toBe("/opt/node/bin/node");
  });

  it("Windows form: the same `if [ -x '<node>' ]` / `exec '<node>'` lines with a node-form path and a baked cli path", () => {
    const text = [
      "#!/bin/sh",
      "if [ -x 'C:/Program Files/nodejs/node.exe' ] || [ -f 'C:/Program Files/nodejs/node.exe' ]; then",
      "  exec 'C:/Program Files/nodejs/node.exe' --experimental-sqlite --disable-warning=ExperimentalWarning 'C:/Users/u/.ru-code/bin/cli.js' \"$@\"",
      "fi",
      "exec node --experimental-sqlite --disable-warning=ExperimentalWarning 'C:/Users/u/.ru-code/bin/cli.js' \"$@\"",
      "",
    ].join("\n");
    expect(nodeOfLauncher(text)).toBe("C:/Program Files/nodejs/node.exe");
  });

  it("undoes the installer's single-quote escaping (`'` is written `'\\''`)", () => {
    expect(nodeOfLauncher(launcherText("/home/o'brien/node"))).toBe("/home/o'brien/node");
  });

  it("undefined when there is no quoted exec word", () => {
    expect(nodeOfLauncher('#!/bin/sh\nexec node cli.js "$@"\n')).toBeUndefined();
    expect(nodeOfLauncher("")).toBeUndefined();
  });
});
