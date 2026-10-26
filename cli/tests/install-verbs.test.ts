/**
 * TIER 1 — the VERB surface brief a1 adds: `fg install`, `fg install --check`, `fg uninstall`
 * (+ `--no-restart`), parsed and dispatched against the REAL registry. What the commands DO is
 * `packages/fg-install`'s suite; this file pins how the CLI reaches them, and that nothing that
 * parsed before parses differently now.
 */
import { createUi } from "@smart-tools/fg-cli-kit";
import { describe, expect, it } from "vite-plus/test";

import { commandHelpText, helpText } from "../src/help.ts";
import { type RunDeps, run } from "../src/main.ts";
import { EXIT_OK, EXIT_USAGE, isVerb, parseInvocation } from "../src/parse.ts";
import { COMMANDS } from "../src/registry.ts";

const parse = (argv: readonly string[]) => parseInvocation(argv, COMMANDS);

function harness(): { deps: RunDeps; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    deps: {
      commands: COMMANDS,
      version: "1.1.0",
      readEnv: () => ({}),
      cwd: () => process.cwd(),
      loadEnv: () => ({ loaded: false }),
      stdout: (s) => void (out += s),
      stderr: (s) => void (err += s),
      stdoutColumns: () => undefined,
      ui: (lang) => createUi({ stream: { write: (s) => void (err += s) }, lang, env: {} }),
    },
    out: () => out,
    err: () => err,
  };
}

describe("verbs are parsed from the first positional", () => {
  it("`install` and `uninstall` are the registry's two verbs", () => {
    expect(COMMANDS.filter(isVerb).map((c) => c.flag)).toEqual(["install", "uninstall"]);
  });

  it("fg install → the install command, no source, no flags set", () => {
    const result = parse(["install"]);
    expect(result.kind).toBe("command");
    if (result.kind !== "command") return;
    expect(result.command.flag).toBe("install");
    expect(result.source).toBeUndefined();
    expect(result.flags["check"]).toBe(false);
    expect(result.flags["no-restart"]).toBe(false);
  });

  it("fg install --check → check set; fg install --no-restart → no-restart set", () => {
    const check = parse(["install", "--check"]);
    const noRestart = parse(["--lang", "en", "install", "--no-restart"]);
    expect(check.kind === "command" && check.flags["check"]).toBe(true);
    expect(noRestart.kind === "command" && noRestart.flags["no-restart"]).toBe(true);
    expect(noRestart.lang).toBe("en");
  });

  it("fg uninstall --no-restart → uninstall", () => {
    const result = parse(["uninstall", "--no-restart"]);
    expect(result.kind === "command" && result.command.flag).toBe("uninstall");
  });

  it("a word after the verb arrives as `source`, for the command to refuse", () => {
    const result = parse(["install", "extra"]);
    expect(result.kind === "command" && result.source).toBe("extra");
  });

  it("NO REGRESSION: after a flag command, `install` is still that command's argument", () => {
    const result = parse(["--preport", "install"]);
    expect(result.kind).toBe("command");
    if (result.kind !== "command") return;
    expect(result.command.alias).toBe("--preport");
    expect(result.source).toBe("install");
  });

  it("a word that is not a verb is still no command (help, exit 2)", () => {
    expect(parse(["instal"])).toMatchObject({ kind: "help", exitCode: EXIT_USAGE });
  });
});

