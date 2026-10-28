/**
 * TIER 2 — `bash install` / `bash install --uninstall` from a REAL release folder (`pnpm release`'s
 * script, run to a scratch folder): the real bundle, fg's `install`, ru-code's vendored installer.
 * Every run is `env -i`-clean in a scratch HOME, a browser-stub folder first on PATH.
 *
 * A1-A4 install entry · D1/D2/D4 the `fguard` command · E1-E3 the token · J4/J6/J11 in small.
 * The real-ru-code scenarios (J1-J10) live in the evidence run (`WORKFLOW/features/fg-skills`).
 *
 * The node the installer finds is the one first on the sandbox PATH — this suite puts the node
 * RUNNING it there, so running the lane on node 22.16 runs every scenario on node 22.16 (H1).
 */
import { execFile, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DESIGN_URL, type FakeMcp, makeTempDir, removeTempDir, startFakeMcp } from "@smart-tools/fg-testkit";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "..");
const { version } = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  version: string;
};
const NODE_DIR = dirname(process.execPath);
const BROWSERS = ["xdg-open", "open", "sensible-browser", "x-www-browser", "www-browser", "gio"];

let top = "";
let rel = "";
const boxes: string[] = [];
let fake: FakeMcp | undefined;

beforeAll(() => {
  top = makeTempDir("fg-install-script-");
  rel = join(top, "release");
  const run = spawnSync(process.execPath, [join(repoRoot, "scripts", "release.mjs"), "--out", rel], {
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`release failed: ${run.stderr}`);
});

afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

afterAll(() => {
  for (const dir of boxes) removeTempDir(dir);
  removeTempDir(top);
});

interface Box {
  readonly dir: string;
  readonly home: string;
  readonly stubs: string;
  readonly root: string;
  readonly fgBin: string;
  readonly env: Record<string, string>;
}

function box(path?: (b: { dir: string; stubs: string }) => string): Box {
  const dir = makeTempDir("fg-install-box-");
  boxes.push(dir);
  const home = join(dir, "home");
  const stubs = join(dir, "stubs");
  mkdirSync(home);
  mkdirSync(stubs);
  for (const name of BROWSERS) {
    writeFileSync(join(stubs, name), `#!/bin/sh\necho "$0 $*" >> "${join(dir, "browser.log")}"\n`);
    chmodSync(join(stubs, name), 0o755);
  }
  const root = join(home, ".ru-code");
  return {
    dir,
    home,
    stubs,
    root,
    fgBin: join(root, "fg", "bin"),
    env: {
      HOME: home,
      PATH: path?.({ dir, stubs }) ?? `${stubs}:${NODE_DIR}:/usr/local/bin:/usr/bin:/bin`,
      LANG: "C.UTF-8",
      TERM: "dumb",
    },
  };
}

function bash(b: Box, args: readonly string[], extra: Record<string, string> = {}, cwd = b.dir) {
  return spawnSync("bash", [...args], { env: { ...b.env, ...extra }, cwd, encoding: "utf8" });
}

/** A NEW interactive shell — what a user opens after the install. */
function newShell(b: Box, sh: "bash" | "zsh", command: string, extra: Record<string, string> = {}, cwd = b.dir) {
  return spawnSync(sh, ["-i", "-c", command], { env: { ...b.env, ...extra }, cwd, encoding: "utf8" });
}

/**
 * The same, ASYNC — for runs that talk to the in-process fake MCP: `spawnSync` would block this
 * process's event loop, and with it the very server the child is calling.
 */
function newShellAsync(
  b: Box,
  command: string,
  extra: Record<string, string> = {},
  cwd = b.dir,
): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile("bash", ["-i", "-c", command], { env: { ...b.env, ...extra }, cwd, encoding: "utf8" }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : -1;
      done({ status: code, stdout, stderr });
    });
  });
}

const install = (b: Box, extra: Record<string, string> = {}, from = rel) =>
  bash(b, [join(from, "install")], extra);

