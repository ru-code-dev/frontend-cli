/**
 * TIER 1 — the preflight's stdout contract, read exactly as ru-code's installer reads it
 * (R/ru-code/installer/parts/30-core.sh:239-263), and the runner that executes the script.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { parsePreflightStdout, runPreflight } from "../src/preflight.ts";
import { cleanScratch, fakePreflight, scratch } from "./support.ts";

afterEach(cleanScratch);

const counts = () => ["SIGINT", "SIGTERM", "SIGHUP"].map((s) => process.listenerCount(s));

const CONTRACT = [
  "OUR_ROOT=/home/u/.ru-code",
  "APP_BIN=ru-code",
  "NODE_OK=1",
  "CLI_JS=",
  "CONFIG_DIR=/home/u/.qwen",
  "CHECK_NODE=ok",
  "CHECK_CLI=fail",
  "CHECK_GIT=ok",
  "CHECK_CLI_KIND=missing",
].join("\n");

describe("parsePreflightStdout", () => {
  it("reads OUR_ROOT and the four check facts", () => {
    const result = parsePreflightStdout(`${CONTRACT}\n`, 1);
    expect(result.ourRoot).toBe("/home/u/.ru-code");
    expect(result.checks).toEqual([
      { key: "CHECK_NODE", value: "ok" },
      { key: "CHECK_CLI", value: "fail" },
      { key: "CHECK_GIT", value: "ok" },
      { key: "CHECK_CLI_KIND", value: "missing" },
    ]);
    expect(result.exitCode).toBe(1);
    // An empty value is still a key — `CLI_JS=` is how the preflight says "not found".
    expect(result.keys.get("CLI_JS")).toBe("");
  });

  it("reads a CRLF stream the same as an LF one", () => {
    const lf = parsePreflightStdout(CONTRACT, 0);
    const crlf = parsePreflightStdout(CONTRACT.replaceAll("\n", "\r\n"), 0);
    expect(crlf.ourRoot).toBe(lf.ourRoot);
    expect([...crlf.keys]).toEqual([...lf.keys]);
  });

  it("keeps the FIRST occurrence of a key (the installer's `head -n 1`)", () => {
    expect(parsePreflightStdout("OUR_ROOT=/first\nOUR_ROOT=/second\n", 0).ourRoot).toBe("/first");
  });

  it("splits on the FIRST `=` only (the installer's `cut -d= -f2-`)", () => {
    expect(parsePreflightStdout("OUR_ROOT=/a=b/c\n", 0).ourRoot).toBe("/a=b/c");
  });

  it("turns backslashes into slashes in OUR_ROOT (30-core.sh:257)", () => {
    expect(parsePreflightStdout("OUR_ROOT=C:\\Users\\me\\.ru-code\r\n", 0).ourRoot).toBe(
      "C:/Users/me/.ru-code",
    );
  });

  it("reports a missing OUR_ROOT as undefined, and an EMPTY one too (30-core.sh:260)", () => {
    expect(parsePreflightStdout("CHECK_NODE=ok\n", 1).ourRoot).toBeUndefined();
    expect(parsePreflightStdout("OUR_ROOT=\nCHECK_NODE=ok\n", 1).ourRoot).toBeUndefined();
    expect(parsePreflightStdout("", null).ourRoot).toBeUndefined();
  });

  it("returns only the check keys that were printed", () => {
    expect(parsePreflightStdout("OUR_ROOT=/r\nCHECK_GIT=fail\n", 1).checks).toEqual([
      { key: "CHECK_GIT", value: "fail" },
    ]);
  });

  it("ignores lines that are not KEY=VALUE", () => {
    const result = parsePreflightStdout("Диагностика:\n  HOME=/x\n=nope\nOUR_ROOT=/r\n", 0);
    expect([...result.keys.keys()]).toEqual(["OUR_ROOT"]);
  });
});

describe("runPreflight", () => {
  it("runs the script with the given node, and an exit-1 preflight still yields its keys", async () => {
    const root = `${scratch()}/.ru-code`;
    const run = await runPreflight(new TextEncoder().encode(fakePreflight(root, 1)), {
      execPath: process.execPath,
      env: process.env,
    });
    expect(run.code).toBe(1);
    expect(run.timedOut).toBe(false);
    const parsed = parsePreflightStdout(run.stdout, run.code);
    expect(parsed.ourRoot).toBe(root);
    expect(parsed.keys.get("CHECK_CLI")).toBe("fail");
    // stdout is the contract; the diagnostics go to stderr and never become keys.
    expect(run.stderr).toContain("Диагностика");
    expect(parsed.keys.has("HOME")).toBe(false);
  });

  it("removes its private temp dir afterwards", async () => {
    const run = await runPreflight(
      new TextEncoder().encode("process.stdout.write('DIR=' + import.meta.dirname + '\\n');"),
      { execPath: process.execPath, env: process.env },
    );
    const dir = parsePreflightStdout(run.stdout, run.code).keys.get("DIR") ?? "";
    expect(dir).toContain("fg-install-preflight-");
    expect(existsSync(dir)).toBe(false);
  });

  it("kills a preflight that never ends and says so", async () => {
    const run = await runPreflight(new TextEncoder().encode("setInterval(() => {}, 1000);"), {
      execPath: process.execPath,
      env: process.env,
      timeoutMs: 300,
    });
    expect(run.timedOut).toBe(true);
  });
});

/** `ps` state of `pid`: "" when gone. A zombie (`Z…`) is dead — only its parent has not reaped it. */
const stateOf = (pid: number): string =>
  spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();
