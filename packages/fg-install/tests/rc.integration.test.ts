/**
 * TIER 2 — the `fguard` rc line, env.sh and wrapper, written by ru-code's OWN installer code
 * (`vendor/ru-code/install` = a fresh build of ru-code HEAD, shipped verbatim as
 * `ru-code-install`), in scratch HOMEs, checked in real bash and zsh (D2, D3, A3).
 *
 * "Expected" bytes are never written down here: they are produced by calling ru-code's functions
 * (`rc_env_content`, `rc_source_line`, `create_wrapper`, `add_path`, `clean_rc`) directly, with
 * the same inputs, in a separate bash — so the comparison is fg's output against ru-code's code.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { applyRc } from "../src/rc.ts";
import { cleanScratch, scratch } from "./support.ts";

afterEach(cleanScratch);

const INSTALLER = resolve(dirname(fileURLToPath(import.meta.url)), "../../../vendor/ru-code/install");
const NODE = process.execPath;
const RC_FILES = [".bashrc", ".profile", ".zshrc"];

interface Box {
  readonly home: string;
  readonly root: string;
  readonly fgBin: string;
}

function box(): Box {
  const home = scratch("fg-rc-");
  const root = join(home, ".ru-code");
  const fgBin = join(root, "fg", "bin");
  mkdirSync(fgBin, { recursive: true });
  // A stand-in bundle the function / wrapper runs: prints its argv so a shell run is observable.
  writeFileSync(join(fgBin, "fg.mjs"), "console.log('stub-fg ' + process.argv.slice(2).join(' '));\n");
  return { home, root, fgBin };
}

/** Run `body` in bash with ru-code's installer sourced the way its own tests do (harness.ts). */
function ruCode(home: string, body: string, env: Record<string, string> = {}): string {
  const run = spawnSync(
    "bash",
    ["-c", `. "${INSTALLER}"\nLOGFILE=/dev/null\ndetect_os\n${body}`],
    {
      env: { HOME: home, PATH: process.env["PATH"] ?? "", RU_CODE_INSTALL_NO_MAIN: "1", ...env },
      encoding: "utf8",
    },
  );
  if (run.status !== 0) throw new Error(`bash failed: ${run.stderr}`);
  return run.stdout;
}

/** ru-code's OWN line for `<root>/bin`, written by its own add_path with its own values. */
function ruCodeLine(b: Box, sourced: boolean): void {
  mkdirSync(join(b.root, "bin"), { recursive: true });
  ruCode(
    b.home,
    `APP_DIR_NAME=.ru-code; APP_BIN=ru-code; BIN_DIR="${join(b.root, "bin")}"; ENTRY_JS=cli.js; NODE_PATH="${NODE}"\nclean_rc\nadd_path`,
    { INSTALL_USE_RC_SOURCED_LAUNCHER: String(sourced) },
  );
}

const fgAdd = (b: Box, sourced: boolean) =>
  applyRc({
    action: "add",
    installer: INSTALLER,
    root: b.root,
    binDir: b.fgBin,
    node: NODE,
    logFile: "/dev/null",
    env: { HOME: b.home, PATH: process.env["PATH"], INSTALL_USE_RC_SOURCED_LAUNCHER: String(sourced) },
  });

const fgRemove = (b: Box) =>
  applyRc({
    action: "remove",
    installer: INSTALLER,
    root: b.root,
    binDir: b.fgBin,
    node: "",
    logFile: "/dev/null",
    env: { HOME: b.home, PATH: process.env["PATH"] },
  });

const rc = (b: Box, name: string): string => {
  const file = join(b.home, name);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
};

/** A fresh interactive shell in the sandbox HOME; returns its stdout. */
function shell(b: Box, sh: "bash" | "zsh", command: string): string {
  const run = spawnSync(sh, ["-i", "-c", command], {
    env: { HOME: b.home, PATH: "/usr/local/bin:/usr/bin:/bin", TERM: "dumb" },
    encoding: "utf8",
  });
  return run.stdout;
}