describe("undeclared flags → exit 2, localized", () => {
  const refusals: readonly (readonly [readonly string[], string, string])[] = [
    [["uninstall", "--check"], "флаг --check не поддерживается командой uninstall", "ru"],
    [["install", "-o", "x"], "флаг -o не поддерживается командой install", "ru"],
    [["install", "--format", "json"], "--format", "ru"],
    [["--lang", "en", "install", "-o", "x"], "-o", "en"],
  ];
  // The two verb-only switches and the verbs' flag-style spelling are INVISIBLE outside the verbs:
  // 1.0.0's exact answer — «неизвестный флаг: <first such token>», exit 2, the GENERIC usage hint
  // (no command named) — recorded from the repo-root 1.0.0 `fg.mjs` with the same argv.
  const unknownAs1_0_0: readonly (readonly [readonly string[], string])[] = [
    [["--psvg", "1:2", "--check"], "--check"],
    [["--preport", ".", "--no-restart"], "--no-restart"],
    [["--check"], "--check"],
    [["--no-restart"], "--no-restart"],
    [["--install"], "--install"],
    [["--uninstall"], "--uninstall"],
    [["--install", "--check"], "--install"],
    [["--check", "--install"], "--check"],
    [["--psvg", "1:2", "--install"], "--install"],
    [["--version", "--check"], "--check"],
    [["--help", "--check"], "--check"],
    [["--psvg", "1:2", "--help", "--no-restart"], "--no-restart"],
  ];
  for (const [argv, token] of unknownAs1_0_0) {
    it(`fg ${argv.join(" ")} → «неизвестный флаг: ${token}», exit 2 — as 1.0.0`, async () => {
      const h = harness();
      expect(await run(argv, h.deps)).toBe(EXIT_USAGE);
      expect(h.err()).toContain(`✖ неизвестный флаг: ${token}`);
      expect(h.err()).toContain("fg <команда> <аргумент> [опции]");
      expect(h.err()).not.toContain("не поддерживается");
      expect(h.out()).toBe("");
    });
  }

  it("…in English too", async () => {
    const h = harness();
    expect(await run(["--lang", "en", "--uninstall"], h.deps)).toBe(EXIT_USAGE);
    expect(h.err()).toContain("unknown flag: --uninstall");
    expect(h.err()).not.toMatch(/[а-яё]/i);
  });

  it("`fg --uninstall` and `fg --install` RUN NOTHING (parse level)", () => {
    for (const flag of ["--install", "--uninstall"]) {
      expect(parse([flag]).kind).toBe("error");
      expect(parse([flag, "--no-restart"]).kind).toBe("error");
    }
  });

  it("what keeps working: `fg --help --install`, `fg install --check`, `fg --help install --check`", () => {
    expect(parse(["--help", "--install"])).toMatchObject({ kind: "help", exitCode: EXIT_OK });
    expect(parse(["install", "--check"]).kind).toBe("command");
    expect(parse(["uninstall", "--no-restart"]).kind).toBe("command");
    expect(parse(["--help", "install", "--check"])).toMatchObject({
      kind: "help",
      exitCode: EXIT_OK,
    });
  });

  for (const [argv, needle, lang] of refusals) {
    it(`fg ${argv.join(" ")}`, async () => {
      const h = harness();
      expect(await run(argv, h.deps)).toBe(EXIT_USAGE);
      expect(h.err()).toContain(needle);
      if (lang === "en") expect(h.err()).not.toMatch(/[а-яё]/i);
      expect(h.out()).toBe("");
    });
  }

  it("a stray argument after the verb is refused by the command with exit 2", async () => {
    const h = harness();
    expect(await run(["install", "extra"], h.deps)).toBe(EXIT_USAGE);
    expect(h.err()).toContain("лишний аргумент: extra");
  });
});

describe("help", () => {
  it("fg --help lists both verbs under their own group, in both languages", () => {
    const ru = helpText(COMMANDS, "ru", "1.1.0");
    const en = helpText(COMMANDS, "en", "1.1.0");
    expect(ru).toContain("Плагин для ru-code");
    expect(en).toContain("ru-code plugin");
    for (const text of [ru, en]) {
      expect(text).toMatch(/^ {2}install {2,}/m);
      expect(text).toMatch(/^ {2}uninstall {2,}/m);
      expect(text).toMatch(/^ {6}--check {2,}/m);
      expect(text).toMatch(/^ {6}--no-restart {2,}/m);
    }
  });

  for (const argv of [
    ["--help", "install"],
    ["install", "--help"],
    ["--help", "--install"],
  ]) {
    it(`fg ${argv.join(" ")} prints install's own page, exit 0`, async () => {
      const h = harness();
      expect(await run(argv, h.deps)).toBe(EXIT_OK);
      expect(h.out().split("\n")[0]).toBe("fg install [--check] [--no-restart]");
      expect(h.out()).toContain("ru-code restart --no-browser");
    });
  }

  it("the per-command pages are prose in both languages", () => {
    const install = COMMANDS.find((c) => c.flag === "install");
    expect(install).toBeDefined();
    if (install === undefined) return;
    expect(commandHelpText(install, "ru")).toContain("Примеры");
    expect(commandHelpText(install, "en")).toContain("Examples");
    expect(commandHelpText(install, "en")).not.toMatch(/[а-яё]/i);
  });
});

describe("the main help's `-o` footer is true for the verbs (audit 11e)", () => {
  it("names install and uninstall beside --pkit, in both languages", () => {
    expect(helpText(COMMANDS, "ru", "1.1.0")).toContain("кроме --pkit, install, uninstall");
    expect(helpText(COMMANDS, "en", "1.1.0")).toContain("except --pkit, install, uninstall");
  });

  it("…and the verbs really do refuse -o (so the footer is the rule, not a wish)", () => {
    for (const verb of ["install", "uninstall"]) {
      const result = parse([verb, "-o", "x"]);
      expect(result.kind).toBe("error");
    }
  });
});
