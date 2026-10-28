/**
 * TIER 1 — `setup` / `teardown`, the node half of `bash install` (A1-A4, C1, D1-D2, E3, F1-F3).
 *
 * Scratch root, fake preflight, fixture plugin — and in place of ru-code's installer a RECORDING
 * STUB that defines the five functions fg calls and logs the globals each one saw. That is what
 * this tier can prove: WHICH ru-code functions fg runs, in WHICH order, with WHICH values. That the
 * real functions then write the right bytes is `rc.integration.test.ts`'s subject, against the
 * vendored installer itself.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { createInstallCommands } from "../src/commands.ts";
import { payloadOf } from "../src/payload.ts";
import { SKILL_FOLDERS } from "../src/skills.ts";
import { cleanScratch, context, fakeRuCode, scratch } from "./support.ts";

afterEach(cleanScratch);

/** The stub `ru-code-install`: every call appends one line with the globals it read. */
const STUB = `
detect_os() { OS=linux; echo "detect_os NO_MAIN=$RU_CODE_INSTALL_NO_MAIN LOGFILE=$LOGFILE" >> "$FG_TEST_LOG"; }
create_wrapper() { echo "create_wrapper BIN_DIR=$BIN_DIR APP_BIN=$APP_BIN ENTRY_JS=$ENTRY_JS NODE_PATH=$NODE_PATH NODE_FLAGS=[$NODE_FLAGS]" >> "$FG_TEST_LOG"; }
clean_rc() { echo "clean_rc APP_DIR_NAME=$APP_DIR_NAME APP_BIN=$APP_BIN" >> "$FG_TEST_LOG"; }
add_path() {
  echo "add_path BIN_DIR=$BIN_DIR APP_BIN=$APP_BIN APP_DIR_NAME=$APP_DIR_NAME ENTRY_JS=$ENTRY_JS NODE_PATH=$NODE_PATH DISPLAY=$APP_DISPLAY_NAME" >> "$FG_TEST_LOG"
  PATH_LINE="[ -f \\"$BIN_DIR/env.sh\\" ] && . \\"$BIN_DIR/env.sh\\""
  return "\${FG_TEST_ADD_STATUS:-0}"
}
rc_files() { printf '%s\\n' "$HOME/.bashrc" "$HOME/.zshrc"; }
rc_has_our_line() { [ "\${FG_TEST_ADD_STATUS:-0}" = 0 ]; }
`;

interface Rig {
  readonly home: string;
  readonly root: string;
  readonly rel: string;
  readonly configDir: string;
  readonly log: string;
  readonly fgBin: string;
  readonly commands: ReturnType<typeof createInstallCommands>;
}

/** A machine: HOME, a root, a release folder with the stub installer, commands wired to them. */
function rig(
  options: {
    readonly installed?: boolean;
    readonly version?: string;
    readonly cliJs?: string;
    readonly addStatus?: number;
    readonly root?: (home: string) => string;
  } = {},
): Rig {
  const home = scratch();
  const root = options.root?.(home) ?? join(home, ".ru-code");
  mkdirSync(root, { recursive: true });
  if (options.installed ?? false) {
    fakeRuCode(root, options.version === undefined ? {} : { version: options.version });
  }
  const configDir = join(home, ".qwen");
  const rel = join(home, "release");
  mkdirSync(rel);
  writeFileSync(join(rel, "fg.mjs"), "// the bundle\n");
  writeFileSync(join(rel, "install"), "#!/usr/bin/env bash\n# fg's entry\n");
  writeFileSync(join(rel, "ru-code-install"), STUB);
  const log = join(home, "calls.log");
  const preflight = [
    "const out = (s) => process.stdout.write(s + '\\n');",
    `out(${JSON.stringify(`OUR_ROOT=${root}`)});`,
    `out(${JSON.stringify(`CLI_JS=${options.cliJs ?? ""}`)});`,
    `out(${JSON.stringify(`CONFIG_DIR=${configDir}`)});`,
    "out('CHECK_NODE=ok'); out('CHECK_CLI=fail'); out('CHECK_GIT=ok'); out('CHECK_CLI_KIND=missing');",
    "process.exitCode = 1;",
  ].join("\n");
  const payload = payloadOf({
    preflight,
    pluginDir: "pixso",
    files: {
      "plugin.json": JSON.stringify({
        id: "pixso",
        name: { en: "Pixso", ru: "Pixso" },
        version: "1.0.0",
        apiVersion: 2,
        server: "server/index.mjs",
        web: "web/index.mjs",
        styles: "web/styles.css",
      }),
      "server/index.mjs": "export default 1;\n",
      "web/index.mjs": "export default 2;\n",
      "web/styles.css": "/* */\n",
    },
  });
  const commands = createInstallCommands({
    payload: () => payload,
    isAlive: () => false,
    env: {
      HOME: home,
      PATH: process.env["PATH"],
      FG_TEST_LOG: log,
      ...(options.addStatus === undefined ? {} : { FG_TEST_ADD_STATUS: String(options.addStatus) }),
    },
  });
  return { home, root, rel, configDir, log, fgBin: join(root, "fg", "bin"), commands };
}