describe("D2 — byte-exact: fg's files are what ru-code's functions produce for fg's inputs", () => {
  it("sourced mode: env.sh == rc_env_content, rc line == rc_source_line, in every write target", async () => {
    const b = box();
    const result = await fgAdd(b, true);
    expect(result.code).toBe(0);
    expect(result.sourced).toBe(true);
    const expectedEnv = ruCode(
      b.home,
      `APP_BIN=fguard; APP_DISPLAY_NAME="Frontend Guard"; ENTRY_JS=fg.mjs; NODE_PATH="${NODE}"; NODE_FLAGS=""; PATH_BIN="${b.fgBin}"\nrc_env_content`,
    );
    expect(readFileSync(join(b.fgBin, "env.sh"), "utf8")).toBe(expectedEnv);
    const expectedLine = ruCode(b.home, `rc_source_line "${b.fgBin}/env.sh"`);
    expect(result.line).toBe(expectedLine);
    for (const name of RC_FILES) expect(rc(b, name)).toBe(`${expectedLine}\n`);
    expect(result.files).toEqual(RC_FILES.map((name) => join(b.home, name)));
  });

  it("classic mode: the line is ru-code's PATH line, the wrapper is create_wrapper's", async () => {
    const b = box();
    const result = await fgAdd(b, false);
    expect(result.sourced).toBe(false);
    expect(result.line).toBe(`export PATH="${b.fgBin}:$PATH"`);
    const other = join(b.home, "other-bin");
    mkdirSync(other);
    ruCode(
      b.home,
      `APP_BIN=fguard; ENTRY_JS=fg.mjs; NODE_PATH="${NODE}"; NODE_FLAGS=""; BIN_DIR="${other}"\ncreate_wrapper`,
    );
    // create_wrapper's POSIX form is relocatable (`dirname "$0"`), so the bytes match exactly.
    expect(readFileSync(join(b.fgBin, "fguard"), "utf8")).toBe(readFileSync(join(other, "fguard"), "utf8"));
  });
});

describe("D3 — ru-code and fg never touch each other's line (both modes)", () => {
  for (const sourced of [false, true]) {
    const mode = sourced ? "sourced" : "classic";

    it(`${mode}: fg install keeps ru-code's line byte-for-byte, and fg uninstall too`, async () => {
      const b = box();
      ruCodeLine(b, sourced);
      const before = Object.fromEntries(RC_FILES.map((n) => [n, rc(b, n)]));
      expect(before[".bashrc"]).toContain(`${b.root}/bin`);
      await fgAdd(b, sourced);
      for (const name of RC_FILES) {
        expect(rc(b, name).startsWith(before[name] ?? "∅")).toBe(true);
        expect(rc(b, name)).toContain(b.fgBin);
      }
      expect((await fgRemove(b)).code).toBe(0);
      for (const name of RC_FILES) expect(rc(b, name)).toBe(before[name]);
    });

    it(`${mode}: ru-code's install / uninstall (clean_rc + add_path) keep fg's line`, async () => {
      const b = box();
      await fgAdd(b, sourced);
      const fgLine = (await fgAdd(b, sourced)).line ?? "";
      ruCodeLine(b, sourced); // install / update: clean_rc then add_path
      for (const name of RC_FILES) expect(rc(b, name).split("\n")).toContain(fgLine);
      ruCode(b.home, "APP_DIR_NAME=.ru-code; APP_BIN=ru-code\nclean_rc"); // uninstall
      for (const name of RC_FILES) {
        expect(rc(b, name).split("\n")).toContain(fgLine);
        expect(rc(b, name)).not.toContain(`${b.root}/bin`);
      }
    });

    it(`${mode}: in a NEW bash and zsh, fguard runs the bundle on <NODE>`, async () => {
      const b = box();
      ruCodeLine(b, sourced);
      await fgAdd(b, sourced);
      for (const sh of ["bash", "zsh"] as const) {
        expect(shell(b, sh, "fguard --version")).toContain("stub-fg --version");
      }
    });
  }
});

describe("A3 — a re-run changes nothing and never duplicates a line", () => {
  it("second add: every rc file byte-identical, exactly one fg line", async () => {
    const b = box();
    writeFileSync(join(b.home, ".bashrc"), "# user's own\nalias ll='ls -l'\n");
    await fgAdd(b, true);
    const first = RC_FILES.map((n) => rc(b, n));
    await fgAdd(b, true);
    expect(RC_FILES.map((n) => rc(b, n))).toEqual(first);
    expect(rc(b, ".bashrc").split("\n").filter((l) => l.includes(b.fgBin))).toHaveLength(1);
    expect(rc(b, ".bashrc").startsWith("# user's own\nalias ll='ls -l'\n")).toBe(true);
  });

  it("switching mode converges in one run — the old shape is replaced, not added to", async () => {
    const b = box();
    await fgAdd(b, false);
    await fgAdd(b, true);
    const lines = rc(b, ".zshrc").split("\n").filter((l) => l.includes(b.fgBin));
    expect(lines).toEqual([`[ -f "${b.fgBin}/env.sh" ] && . "${b.fgBin}/env.sh"`]);
  });

  it("a stale fguard line in a scrub-only file (.zprofile, an old root) is removed on install — clean_rc's job", async () => {
    const b = box();
    const stale = 'export PATH="/old/home/.ru-code/fg/bin:$PATH"';
    writeFileSync(join(b.home, ".zprofile"), `export LANG=C\n\n${stale}\n`);
    await fgAdd(b, false);
    expect(rc(b, ".zprofile")).toBe("export LANG=C\n");
  });

  it("uninstall gives the user their bytes back", async () => {
    const b = box();
    writeFileSync(join(b.home, ".zshrc"), "export EDITOR=vim\n");
    await fgAdd(b, true);
    await fgRemove(b);
    expect(rc(b, ".zshrc")).toBe("export EDITOR=vim\n");
  });
});