const dead = (pid: number): boolean => stateOf(pid) === "" || stateOf(pid).startsWith("Z");
const waitFor = async (what: string, ready: () => boolean, ms = 15_000): Promise<void> => {
  const until = Date.now() + ms;
  while (!ready()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe.skipIf(process.platform === "win32")(
  "runPreflight — SIGINT / SIGTERM / SIGHUP during the run (audit 4)",
  () => {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      it(`${signal}: kills the preflight AND its grandchild, removes the temp dir, and fg dies by the SAME signal`, async () => {
        const tmp = scratch();
        const pids = join(tmp, "pids.txt");
        // A slow preflight that also spawns a probe of its own (like git / the qwen CLI), in its group.
        const slow = [
          'const { spawn } = process.getBuiltinModule("node:child_process");',
          'const fs = process.getBuiltinModule("node:fs");',
          'const probe = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
          `fs.writeFileSync(${JSON.stringify(pids)}, process.pid + " " + probe.pid);`,
          "setInterval(() => {}, 1000);",
        ].join("\n");
        const runner = spawn(
          process.execPath,
          [fileURLToPath(new URL("./interrupt-runner.ts", import.meta.url))],
          {
            env: { ...process.env, TMPDIR: tmp, F1_SCRIPT: slow },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let stdout = "";
        runner.stdout.on("data", (c: Buffer) => (stdout += String(c)));
        const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
          (resolve) => runner.on("exit", (code, sig) => resolve({ code, signal: sig })),
        );
        try {
          await waitFor(
            "the fake preflight to start",
            () => existsSync(pids) && readFileSync(pids, "utf8").includes(" "),
          );
          const [child, probe] = readFileSync(pids, "utf8").split(" ").map(Number) as [
            number,
            number,
          ];
          expect(readdirSync(tmp).some((n) => n.startsWith("fg-install-preflight-"))).toBe(true);
          expect(dead(child)).toBe(false);

          runner.kill(signal);
          expect(await exited).toEqual({ code: null, signal });
          expect(stdout).not.toContain("finished");
          expect(readdirSync(tmp).filter((n) => n.startsWith("fg-install-preflight-"))).toEqual([]);
          await waitFor(
            "the preflight and its probe to die",
            () => dead(child) && dead(probe),
            5_000,
          );
        } finally {
          if (runner.exitCode === null && runner.signalCode === null) runner.kill("SIGKILL");
        }
      });
    }

    it("the handlers exist only for the run: none are left after a success, a timeout or a spawn failure", async () => {
      const before = counts();
      await runPreflight(new TextEncoder().encode("process.stdout.write('OUR_ROOT=/x\\n')"), {
        execPath: process.execPath,
        env: process.env,
      });
      expect(counts()).toEqual(before);
      await runPreflight(new TextEncoder().encode("setInterval(() => {}, 1000);"), {
        execPath: process.execPath,
        env: process.env,
        timeoutMs: 200,
      });
      expect(counts()).toEqual(before);
      await expect(
        runPreflight(new TextEncoder().encode("x"), {
          execPath: "/nonexistent/node",
          env: process.env,
        }),
      ).rejects.toThrow();
      expect(counts()).toEqual(before);
    });

    it("while it runs, the handlers ARE installed", async () => {
      const before = process.listenerCount("SIGINT");
      const run = runPreflight(new TextEncoder().encode("setTimeout(() => {}, 300);"), {
        execPath: process.execPath,
        env: process.env,
      });
      await new Promise((r) => setTimeout(r, 100));
      expect(process.listenerCount("SIGINT")).toBe(before + 1);
      await run;
    });

    it("a timeout kills the preflight's whole process group, not only the node process", async () => {
      const tmp = scratch();
      const pids = join(tmp, "pids.txt");
      const slow = [
        'const { spawn } = process.getBuiltinModule("node:child_process");',
        'const probe = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
        `process.getBuiltinModule("node:fs").writeFileSync(${JSON.stringify(pids)}, String(probe.pid));`,
        "setInterval(() => {}, 1000);",
      ].join("\n");
      const run = await runPreflight(new TextEncoder().encode(slow), {
        execPath: process.execPath,
        env: process.env,
        timeoutMs: 1500,
      });
      expect(run.timedOut).toBe(true);
      const probe = Number(readFileSync(pids, "utf8"));
      const until = Date.now() + 5000;
      const state = () =>
        spawnSync("ps", ["-o", "stat=", "-p", String(probe)], { encoding: "utf8" }).stdout.trim();
      while (state() !== "" && !state().startsWith("Z") && Date.now() < until)
        await new Promise((r) => setTimeout(r, 50));
      expect(state() === "" || state().startsWith("Z")).toBe(true);
    });
  },
);