describe("A — the install entry", () => {
  it("A1/A4/D1: a bare machine (no ru-code, no CLI) → exit 0, fguard + skills installed, plugin skip visible", () => {
    const b = box();
    const run = install(b);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toContain("fguard установлен (плагин pixso пропущен)");
    expect(run.stderr).toContain("CLI не найден");
    expect(readFileSync(join(b.fgBin, "fg.mjs")).equals(readFileSync(join(rel, "fg.mjs")))).toBe(true);
    for (const name of ["install", "ru-code-install"]) {
      expect(readFileSync(join(b.root, "fg", name)).equals(readFileSync(join(rel, name)))).toBe(true);
    }
    expect(readdirSync(join(b.home, ".qwen", "skills")).toSorted()).toEqual([
      "fg-get-pixso-html",
      "fg-get-pixso-specs",
      "fg-project-report",
    ]);
    expect(existsSync(join(b.root, "plugins"))).toBe(false);
    expect(existsSync(join(b.dir, "browser.log"))).toBe(false);
  });

  it("A2: the node is ru-code's installer's pick — `command -v node` here — and it is baked", () => {
    const b = box();
    expect(install(b).status).toBe(0);
    const node = join(NODE_DIR, "node");
    expect(readFileSync(join(b.fgBin, "fguard"), "utf8")).toContain(`'${node}'`);
    expect(readFileSync(join(b.home, ".qwen", "skills", "fg-get-pixso-specs", "SKILL.md"), "utf8")).toContain(
      `"${node}" "${join(b.fgBin, "fg.mjs")}"`,
    );
  });

  it("A2: the CLI-shipped node wins when present (installer's shipped path pinned in a copy — test only)", () => {
    const b = box();
    const shipped = join(b.dir, "cli", "node", "bin", "node");
    mkdirSync(dirname(shipped), { recursive: true });
    symlinkSync(process.execPath, shipped);
    const pinned = join(b.dir, "release-pinned");
    mkdirSync(pinned);
    for (const name of ["fg.mjs", "install"]) copyFileSync(join(rel, name), join(pinned, name));
    const original = readFileSync(join(rel, "ru-code-install"), "utf8");
    const line = '    linux)   shipped="" ;;';
    expect(original).toContain(line);
    writeFileSync(join(pinned, "ru-code-install"), original.replace(line, `    linux)   shipped="${shipped}" ;;`));
    // ru-code's OWN check_node_floor on the pinned file picks the shipped node...
    const picked = bash(b, ["-c", `RU_CODE_INSTALL_NO_MAIN=1 . "${join(pinned, "ru-code-install")}"; LOGFILE=/dev/null; detect_os; check_node_floor; printf %s "$NODE_PATH"`]);
    expect(picked.stdout).toBe(shipped);
    // ...and fg bakes exactly that.
    const run = install(b, {}, pinned);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toContain(`node        ${shipped}`);
    expect(readFileSync(join(b.fgBin, "fguard"), "utf8")).toContain(`'${shipped}'`);
  });

  it("A2: no node at all → ru-code's own failure («Node.js не установлен»), exit 1, nothing written", () => {
    const b = box(({ dir }) => {
      const bin = join(dir, "nonode");
      mkdirSync(bin);
      for (const tool of ["bash", "dirname", "uname", "locale", "grep", "cat"]) {
        const at = spawnSync("bash", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
        if (at !== "") symlinkSync(at, join(bin, tool));
      }
      return bin;
    });
    const run = spawnSync(join(b.dir, "nonode", "bash"), [join(rel, "install")], { env: b.env, encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Node.js не установлен");
    expect(run.stderr).toContain("Установите LTS: https://nodejs.org/");
    expect(readdirSync(b.home)).toEqual([]);
  });

  it("A2: a node below the floor → ru-code's own «Обновите Node.js», exit 1", () => {
    const b = box(({ dir, stubs }) => {
      const old = join(dir, "oldnode");
      mkdirSync(old);
      writeFileSync(join(old, "node"), "#!/bin/sh\necho v18.19.0\n");
      chmodSync(join(old, "node"), 0o755);
      return `${old}:${stubs}:/usr/local/bin:/usr/bin:/bin`;
    });
    const run = install(b);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Обновите Node.js");
    expect(run.stderr).toContain("^22.16 || ^23.11 || >=24.10");
    expect(readdirSync(b.home)).toEqual([]);
  });

  it("A3: a re-run is an update — same rc bytes, one line, the token kept", () => {
    const b = box();
    expect(install(b).status).toBe(0);
    writeFileSync(join(b.fgBin, ".env"), "PIXSO_REMOTE_MCP_TOKEN=kept\n", { mode: 0o600 });
    const rcs = [".bashrc", ".profile", ".zshrc"].map((n) => readFileSync(join(b.home, n), "utf8"));
    const again = install(b);
    expect(again.status).toBe(0);
    expect([".bashrc", ".profile", ".zshrc"].map((n) => readFileSync(join(b.home, n), "utf8"))).toEqual(rcs);
    expect(rcs[0]?.split("\n").filter((l) => l.includes(b.fgBin))).toHaveLength(1);
    expect(readFileSync(join(b.fgBin, ".env"), "utf8")).toBe("PIXSO_REMOTE_MCP_TOKEN=kept\n");
    expect(again.stderr).toContain(`задан: ${join(b.fgBin, ".env")}`);
  });

  it("refuses an unknown argument with ru-code's usage message", () => {
    const b = box();
    const run = bash(b, [join(rel, "install"), "--bogus"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Не удалось разобрать параметры");
  });
});

describe("D/J4 — the fguard command in NEW bash and zsh, both rc modes", () => {
  for (const sourced of [false, true]) {
    it(`${sourced ? "sourced env.sh (function)" : "classic PATH line (wrapper)"}: fguard --version = ${version}`, () => {
      const b = box();
      const extra = { INSTALL_USE_RC_SOURCED_LAUNCHER: String(sourced) };
      expect(install(b, extra).status).toBe(0);
      for (const sh of ["bash", "zsh"] as const) {
        const run = newShell(b, sh, "type fguard; fguard --version");
        expect(run.stdout, `${sh}: ${run.stderr}`).toContain(version);
        expect(run.stdout).toContain(sourced ? "function" : join(b.fgBin, "fguard"));
      }
    });
  }

  it("D4: the help a user sees names fguard, never fg", () => {
    const b = box();
    install(b);
    const help = newShell(b, "bash", "fguard --help").stdout;
    expect(help).toContain(`fguard v${version}`);
    expect(help).toContain("fguard <команда>");
    expect(help).not.toMatch(/(^|\s)fg (--|<|install|token)/mu);
  });
});

describe("FIX1/FIX2 — nothing on fguard's PATH dir shadows a system command; a vanished fg.mjs is said plainly", () => {
  it("the PATH dir holds only fg.mjs and fguard's own names; installers sit in <root>/fg", () => {
    for (const sourced of [false, true]) {
      const b = box();
      expect(install(b, { INSTALL_USE_RC_SOURCED_LAUNCHER: String(sourced) }).status).toBe(0);
      expect(readdirSync(b.fgBin).toSorted()).toEqual(sourced ? ["env.sh", "fg.mjs", "fguard"] : ["fg.mjs", "fguard"]);
      expect(existsSync(join(b.root, "fg", "install"))).toBe(true);
      expect(existsSync(join(b.root, "fg", "ru-code-install"))).toBe(true);
    }
  });

  for (const sourced of [false, true]) {
    it(`${sourced ? "sourced" : "classic"}: in a NEW bash and zsh \`install\` is the system one and \`install -m 644 a b\` works`, () => {
      const b = box();
      expect(install(b, { INSTALL_USE_RC_SOURCED_LAUNCHER: String(sourced) }).status).toBe(0);
      writeFileSync(join(b.dir, "a.txt"), "x");
      for (const sh of ["bash", "zsh"] as const) {
        const run = newShell(b, sh, `command -v install; install -m 644 a.txt b-${sh}.txt && echo COPIED`);
        expect(run.stdout, `${sh}: ${run.stderr}`).toMatch(/^\/usr\/bin\/install$/mu);
        expect(run.stdout).toContain("COPIED");
        expect(existsSync(join(b.dir, `b-${sh}.txt`))).toBe(true);
      }
    });
  }

  it("FIX2: <root>/fg deleted (ru-code relocation) → each skill's first command prints the reinstall line, exit 1", () => {
    const b = box();
    expect(install(b).status).toBe(0);
    rmSync(join(b.root, "fg"), { recursive: true, force: true });
    for (const folder of ["fg-get-pixso-specs", "fg-get-pixso-html", "fg-project-report"]) {
      const text = readFileSync(join(b.home, ".qwen", "skills", folder, "SKILL.md"), "utf8");
      const first = /```bash\n([^`]*)```/u.exec(text)?.[1] ?? "";
      const run = bash(b, ["-c", first]);
      expect(run.status).toBe(1);
      expect(run.stdout).toBe(
        `fguard не найден: ${join(b.fgBin, "fg.mjs")}. Установите его заново: склонируйте репозиторий релиза fguard и выполните в нём bash install\n`,
      );
    }
  });
});

describe("E — the token", () => {
  it("E1: fguard token <value> → <root>/fg/bin/.env, mode 600, absolute path printed", () => {
    const b = box();
    install(b);
    const run = newShell(b, "bash", "fguard token tok-1");
    expect(run.status).toBe(0);
    const file = join(b.fgBin, ".env");
    expect(readFileSync(file, "utf8")).toBe("PIXSO_REMOTE_MCP_TOKEN=tok-1\n");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(run.stdout + run.stderr).toContain(file);
  });

  it("E1: fguard token without a value reads it (from a pipe here; hidden on a terminal)", () => {
    const b = box();
    install(b);
    const run = spawnSync("bash", ["-c", `. "${join(b.fgBin, "..", "..", "..")}/.bashrc"; echo 'piped tok' | fguard token`], {
      env: { ...b.env, INSTALL_USE_RC_SOURCED_LAUNCHER: "false" },
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
    // A space survives node's parser unquoted; quotes are added only when it would not (token.test.ts).
    expect(readFileSync(join(b.fgBin, ".env"), "utf8")).toBe("PIXSO_REMOTE_MCP_TOKEN=piped tok\n");
  });

  it("E3: precedence — flag > env > project ./.env > <root>/fg/bin/.env (the token the server receives)", async () => {
    const b = box();
    install(b);
    fake = await startFakeMcp();
    const url = { PIXSO_REMOTE_MCP_URL: fake.url };
    newShell(b, "bash", "fguard token from-bundle");
    const project = join(b.dir, "project");
    mkdirSync(project);
    const probe = async (extra: Record<string, string>, flags = "") => {
      const before = fake?.calls.length ?? 0;
      await newShellAsync(b, `fguard --pprompt '${DESIGN_URL}' -o out.md ${flags}`, { ...url, ...extra }, project);
      return fake?.calls[before]?.token;
    };
    expect(await probe({})).toBe("from-bundle");
    writeFileSync(join(project, ".env"), "PIXSO_REMOTE_MCP_TOKEN=from-project\n");
    expect(await probe({})).toBe("from-project");
    expect(await probe({ PIXSO_REMOTE_MCP_TOKEN: "from-env" })).toBe("from-env");
    expect(await probe({ PIXSO_REMOTE_MCP_TOKEN: "from-env" }, "--token from-flag")).toBe("from-flag");
  });

  it("E2: no token anywhere → exit 3 and «fguard token <…>» + the absolute .env path", () => {
    const b = box();
    install(b);
    const run = newShell(b, "bash", `fguard --pprompt '${DESIGN_URL}' -o out.md`);
    expect(run.status).toBe(3);
    expect(run.stderr).toContain("Выполните: fguard token <ваш токен>");
    expect(run.stderr).toContain(join(b.fgBin, ".env"));
  });

  it("E2: a token the server REJECTS (real HTTP 401) → exit 3, «отклонён», distinct from missing", async () => {
    const b = box();
    install(b);
    fake = await startFakeMcp({ requiredToken: "the-right-one" });
    newShell(b, "bash", "fguard token a-wrong-one");
    const run = await newShellAsync(b, `fguard --pprompt '${DESIGN_URL}' -o out.md`, {
      PIXSO_REMOTE_MCP_URL: fake.url,
    });
    expect(run.status).toBe(3);
    expect(run.stderr).toContain("токен Pixso отклонён сервером (HTTP 401)");
    expect(run.stderr).toContain(join(b.fgBin, ".env"));
    // ...and a server that is simply down is NOT a token problem.
    const down = newShell(b, "bash", `fguard --pprompt '${DESIGN_URL}' -o out.md`, {
      PIXSO_REMOTE_MCP_URL: "http://127.0.0.1:9/mcp",
    });
    expect(down.status).toBe(1);
  });
});

describe("J6/E3 — bash <root>/fg/install --uninstall after the release folder is gone", () => {
  it("fg is gone (token too, and it says so); ru-code's line and the user's bytes stay", () => {
    const b = box();
    const own = 'export EDITOR=vim\nexport PATH="/somewhere/.ru-code/bin:$PATH"\n';
    writeFileSync(join(b.home, ".bashrc"), own);
    const copy = join(b.dir, "release-copy");
    mkdirSync(copy);
    for (const name of ["fg.mjs", "install", "ru-code-install"]) copyFileSync(join(rel, name), join(copy, name));
    expect(install(b, {}, copy).status).toBe(0);
    newShell(b, "bash", "fguard token t");
    renameSync(copy, `${copy}.deleted`);
    const run = bash(b, [join(b.root, "fg", "install"), "--uninstall"]);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toContain("удалена вместе с токеном (.env)");
    expect(existsSync(join(b.root, "fg"))).toBe(false);
    expect(readFileSync(join(b.home, ".bashrc"), "utf8")).toBe(own);
    expect(existsSync(join(b.home, ".qwen", "skills", "fg-project-report"))).toBe(false);
    expect(newShell(b, "bash", "type fguard").status).not.toBe(0);
  });
});