const commandOf = (r: Rig, flag: string) => {
  const found = r.commands.find((c) => c.flag === flag);
  if (found === undefined) throw new Error(flag);
  return found;
};

const NODE = "/opt/cli/node/bin/node";

async function setup(r: Rig, node: string | null = NODE) {
  const run = context({ binDir: r.rel, ...(node === null ? {} : { source: node }) });
  const code = await commandOf(r, "setup").run(run.ctx);
  return { code, err: run.err(), out: run.out() };
}

async function teardown(r: Rig, binDir = r.rel) {
  const run = context({ binDir });
  const code = await commandOf(r, "teardown").run(run.ctx);
  return { code, err: run.err() };
}

const calls = (r: Rig): string[] =>
  existsSync(r.log) ? readFileSync(r.log, "utf8").trim().split("\n") : [];

describe("setup — the node half of bash install", () => {
  it("D1: copies fg.mjs into <root>/fg/bin and install + ru-code-install into <root>/fg, byte for byte", async () => {
    const r = rig();
    expect((await setup(r)).code).toBe(0);
    expect(readFileSync(join(r.fgBin, "fg.mjs")).equals(readFileSync(join(r.rel, "fg.mjs")))).toBe(true);
    for (const name of ["install", "ru-code-install"]) {
      expect(readFileSync(join(r.root, "fg", name)).equals(readFileSync(join(r.rel, name)))).toBe(true);
    }
  });

  it("FIX1: the PATH dir <root>/fg/bin holds only fg.mjs; the installers live in <root>/fg (not on PATH)", async () => {
    const r = rig();
    expect((await setup(r)).code).toBe(0);
    expect(readdirSync(r.fgBin).toSorted()).toEqual(["fg.mjs"]);
    for (const name of ["install", "ru-code-install"]) {
      expect(readFileSync(join(r.root, "fg", name)).equals(readFileSync(join(r.rel, name)))).toBe(true);
    }
    expect(calls(r)[0]).toBe(`detect_os NO_MAIN=1 LOGFILE=${join(r.root, "fg", "install.log")}`);
  });

  it("FIX1: a re-run removes the old layout's install / ru-code-install from the PATH dir", async () => {
    const r = rig();
    mkdirSync(r.fgBin, { recursive: true });
    writeFileSync(join(r.fgBin, "install"), "old");
    writeFileSync(join(r.fgBin, "ru-code-install"), "old");
    expect((await setup(r)).code).toBe(0);
    expect(readdirSync(r.fgBin).toSorted()).toEqual(["fg.mjs"]);
  });

  it("FIX1: re-running the INSTALLED copy (fg.mjs in <root>/fg/bin, installers in <root>/fg) works", async () => {
    const r = rig();
    await setup(r);
    const run = context({ binDir: r.fgBin, source: NODE });
    expect(await commandOf(r, "setup").run(run.ctx)).toBe(0);
    expect(run.err()).toContain(`bash ${join(r.root, "fg", "install")} --uninstall`);
  });

  it("D2: runs ru-code's create_wrapper → clean_rc → add_path, with fg's values and no others", async () => {
    const r = rig();
    await setup(r);
    expect(calls(r)).toEqual([
      `detect_os NO_MAIN=1 LOGFILE=${join(r.root, "fg", "install.log")}`,
      `create_wrapper BIN_DIR=${r.fgBin} APP_BIN=fguard ENTRY_JS=fg.mjs NODE_PATH=${NODE} NODE_FLAGS=[]`,
      "clean_rc APP_DIR_NAME=.ru-code/fg APP_BIN=fguard",
      `add_path BIN_DIR=${r.fgBin} APP_BIN=fguard APP_DIR_NAME=.ru-code/fg ENTRY_JS=fg.mjs NODE_PATH=${NODE} DISPLAY=Frontend Guard`,
    ]);
  });

  it("D2: sources the installer COPIED into <root>/fg, not the release folder's", async () => {
    const r = rig();
    await setup(r);
    // Break the release copy AFTER the run: a second run copies it again, then sources the copy.
    writeFileSync(join(r.rel, "ru-code-install"), `${STUB}\nclean_rc() { echo "clean_rc RELEASE-COPY" >> "$FG_TEST_LOG"; }\n`);
    await setup(r);
    expect(calls(r).at(-2)).toBe("clean_rc RELEASE-COPY");
  });

  it("F1/F2: writes the three skills into <CONFIG_DIR>/skills, baked with <NODE> and <root>/fg/bin/fg.mjs", async () => {
    const r = rig();
    await setup(r);
    for (const folder of SKILL_FOLDERS) {
      const text = readFileSync(join(r.configDir, "skills", folder, "SKILL.md"), "utf8");
      expect(text).toContain(`"${NODE}" "${join(r.fgBin, "fg.mjs")}"`);
    }
  });

  it("A4: no ru-code, no CLI — the command and the skills still land; plugin skipped, said so, exit 0", async () => {
    const r = rig();
    const { code, err } = await setup(r);
    expect(code).toBe(0);
    expect(err).toContain("CLI не найден — навыки всё равно записаны в");
    expect(err).toContain("пропущен: ru-code не установлен");
    expect(err).toContain("fguard установлен (плагин pixso пропущен)");
    expect(existsSync(join(r.root, "plugins"))).toBe(false);
    expect(existsSync(join(r.fgBin, "fg.mjs"))).toBe(true);
  });

  it("A4: a CLI that IS found gets no warning", async () => {
    const r = rig({ cliJs: "/home/u/.qwen/bin/cli.js" });
    const { err } = await setup(r);
    expect(err).not.toContain("CLI не найден");
  });

  it("C1: ru-code new enough → the plugin is installed by the same rule as fguard install", async () => {
    const r = rig({ installed: true });
    const { code, err } = await setup(r);
    expect(code).toBe(0);
    expect(existsSync(join(r.root, "plugins", "pixso", "plugin.json"))).toBe(true);
    expect(err).toContain("pixso 1.0.0 установлен");
    expect(err).toContain("fguard установлен — откройте новый терминал");
  });

  it("C1: ru-code older than MINIMUM_APP_VERSION → plugin skipped with fguard install's own message; the rest installed", async () => {
    const r = rig({ installed: true, version: "0.0.33" });
    const { code, err } = await setup(r);
    expect(code).toBe(0);
    expect(err).toContain("установлен ru-code 0.0.33, а плагину pixso нужен");
    expect(err).toContain("плагин pixso пропущен");
    expect(existsSync(join(r.root, "plugins"))).toBe(false);
    expect(existsSync(join(r.configDir, "skills", "fg-project-report", "SKILL.md"))).toBe(true);
  });

  it("A3: a re-run is an update — keeps the token, rewrites the skills, copies the files again", async () => {
    const r = rig();
    await setup(r);
    writeFileSync(join(r.fgBin, ".env"), "PIXSO_REMOTE_MCP_TOKEN=keep-me\n");
    const skill = join(r.configDir, "skills", "fg-get-pixso-html", "SKILL.md");
    const original = readFileSync(skill, "utf8");
    writeFileSync(skill, "tampered");
    writeFileSync(join(r.rel, "fg.mjs"), "// a newer bundle\n");
    const { code, err } = await setup(r);
    expect(code).toBe(0);
    expect(readFileSync(join(r.fgBin, ".env"), "utf8")).toBe("PIXSO_REMOTE_MCP_TOKEN=keep-me\n");
    expect(readFileSync(skill, "utf8")).toBe(original);
    expect(readFileSync(join(r.fgBin, "fg.mjs"), "utf8")).toBe("// a newer bundle\n");
    expect(err).toContain(`задан: ${join(r.fgBin, ".env")}`);
  });

  it("A3: re-running the COPY in <root>/fg/bin leaves its own files in place", async () => {
    const r = rig();
    await setup(r);
    const run = context({ binDir: r.fgBin, source: NODE });
    expect(await commandOf(r, "setup").run(run.ctx)).toBe(0);
    expect(readFileSync(join(r.fgBin, "fg.mjs"), "utf8")).toBe("// the bundle\n");
  });

  it("add_path writing no file is reported, not hidden (ru-code treats it as non-fatal too)", async () => {
    const r = rig({ addStatus: 1 });
    const { code, err } = await setup(r);
    expect(code).toBe(0);
    expect(err).toContain("не удалось записать команду fguard ни в один rc-файл");
  });

  it("is the installer's alone: no <NODE> or no bundle directory → exit 2, nothing written", async () => {
    const r = rig();
    expect((await setup(r, null)).code).toBe(2);
    const run = context({ source: NODE });
    expect(await commandOf(r, "setup").run(run.ctx)).toBe(2);
    expect(existsSync(join(r.root, "fg"))).toBe(false);
  });

  it("a release folder without ru-code-install is refused by name, before anything is written", async () => {
    const r = rig();
    const lonely = join(r.home, "lonely");
    mkdirSync(lonely);
    writeFileSync(join(lonely, "fg.mjs"), "x");
    writeFileSync(join(lonely, "install"), "x");
    const run = context({ binDir: lonely, source: NODE });
    expect(await commandOf(r, "setup").run(run.ctx)).toBe(1);
    expect(run.err()).toContain(join(lonely, "ru-code-install"));
    expect(calls(r)).toEqual([]);
    expect(existsSync(join(r.configDir, "skills"))).toBe(false);
  });

  it("D2: a root that already contains a marker is refused before any write", async () => {
    const r = rig({ root: (home) => join(home, ".ru-code", "bin", ".ru-code") });
    const { code, err } = await setup(r);
    expect(code).toBe(1);
    expect(err).toContain("/.ru-code/bin");
    expect(calls(r)).toEqual([]);
    expect(existsSync(join(r.root, "fg"))).toBe(false);
  });
});

