/**
 * TIER 2 — `fg install` / `--check` / `uninstall` on the REAL bundle (brief a1 deliverable 4).
 *
 * `cli/dist/fg.mjs` is copied into a bare temp dir and run with a SCRATCH `HOME` — on POSIX
 * `os.homedir()` follows `HOME`, so the REAL embedded ru-code preflight resolves its root inside
 * the scratch dir. A fake installed ru-code sits at `<HOME>/.ru-code/bin/{cli.js,ru-code,current.json}`
 * (`current.json` names 0.0.40 — at least `MINIMUM_APP_VERSION` — unless a case asks otherwise);
 * its `ru-code` launcher records its argv to a file. `server-runtime.json` names a live child
 * process this suite spawns and kills. The real `~/.ru-code`, `/home/work` and the real HOME are
 * never touched: when `/home/work/<user>` exists the preflight would (correctly) pick it, so the
 * writing cases are skipped there instead of writing outside the scratch dir.
 *
 * Requires `pnpm build` first, and `vendor/ru-code/` (the build fails without it).
 */
import { type ChildProcess, execFile, spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { forbiddenIn } from "../../packages/fg-install/src/forbidden.ts";

const exec = promisify(execFile);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const bundle = join(repo, "cli", "dist", "fg.mjs");
const vendorPlugin = join(repo, "vendor", "ru-code", "plugins", "pixso");

/** The preflight relocates to `/home/work/<user>` when it exists (i1 §1.3); never write there. */
const relocated = (() => {
  try {
    return statSync(join("/home", "work", userInfo().username)).isDirectory();
  } catch {
    return false;
  }
})();

const scratchDirs: string[] = [];
const children: ChildProcess[] = [];

afterAll(() => {
  for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

let bareBundle = "";
beforeAll(() => {
  const bare = mkdtempSync(join(tmpdir(), "fg-install-bare-"));
  scratchDirs.push(bare);
  bareBundle = join(bare, "fg.mjs");
  copyFileSync(bundle, bareBundle);
});

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function fg(home: string, ...args: string[]): Promise<Run> {
  return fgAt({ cwd: dirname(bareBundle), home }, ...args);
}

/** Run `script` (default: the bare bundle copy) in `cwd` with a scratch HOME. */
async function fgAt(
  options: { cwd: string; home: string; script?: string; env?: Record<string, string> },
  ...args: string[]
): Promise<Run> {
  try {
    const { stdout, stderr } = await exec(
      process.execPath,
      [options.script ?? bareBundle, ...args],
      {
        cwd: options.cwd,
        env: { ...process.env, HOME: options.home, NO_COLOR: "1", ...options.env },
        timeout: 120_000,
      },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.code === "number" ? e.code : -1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
}

/** A scratch HOME, optionally with a fake installed ru-code that is "running". */
function home(
  options: { installed?: boolean; running?: boolean; shipsOwn?: boolean; version?: string } = {},
): {
  home: string;
  root: string;
  argv: string;
  envFile: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "fg-install-home-"));
  scratchDirs.push(dir);
  const root = join(dir, ".ru-code");
  const argv = join(dir, "launcher-argv.txt");
  const envFile = join(dir, "restart-env.json");
  const version = options.version ?? "0.0.40";
  if (options.installed ?? true) {
    const bin = join(root, "bin");
    mkdirSync(join(bin, "versions", version), { recursive: true });
    // fg restarts ru-code the way ru-code's installer does — `<node> <flags> <bin>/cli.js restart
    // --no-browser`, never the sh wrapper — so the stub `cli.js` is what records the argv and the env.
    writeFileSync(
      join(bin, "cli.js"),
      [
        'const fs = process.getBuiltinModule("node:fs");',
        `fs.writeFileSync(${JSON.stringify(argv)}, process.argv.slice(2).join("\\n") + "\\n");`,
        `fs.writeFileSync(${JSON.stringify(envFile)}, JSON.stringify(process.env));`,
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(bin, "current.json"),
      JSON.stringify({ schema: 1, version, entry: `versions/${version}/cli.js` }),
    );
    // The installer's wrapper (30-core.sh:492-505): it bakes the node fg's restart must reuse.
    writeFileSync(
      join(bin, "ru-code"),
      `#!/bin/sh\nif [ -x '${process.execPath}' ]; then\n  exec '${process.execPath}' "$(dirname "$0")/cli.js" "$@"\nfi\nexec node "$(dirname "$0")/cli.js" "$@"\n`,
    );
    chmodSync(join(bin, "ru-code"), 0o755);
    if (options.shipsOwn ?? false) {
      mkdirSync(join(bin, "versions", version, "plugins", "pixso"), { recursive: true });
    }
  }
  if (options.running ?? false) {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    children.push(child);
    mkdirSync(join(root, "userdata"), { recursive: true });
    writeFileSync(
      join(root, "userdata", "server-runtime.json"),
      JSON.stringify({
        version: 1,
        pid: child.pid,
        port: 7777,
        origin: "http://127.0.0.1:7777",
        startedAt: "2026-10-26T00:00:00Z",
      }),
    );
  }
  return { home: dir, root, argv, envFile };
}

const treeOf = (dir: string): string[] =>
  readdirSync(dir, { recursive: true }).map(String).toSorted();

describe.skipIf(relocated)("fg install — the real bundle in a scratch HOME", () => {
  it("install → check → uninstall: byte-identical files, restart with --no-browser, data survives", async () => {
    const h = home({ running: true });
    const target = join(h.root, "plugins", "pixso");

    const installed = await fg(h.home, "install");
    expect(installed.code, installed.stderr).toBe(0);
    // OUR_ROOT came from the REAL embedded preflight: the path on stdout is inside the scratch HOME.
    expect(installed.stdout.trim()).toBe(target);
    for (const file of treeOf(vendorPlugin).filter((f) =>
      statSync(join(vendorPlugin, f)).isFile(),
    )) {
      expect(
        readFileSync(join(target, file)).equals(readFileSync(join(vendorPlugin, file))),
        file,
      ).toBe(true);
    }
    expect(treeOf(target)).toEqual(treeOf(vendorPlugin));
    expect(readFileSync(h.argv, "utf8")).toBe("restart\n--no-browser\n");
    // The real preflight found no qwen CLI in the scratch HOME (exit 1) — surfaced, not fatal.
    expect(installed.stderr).toContain("cli fail");

    const check = await fg(h.home, "install", "--check");
    expect(check.code, check.stderr).toBe(0);
    expect(check.stderr).toContain("совпадает со встроенным");

    const data = join(h.root, "userdata", "plugins", "pixso", "data.sqlite");
    mkdirSync(dirname(data), { recursive: true });
    writeFileSync(data, "user rows");
    rmSync(h.argv);
    const removed = await fg(h.home, "uninstall");
    expect(removed.code, removed.stderr).toBe(0);
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(data, "utf8")).toBe("user rows");
    expect(readFileSync(h.argv, "utf8")).toBe("restart\n--no-browser\n");
  });

  it("--check writes nothing (the preflight's temp dir is outside HOME and removed)", async () => {
    const h = home({ running: true });
    const before = treeOf(h.home);
    const check = await fg(h.home, "install", "--check");
    expect(check.code).toBe(1);
    expect(check.stderr).toContain("не установлен");
    expect(treeOf(h.home)).toEqual(before);
  });

  it("a stopped ru-code is not started; a second install is «уже установлен»", async () => {
    const h = home();
    expect((await fg(h.home, "install")).code).toBe(0);
    expect(existsSync(h.argv)).toBe(false);
    const again = await fg(h.home, "--lang", "en", "install");
    expect(again.code).toBe(0);
    expect(again.stderr).toContain("is already installed");
    expect(again.stdout).toBe("");
  });

  it("warns when ru-code ships its own pixso, installs anyway, and --check then exits 1", async () => {
    const h = home({ shipsOwn: true });
    const installed = await fg(h.home, "install");
    expect(installed.code).toBe(0);
    expect(installed.stderr).toContain("поставляет собственный pixso");
    expect((await fg(h.home, "install", "--check")).code).toBe(1);
  });

  it("refuses with exit 1 when ru-code is not installed, and writes nothing", async () => {
    const h = home({ installed: false });
    const run = await fg(h.home, "install");
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("ru-code не установлен");
    expect(existsSync(h.root)).toBe(false);
  });

  it("refuses a ru-code older than MINIMUM_APP_VERSION (0.0.33): exit 1, both versions shown, nothing written; --check exits 1 too", async () => {
    const h = home({ version: "0.0.33", running: true });
    const before = treeOf(h.home);
    const run = await fg(h.home, "install");
    expect(run.code).toBe(1);
    expect(run.stderr).toContain(
      "установлен ru-code 0.0.33, а плагину pixso нужен 0.0.34 или новее",
    );
    expect(run.stderr).toContain("обновите ru-code и повторите fg install");
    const en = await fg(h.home, "--lang", "en", "install");
    expect(en.code).toBe(1);
    expect(en.stderr).toContain(
      "ru-code 0.0.33 is installed, but the pixso plugin needs 0.0.34 or newer",
    );
    const check = await fg(h.home, "install", "--check");
    expect(check.code).toBe(1);
    expect(check.stderr).toMatch(/нужен +≥ 0\.0\.34/u);
    expect(treeOf(h.home)).toEqual(before);
    expect(existsSync(h.argv)).toBe(false);
  });

  it("the embedded plugin carries none of the forbidden strings (checked on the INSTALLED bytes)", async () => {
    const h = home();
    expect((await fg(h.home, "install", "--no-restart")).code).toBe(0);
    const target = join(h.root, "plugins", "pixso");
    for (const file of treeOf(target).filter((f) => statSync(join(target, f)).isFile())) {
      const text = readFileSync(join(target, file), "utf8");
      // The SAME list the build enforces and the repo guard reads (`packages/fg-install/src/forbidden.ts`).
      expect(forbiddenIn(text), file).toEqual([]);
    }
  });
});

describe("fg install — usage errors on the real bundle", () => {
  it("undeclared flags exit 2, localized", async () => {
    const h = home({ installed: false });
    const ru = await fg(h.home, "uninstall", "--check");
    expect(ru.code).toBe(2);
    expect(ru.stderr).toContain("не поддерживается командой uninstall");
    const en = await fg(h.home, "--lang", "en", "install", "-o", "x");
    expect(en.code).toBe(2);
    expect(en.stderr).toContain("install");
    expect(en.stderr).not.toMatch(/[а-яё]/i);
  });
});

describe.skipIf(relocated)(
  "fg install — the restart's environment is the SHELL's (audit 1, on the real bundle)",
  () => {
    it("a project `.env` and `--token` never reach `ru-code restart`", async () => {
      const h = home({ running: true });
      const project = mkdtempSync(join(tmpdir(), "fg-install-project-"));
      scratchDirs.push(project);
      writeFileSync(
        join(project, ".env"),
        [
          "F1_PROJECT_SECRET=s3cr3t-from-dot-env",
          "T3CODE_HOME=/tmp/f1-elsewhere",
          "VITE_DEV_SERVER_URL=http://localhost:1",
          "PIXSO_LOCAL_MCP_URL=http://local.invalid/mcp",
          "PIXSO_REMOTE_MCP_URL=http://remote.invalid/mcp",
          "PIXSO_REMOTE_MCP_TOKEN=token-from-dot-env",
          "",
        ].join("\n"),
      );
      const run = await fgAt(
        { cwd: project, home: h.home },
        "install",
        "--token",
        "SECRET-TOKEN-123",
      );
      expect(run.code, run.stderr).toBe(0);
      // ru-code was restarted (the stub recorded it) — and with the shell's env only:
      expect(readFileSync(h.argv, "utf8")).toBe("restart\n--no-browser\n");
      const env = JSON.parse(readFileSync(h.envFile, "utf8")) as Record<string, string>;
      expect(env["HOME"]).toBe(h.home);
      expect(env["PATH"]).toBe(process.env["PATH"]);
      for (const key of [
        "F1_PROJECT_SECRET",
        "T3CODE_HOME",
        "VITE_DEV_SERVER_URL",
        "PIXSO_LOCAL_MCP_URL",
        "PIXSO_REMOTE_MCP_URL",
        "PIXSO_REMOTE_MCP_TOKEN",
      ]) {
        expect(env[key], key).toBe(process.env[key]);
      }
      expect(JSON.stringify(env)).not.toContain("SECRET-TOKEN-123");
      expect(JSON.stringify(env)).not.toContain("s3cr3t-from-dot-env");
    });
  },
);

describe.skipIf(relocated)("fg install — a concurrent run and a crash, on the real bundle", () => {
  it("a live lock → exit 1 with the localized refusal; a dead holder's lock is taken over; the work dir is outside plugins/", async () => {
    const h = home();
    const lock = join(h.root, ".fg-install", "lock");
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "pid"), String(process.pid));
    const refused = await fg(h.home, "install");
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("уже работает");
    expect(existsSync(join(h.root, "plugins"))).toBe(false);

    // a pid that is certainly gone
    const dead = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await new Promise((resolve) => dead.on("exit", resolve));
    writeFileSync(join(lock, "pid"), String(dead.pid));
    const taken = await fg(h.home, "install");
    expect(taken.code, taken.stderr).toBe(0);
    expect(readdirSync(join(h.root, "plugins"))).toEqual(["pixso"]);
    expect(readdirSync(join(h.root, ".fg-install"))).toEqual([]);
  });

  it("crash recovery: the plugin sits only in .fg-install/old/ → `install --check` is not fooled, `install` restores then replaces", async () => {
    const h = home();
    expect((await fg(h.home, "install")).code).toBe(0);
    const target = join(h.root, "plugins", "pixso");
    const old = join(h.root, ".fg-install", "old");
    renameSync(target, old);
    expect(existsSync(target)).toBe(false);
    expect((await fg(h.home, "install")).code).toBe(0);
    expect(existsSync(join(target, "plugin.json"))).toBe(true);
    expect(existsSync(old)).toBe(false);
  });
});

/** The repo-root `fg.mjs` — the 1.0.0 release build, gitignored; the baseline the CLI surface must keep. */
const release100 = join(repo, "fg.mjs");

describe.skipIf(!existsSync(release100))(
  "CLI surface vs the 1.0.0 release (audit 10), same argv, same output",
  () => {
    const argvs: readonly (readonly string[])[] = [
      ["--psvg", "x", "--check"],
      ["--preport", ".", "--no-restart"],
      ["--check"],
      ["--no-restart"],
      ["--install"],
      ["--uninstall"],
      ["--install", "--check"],
      ["--lang", "en", "--uninstall"],
      ["--psvg", "x", "--install"],
    ];
    for (const argv of argvs) {
      it(`fg ${argv.join(" ")}`, async () => {
        const h = home();
        const before = treeOf(h.home);
        const old = await fgAt(
          { cwd: dirname(bareBundle), home: h.home, script: release100 },
          ...argv,
        );
        const now = await fg(h.home, ...argv);
        expect(now.code).toBe(old.code);
        expect(now.code).toBe(2);
        expect(now.stderr).toBe(old.stderr);
        expect(now.stdout).toBe(old.stdout);
        // …and `fg --uninstall` / `fg --install` ran nothing.
        expect(treeOf(h.home)).toEqual(before);
      });
    }

    it("`fg --help --install` keeps working (the 1.0.0 build never had it)", async () => {
      const h = home();
      const help = await fg(h.home, "--help", "--install");
      expect(help.code).toBe(0);
      expect(help.stdout.split("\n")[0]).toBe("fg install [--check] [--no-restart]");
    });
  },
);
