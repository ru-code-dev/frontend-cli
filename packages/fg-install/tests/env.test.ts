/**
 * TIER 1 — the environment of the preflight and of the restart (audit v1 finding 1).
 *
 * `ctx.env` is `process.env` AFTER `run()` merged `<cwd>/.env` and overlaid the `PIXSO_*`
 * settings (and `--token`). Neither the preflight nor `ru-code restart` may see that: both get the
 * SNAPSHOT of the shell's environment taken when `commands.ts` was evaluated, or an injected one.
 * The fake preflight and the fake launcher DUMP the environment they were started with.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { type InstallDeps, createInstallCommands } from "../src/commands.ts";
import { payloadOf } from "../src/payload.ts";
import {
  MANIFEST,
  cleanScratch,
  context,
  fakePreflight,
  fakeRuCode,
  runtimeState,
  scratch,
} from "./support.ts";

afterEach(() => {
  cleanScratch();
  vi.resetModules();
  for (const key of ["F1_SHELL_SENTINEL", "F1_DOTENV_ONLY"]) delete process.env[key];
});

const TOKEN = "f1-secret-token-VALUE";
/** What `run()` hands a command: the process env + a `.env`-only key + the PIXSO_* overlay + `--token`. */
const POLLUTED = {
  F1_DOTENV_ONLY: "from-dot-env",
  T3CODE_HOME: "/tmp/f1-elsewhere",
  VITE_DEV_SERVER_URL: "http://localhost:1",
  PIXSO_LOCAL_MCP_URL: "http://local.invalid/mcp",
  PIXSO_REMOTE_MCP_URL: "http://remote.invalid/mcp",
  PIXSO_REMOTE_MCP_TOKEN: TOKEN,
} as const;

/** A fake ru-code root whose preflight and launcher each dump their own environment to a JSON / env file. */
function rig(): {
  root: string;
  preflightEnv: string;
  restartEnv: string;
  payload: ReturnType<typeof payloadOf>;
} {
  const root = join(scratch(), ".ru-code");
  mkdirSync(root, { recursive: true });
  const preflightEnv = join(root, "..", "preflight-env.json");
  const restartEnv = join(root, "..", "restart-env.json");
  fakeRuCode(root, { envFile: restartEnv });
  runtimeState(root, 424242);
  const dump = `process.getBuiltinModule("node:fs").writeFileSync(${JSON.stringify(preflightEnv)}, JSON.stringify(process.env));`;
  const payload = payloadOf({
    preflight: fakePreflight(root, 1, dump),
    pluginDir: "pixso",
    files: {
      "plugin.json": JSON.stringify(MANIFEST),
      "server/index.mjs": "s\n",
      "web/index.mjs": "w\n",
      "web/styles.css": "c\n",
    },
  });
  return { root, preflightEnv, restartEnv, payload };
}

const envOf = (file: string): Record<string, string> =>
  file.endsWith(".json")
    ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, string>)
    : Object.fromEntries(
        readFileSync(file, "utf8")
          .split("\n")
          .filter((l) => l.includes("="))
          .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
      );

async function runInstall(
  deps: InstallDeps,
  polluted: Readonly<Record<string, string | undefined>>,
) {
  const r = rig();
  const [install] = createInstallCommands({
    payload: () => r.payload,
    isAlive: (pid) => pid === 424242,
    ...deps,
  });
  const run = context({ env: { ...process.env, ...polluted } });
  expect(await install!.run(run.ctx), run.err()).toBe(0);
  return { preflight: envOf(r.preflightEnv), restart: envOf(r.restartEnv) };
}

describe("the preflight and the restart run in the SHELL's environment, not fg's", () => {
  it("a `.env`-only key, the PIXSO_* settings and the --token value reach neither", async () => {
    const { preflight, restart } = await runInstall({}, POLLUTED);
    for (const [where, env] of [
      ["preflight", preflight],
      ["restart", restart],
    ] as const) {
      expect(env["F1_DOTENV_ONLY"], where).toBeUndefined();
      expect(JSON.stringify(env), where).not.toContain(TOKEN);
      for (const key of [
        "T3CODE_HOME",
        "VITE_DEV_SERVER_URL",
        "PIXSO_LOCAL_MCP_URL",
        "PIXSO_REMOTE_MCP_URL",
        "PIXSO_REMOTE_MCP_TOKEN",
      ]) {
        // Whatever the real shell had (usually nothing) — never fg's overlay.
        expect(env[key], `${where} ${key}`).toBe(process.env[key]);
      }
    }
  });

  it("…yet both DO get the shell's own variables (PATH, HOME): an empty env would break the preflight's probes", async () => {
    const { preflight, restart } = await runInstall({}, POLLUTED);
    expect(process.env["PATH"]).toBeTruthy();
    expect(preflight["PATH"]).toBe(process.env["PATH"]);
    expect(restart["PATH"]).toBe(process.env["PATH"]);
    if (process.env["HOME"] !== undefined) {
      expect(preflight["HOME"]).toBe(process.env["HOME"]);
      expect(restart["HOME"]).toBe(process.env["HOME"]);
    }
  });

  it("the default is a snapshot taken when the module is EVALUATED: a variable set later (`.env`) is absent", async () => {
    process.env["F1_SHELL_SENTINEL"] = "in-the-shell";
    vi.resetModules();
    const fresh = await import("../src/commands.ts");
    // `run()` loads `.env` into process.env AFTER the modules were evaluated:
    process.env["F1_DOTENV_ONLY"] = "from-dot-env";
    delete process.env["F1_SHELL_SENTINEL"];

    const r = rig();
    const [install] = fresh.createInstallCommands({
      payload: () => r.payload,
      isAlive: (pid) => pid === 424242,
    });
    const run = context({ env: { ...process.env, ...POLLUTED } });
    expect(await install!.run(run.ctx), run.err()).toBe(0);
    for (const env of [envOf(r.preflightEnv), envOf(r.restartEnv)]) {
      expect(env["F1_SHELL_SENTINEL"]).toBe("in-the-shell");
      expect(env["F1_DOTENV_ONLY"]).toBeUndefined();
    }
  });

  it("an injected `deps.env` is used verbatim by both", async () => {
    const { preflight, restart } = await runInstall(
      { env: { PATH: process.env["PATH"], F1_INJECTED: "yes" } },
      POLLUTED,
    );
    expect(preflight["F1_INJECTED"]).toBe("yes");
    expect(restart["F1_INJECTED"]).toBe("yes");
    expect(preflight["HOME"]).toBeUndefined();
  });
});