describe("teardown — the node half of bash install --uninstall", () => {
  it("E3/D3/F3: clean_rc with fg's marker; the three skills, the plugin and <root>/fg (token included) removed; nothing else", async () => {
    const r = rig({ installed: true });
    await setup(r);
    writeFileSync(join(r.fgBin, ".env"), "PIXSO_REMOTE_MCP_TOKEN=t\n");
    const foreign = join(r.configDir, "skills", "someone-elses");
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, "SKILL.md"), "keep");
    const before = calls(r).length;
    const { code, err } = await teardown(r);
    expect(code).toBe(0);
    expect(calls(r).slice(before)).toEqual([
      "detect_os NO_MAIN=1 LOGFILE=/dev/null",
      "clean_rc APP_DIR_NAME=.ru-code/fg APP_BIN=fguard",
    ]);
    for (const folder of SKILL_FOLDERS) expect(existsSync(join(r.configDir, "skills", folder))).toBe(false);
    expect(readFileSync(join(foreign, "SKILL.md"), "utf8")).toBe("keep");
    expect(existsSync(join(r.root, "plugins", "pixso"))).toBe(false);
    expect(existsSync(join(r.root, "fg"))).toBe(false);
    expect(existsSync(join(r.root, "bin", "cli.js"))).toBe(true);
    expect(err).toContain("удалена вместе с токеном (.env)");
    expect(err).toContain("fguard удалён");
  });

  it("D1: works from the copy in <root>/fg/bin — the release folder may be gone", async () => {
    const r = rig();
    await setup(r);
    const { code } = await teardown(r, r.fgBin);
    expect(code).toBe(0);
    expect(existsSync(join(r.root, "fg"))).toBe(false);
  });

  it("on a machine with nothing installed it still succeeds and says what it found", async () => {
    const r = rig();
    const { code, err } = await teardown(r);
    expect(code).toBe(0);
    expect(err).toContain("pixso не был установлен");
    expect(err).not.toContain("вместе с токеном");
  });
});
