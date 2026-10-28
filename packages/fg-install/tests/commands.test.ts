/**
 * TIER 1 — the three commands end to end, in-process: a fake preflight (the stdout contract,
 * exit 1), a fake installed ru-code whose launcher records its argv, a fixture plugin, and the
 * REAL terminal renderer writing plain text. Every case asserts what the user sees and what is on
 * disk afterwards.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { pick } from "@smart-tools/fg-cli-kit";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { type InstallDeps, createInstallCommands } from "../src/commands.ts";
import { MINIMUM_APP_VERSION } from "../src/constants.ts";
import { layoutOf } from "../src/layout.ts";
import { type InstallPayload, payloadOf } from "../src/payload.ts";
import * as s from "../src/strings.ts";
import {
  MANIFEST,
  cleanScratch,
  context,
  fakeRuCode,
  fixturePayload,
  listTree,
  runtimeState,
  scratch,
  shipOwnCopy,
} from "./support.ts";

afterEach(cleanScratch);

interface Machine {
  readonly root: string;
  readonly argvFile: string;
  readonly payload: InstallPayload;
  readonly commands: ReturnType<typeof createInstallCommands>;
}

/** A scratch ru-code root plus commands wired to it. `alive` decides "is the recorded pid live". */
function machine(
  options: {
    installed?: boolean;
    running?: boolean;
    launcherExit?: number;
    /** The installed ru-code's `current.json` version (fakeRuCode's default: 0.0.40). */
    version?: string;
    payload?: (root: string) => InstallPayload | null;
    deps?: InstallDeps;
  } = {},
): Machine {
  const root = join(scratch(), ".ru-code");
  mkdirSync(root, { recursive: true });
  if (options.installed ?? true) {
    fakeRuCode(root, {
      ...(options.launcherExit === undefined ? {} : { exitCode: options.launcherExit }),
      ...(options.version === undefined ? {} : { version: options.version }),
    });
  }
  if (options.running ?? false) runtimeState(root, 424242);
  const payload = options.payload === undefined ? fixturePayload(root) : options.payload(root);
  const commands = createInstallCommands({
    payload: () => payload,
    isAlive: (pid) => pid === 424242,
    ...options.deps,
  });
  return {
    root,
    argvFile: join(root, "launcher-argv.txt"),
    payload: payload ?? fixturePayload(root),
    commands,
  };
}

const install = (m: Machine) => m.commands[0]!;
const uninstall = (m: Machine) => m.commands[1]!;
const target = (m: Machine) => layoutOf(m.root, "pixso").target;
const restarted = (m: Machine): string[] | null =>
  existsSync(m.argvFile) ? readFileSync(m.argvFile, "utf8").trim().split("\n") : null;

describe("fguard install", () => {
  it("refuses with exit 1 when ru-code is not installed, and writes nothing", async () => {
    const m = machine({ installed: false });
    const run = context();
    expect(await install(m).run(run.ctx)).toBe(1);
    expect(run.err()).toContain("✖ ru-code не установлен");
    expect(run.err()).toContain(join(m.root, "bin", "cli.js"));
    expect(listTree(m.root)).toEqual([]);
  });

  it("installs into <OUR_ROOT>/plugins/<id> — the root the PREFLIGHT reported — and does not restart a stopped ru-code", async () => {
    const m = machine();
    const run = context();
    expect(await install(m).run(run.ctx)).toBe(0);
    for (const file of m.payload.files) {
      expect(readFileSync(join(target(m), file.path))).toEqual(Buffer.from(file.bytes));
    }
    expect(restarted(m)).toBeNull();
    expect(run.err()).toContain("✔ плагин pixso 1.0.0 установлен");
    expect(run.err()).toContain(pick(s.notRunningNote, "ru"));
    expect(run.err()).toContain(target(m));
    // The preflight's failed CLI check is SURFACED, not fatal.
    expect(run.err()).toContain("node ok · cli fail (missing) · git ok");
    // U3: the written folder goes to stdout because stdout is not a terminal here.
    expect(run.out()).toBe(`${target(m)}\n`);
  });

  it("restarts a RUNNING ru-code with exactly `restart --no-browser`, through the launcher", async () => {
    const m = machine({ running: true });
    const run = context();
    expect(await install(m).run(run.ctx)).toBe(0);
    expect(restarted(m)).toEqual(["restart", "--no-browser"]);
    expect(run.err()).toContain(pick(s.restartValues.done, "ru"));
  });

  it("--no-restart: installs, does not restart, says how to apply it", async () => {
    const m = machine({ running: true });
    const run = context({ flags: { "no-restart": true } });
    expect(await install(m).run(run.ctx)).toBe(0);
    expect(existsSync(join(target(m), "plugin.json"))).toBe(true);
    expect(restarted(m)).toBeNull();
    expect(run.err()).toContain(pick(s.noRestartNote, "ru"));
  });

  it("is idempotent: identical bytes → «уже установлен», nothing written, NO restart even while running", async () => {
    const m = machine({ running: true });
    expect(await install(m).run(context({ flags: { "no-restart": true } }).ctx)).toBe(0);
    const run = context();
    expect(await install(m).run(run.ctx)).toBe(0);
    expect(run.err()).toContain("✔ плагин pixso 1.0.0 уже установлен");
    expect(restarted(m)).toBeNull();
    expect(run.out()).toBe("");
  });

  it("replaces a different build and says so", async () => {
    const m = machine();
    mkdirSync(target(m), { recursive: true });
    writeFileSync(join(target(m), "plugin.json"), "{}");
    const run = context();
    expect(await install(m).run(run.ctx)).toBe(0);
    expect(run.err()).toContain("установлен поверх прежнего");
    expect(readFileSync(join(target(m), "plugin.json"), "utf8")).toBe(JSON.stringify(MANIFEST));
  });

  it("a FAILED restart: warning, exit 1, and the files stay installed", async () => {
    const m = machine({ running: true, launcherExit: 3 });
    const run = context();
    expect(await install(m).run(run.ctx)).toBe(1);
    expect(restarted(m)).toEqual(["restart", "--no-browser"]);
    expect(run.err()).toContain("ru-code не перезапустился");
    expect(run.err()).toContain("кодом 3");
    expect(existsSync(join(target(m), "plugin.json"))).toBe(true);
  });

  it("WARNS loudly when ru-code ships its own copy — and still installs", async () => {
    const m = machine();
    const shipped = shipOwnCopy(m.root);
    const run = context();
    expect(await install(m).run(run.ctx)).toBe(0);
    expect(run.err()).toContain(`! ru-code 0.0.40 поставляет собственный pixso`);
    expect(run.err()).toContain(shipped);
    expect(existsSync(join(target(m), "plugin.json"))).toBe(true);
  });

  it("refuses an embedded plugin ru-code would skip (apiVersion 1), exit 1, nothing written", async () => {
    const m = machine({
      payload: (root) => fixturePayload(root, "v1", { ...MANIFEST, apiVersion: 1 }),
    });
    const run = context();
    expect(await install(m).run(run.ctx)).toBe(1);
    expect(run.err()).toContain(pick(s.badManifest, "ru"));
    expect(run.err()).toContain("apiVersion 1");
    expect(existsSync(join(m.root, "plugins"))).toBe(false);
  });

  it("refuses with exit 1 when the build carries no payload", async () => {
    const m = machine({ payload: () => null });
    const run = context();
    expect(await install(m).run(run.ctx)).toBe(1);
    expect(run.err()).toContain(pick(s.noPayload, "ru"));
  });

  it("refuses with exit 1 when the preflight prints no OUR_ROOT, quoting its stderr", async () => {
    const m = machine({
      payload: (root) => ({
        ...fixturePayload(root),
        preflight: new TextEncoder().encode(
          "process.stderr.write('boom: no home\\n'); process.exit(1);",
        ),
      }),
    });
    const run = context();
    expect(await install(m).run(run.ctx)).toBe(1);
    expect(run.err()).toContain(pick(s.preflightFailed, "ru"));
    expect(run.err()).toContain("boom: no home");
  });

  it("refuses a stray positional with exit 2 and its own usage line", async () => {
    const m = machine();
    const run = context({ source: "extra" });
    expect(await install(m).run(run.ctx)).toBe(2);
    expect(run.err()).toContain("лишний аргумент: extra");
    expect(run.err()).toContain("fguard install [--check] [--no-restart]");
  });

  it("speaks English under --lang en", async () => {
    const m = machine({ running: true });
    const run = context({ lang: "en" });
    expect(await install(m).run(run.ctx)).toBe(0);
    expect(run.err()).toContain("✔ plugin pixso 1.0.0 installed");
    expect(run.err()).toContain("done: ru-code restart --no-browser");
    expect(run.err()).not.toMatch(/[а-яё]/i);
  });

  it("--verbose shows the preflight's own diagnostics", async () => {
    const m = machine();
    const run = context({ verbose: true });
    expect(await install(m).run(run.ctx)).toBe(0);
    expect(run.err()).toContain("Диагностика:");
  });
});

describe("fguard install --check — read-only, exit 0 only when installed, identical and not shadowed", () => {
  const check = async (m: Machine, lang: "ru" | "en" = "ru") => {
    const before = listTree(m.root);
    const run = context({ lang, flags: { check: true } });
    const code = await install(m).run(run.ctx);
    // Nothing written, whatever the answer.
    expect(listTree(m.root)).toEqual(before);
    return { code, err: run.err() };
  };

  it("absent → 1", async () => {
    const r = await check(machine());
    expect(r.code).toBe(1);
    expect(r.err).toContain("✖ плагин pixso не установлен");
  });

  it("identical, not shadowed → 0, and reports every fact", async () => {
    const m = machine({ running: true });
    await install(m).run(context({ flags: { "no-restart": true } }).ctx);
    const r = await check(m);
    expect(r.code).toBe(0);
    expect(r.err).toContain("✔ плагин pixso 1.0.0 установлен и совпадает со встроенным");
    expect(r.err).toContain("да, совпадает со встроенным");
    expect(r.err).toContain("да (pid 424242)");
    expect(r.err).toContain(pick(s.restartValues.wouldNot, "ru"));
    expect(r.err).toContain(target(m));
  });

  it("different → 1, and a running ru-code WOULD be restarted", async () => {
    const m = machine({ running: true });
    mkdirSync(target(m), { recursive: true });
    writeFileSync(join(target(m), "plugin.json"), "{}");
    const r = await check(m);
    expect(r.code).toBe(1);
    expect(r.err).toContain("но не тот, что встроен в fg");
    expect(r.err).toContain(pick(s.restartValues.wouldRun, "ru"));
  });

  it("identical but SHADOWED by ru-code's own copy → 1", async () => {
    const m = machine();
    await install(m).run(context().ctx);
    shipOwnCopy(m.root);
    const r = await check(m);
    expect(r.code).toBe(1);
    expect(r.err).toContain("ru-code загрузит свою копию");
  });

  it("ru-code not installed → 1 (a fact, not a crash)", async () => {
    const r = await check(machine({ installed: false }), "en");
    expect(r.code).toBe(1);
    expect(r.err).toContain("✖ ru-code is not installed");
    expect(r.err).toContain("node ok · cli fail (missing) · git ok");
  });

  it("never restarts", async () => {
    const m = machine({ running: true });
    await check(m);
    expect(restarted(m)).toBeNull();
  });

  it("`--check --no-restart` on a different build with ru-code running → «не понадобится» (audit V2)", async () => {
    const m = machine({ running: true });
    mkdirSync(target(m), { recursive: true });
    writeFileSync(join(target(m), "plugin.json"), "{}");
    const run = context({ flags: { check: true, "no-restart": true } });
    expect(await install(m).run(run.ctx)).toBe(1);
    expect(run.err()).toContain(pick(s.restartValues.wouldNot, "ru"));
    expect(run.err()).not.toContain(pick(s.restartValues.wouldRun, "ru"));
  });

  it("writes nothing even when a lock is held (it does not take one)", async () => {
    const m = machine();
    mkdirSync(join(m.root, ".fg-install", "lock"), { recursive: true });
    writeFileSync(join(m.root, ".fg-install", "lock", "pid"), "424242");
    const before = listTree(m.root);
    const run = context({ flags: { check: true } });
    expect(await install(m).run(run.ctx)).toBe(1);
    expect(listTree(m.root)).toEqual(before);
  });
});

describe("the restart process — node directly, like the installer (audit 5)", () => {
  it("runs `<node> --experimental-sqlite --disable-warning=… <bin>/cli.js restart --no-browser` — the cli.js is what records it", async () => {
    const m = machine({ running: true });
    const run = context();
    expect(await install(m).run(run.ctx), run.err()).toBe(0);
    expect(restarted(m)).toEqual(["restart", "--no-browser"]);
    expect(readFileSync(join(m.root, "launcher-execargv.txt"), "utf8").trim().split("\n")).toEqual(
      expect.arrayContaining(["--experimental-sqlite", "--disable-warning=ExperimentalWarning"]),
    );
  });

  it("works with NO executable launcher at all (the sh wrapper is never run, so a denied script cannot break the restart)", async () => {
    const m = machine({ running: true });
    // Present but not executable: the installer's own scenario («command not allowed»).
    chmodSync(join(m.root, "bin", "ru-code"), 0o644);
    expect(await install(m).run(context().ctx)).toBe(0);
    expect(restarted(m)).toEqual(["restart", "--no-browser"]);
  });
});

describe("a concurrent run (the lock)", () => {
  it("install: a live lock → exit 1, localized, nothing written; en too", async () => {
    const m = machine({ running: true });
    const lock = join(m.root, ".fg-install", "lock");
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "pid"), "424242");
    const ru = context();
    expect(await install(m).run(ru.ctx)).toBe(1);
    expect(ru.err()).toContain("другой запуск fguard install/uninstall уже работает");
    expect(ru.err()).toContain(lock);
    expect(existsSync(target(m))).toBe(false);
    expect(restarted(m)).toBeNull();
    const en = context({ lang: "en" });
    expect(await install(m).run(en.ctx)).toBe(1);
    expect(en.err()).toContain("another fguard install/uninstall is already running");
  });

  it("uninstall: a live lock → exit 1; the plugin stays", async () => {
    const m = machine();
    await install(m).run(context().ctx);
    const lock = join(m.root, ".fg-install", "lock");
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "pid"), "424242");
    const run = context();
    expect(await uninstall(m).run(run.ctx)).toBe(1);
    expect(run.err()).toContain("уже работает");
    expect(existsSync(target(m))).toBe(true);
  });
});

describe("fguard uninstall", () => {
  it("removes the folder, keeps <stateDir>/plugins/<id>, restarts a running ru-code", async () => {
    const m = machine({ running: true });
    await install(m).run(context({ flags: { "no-restart": true } }).ctx);
    const data = join(m.root, "userdata", "plugins", "pixso", "data.sqlite");
    mkdirSync(join(data, ".."), { recursive: true });
    writeFileSync(data, "rows");
    const run = context();
    expect(await uninstall(m).run(run.ctx)).toBe(0);
    expect(existsSync(target(m))).toBe(false);
    expect(readFileSync(data, "utf8")).toBe("rows");
    expect(restarted(m)).toEqual(["restart", "--no-browser"]);
    expect(run.err()).toContain("✔ плагин pixso удалён");
  });

  it("not installed → «не был установлен», exit 0, no restart", async () => {
    const m = machine({ running: true });
    const run = context();
    expect(await uninstall(m).run(run.ctx)).toBe(0);
    expect(run.err()).toContain("не был установлен");
    expect(restarted(m)).toBeNull();
  });

  it("--no-restart is honoured", async () => {
    const m = machine({ running: true });
    await install(m).run(context({ flags: { "no-restart": true } }).ctx);
    expect(await uninstall(m).run(context({ flags: { "no-restart": true } }).ctx)).toBe(0);
    expect(restarted(m)).toBeNull();
  });

  it("works when ru-code itself is gone (removes a leftover plugin folder)", async () => {
    const m = machine({ installed: false });
    mkdirSync(target(m), { recursive: true });
    expect(await uninstall(m).run(context().ctx)).toBe(0);
    expect(existsSync(target(m))).toBe(false);
  });
});

const pointer = (m: Machine) => join(m.root, "bin", "current.json");
const setVersion = (m: Machine, version: unknown) =>
  writeFileSync(
    pointer(m),
    JSON.stringify({ schema: 1, version, entry: "versions/0.0.40/cli.js" }),
  );

describe("the version gate — MINIMUM_APP_VERSION against <bin>/current.json", () => {
  it("is 0.0.34 — the first ru-code release after the host API commit 0789709c71", () => {
    expect(MINIMUM_APP_VERSION).toBe("0.0.34");
  });

  for (const [what, version] of [
    ["equal", "0.0.34"],
    ["newer patch", "0.0.40"],
    ["newer minor beats an older patch", "0.1.0"],
    ["newer major", "1.0.0"],
    ["a pre-release of the minimum (suffix ignored, as ru-code's wrapper does)", "0.0.34-rc.1"],
    ["a leading v", "v0.0.34"],
  ] as const) {
    it(`installs: ${what} (${version})`, async () => {
      const m = machine({ version });
      const run = context();
      expect(await install(m).run(run.ctx)).toBe(0);
      expect(existsSync(join(target(m), "plugin.json"))).toBe(true);
    });
  }

  for (const [what, version] of [
    ["older patch", "0.0.33"],
    ["a pre-release of an older one", "0.0.33-rc.9"],
    ["older minor despite a big patch", "0.0.9"],
  ] as const) {
    it(`refuses: ${what} (${version}) — exit 1, both versions on the card, NOTHING written`, async () => {
      const m = machine({ version, running: true });
      const before = listTree(m.root);
      const run = context();
      expect(await install(m).run(run.ctx)).toBe(1);
      expect(run.err()).toContain(
        `✖ установлен ru-code ${version}, а плагину pixso нужен 0.0.34 или новее`,
      );
      expect(run.err()).toContain("обновите ru-code и повторите fguard install");
      expect(listTree(m.root)).toEqual(before);
      expect(existsSync(target(m))).toBe(false);
      expect(existsSync(join(m.root, ".fg-install"))).toBe(false);
      expect(restarted(m)).toBeNull();
    });
  }

  it("refuses an older ru-code in English too", async () => {
    const m = machine({ version: "0.0.33" });
    const run = context({ lang: "en" });
    expect(await install(m).run(run.ctx)).toBe(1);
    expect(run.err()).toContain(
      "✖ ru-code 0.0.33 is installed, but the pixso plugin needs 0.0.34 or newer",
    );
    expect(run.err()).toContain("update ru-code and run fguard install again");
    expect(run.err()).not.toMatch(/[а-яё]/i);
  });

  it("leaves an already-installed copy untouched when refusing", async () => {
    const m = machine();
    expect(await install(m).run(context().ctx)).toBe(0);
    setVersion(m, "0.0.33");
    const before = listTree(m.root);
    const bytes = readFileSync(join(target(m), "plugin.json"));
    expect(await install(m).run(context().ctx)).toBe(1);
    expect(listTree(m.root)).toEqual(before);
    expect(readFileSync(join(target(m), "plugin.json"))).toEqual(bytes);
  });

  for (const [what, body] of [
    ["no current.json", undefined],
    ["garbage JSON", "{nope"],
    [
      "a garbage version",
      JSON.stringify({ schema: 1, version: "latest", entry: "versions/0.0.40/cli.js" }),
    ],
    [
      "a two-part version",
      JSON.stringify({ schema: 1, version: "0.34", entry: "versions/0.0.40/cli.js" }),
    ],
    [
      "a numeric version",
      JSON.stringify({ schema: 1, version: 34, entry: "versions/0.0.40/cli.js" }),
    ],
  ] as const) {
    it(`cannot verify with ${what} → its own message, exit 1, nothing written (not a crash)`, async () => {
      const m = machine();
      rmSync(pointer(m));
      if (body !== undefined) writeFileSync(pointer(m), body);
      const before = listTree(m.root);
      const ru = context();
      expect(await install(m).run(ru.ctx)).toBe(1);
      expect(ru.err()).toContain(
        "✖ не удалось узнать версию ru-code, а плагину pixso нужен 0.0.34 или новее",
      );
      expect(ru.err()).toContain(`в ${pointer(m)} нет версии вида X.Y.Z`);
      const en = context({ lang: "en" });
      expect(await install(m).run(en.ctx)).toBe(1);
      expect(en.err()).toContain(
        "✖ could not tell which ru-code version is installed, and the pixso plugin needs 0.0.34 or newer",
      );
      expect(listTree(m.root)).toEqual(before);
    });
  }

  it("--check: rows «версия ru-code» and «нужен ≥ 0.0.34»; too old → exit 1 with the same reason, even when identical", async () => {
    const m = machine();
    expect(await install(m).run(context().ctx)).toBe(0);
    const fine = context({ flags: { check: true } });
    expect(await install(m).run(fine.ctx)).toBe(0);
    expect(fine.err()).toMatch(/версия ru-code +0\.0\.40/u);
    expect(fine.err()).toMatch(/нужен +≥ 0\.0\.34/u);

    setVersion(m, "0.0.33");
    const old = context({ flags: { check: true } });
    expect(await install(m).run(old.ctx)).toBe(1);
    expect(old.err()).toContain(
      "✖ установлен ru-code 0.0.33, а плагину pixso нужен 0.0.34 или новее",
    );
    expect(old.err()).toMatch(/версия ru-code +0\.0\.33/u);

    const en = context({ lang: "en", flags: { check: true } });
    expect(await install(m).run(en.ctx)).toBe(1);
    expect(en.err()).toMatch(/ru-code version +0\.0\.33/u);
    expect(en.err()).toMatch(/required +≥ 0\.0\.34/u);
  });

  it("--check: an unverifiable version → exit 1, «неизвестна»", async () => {
    const m = machine();
    expect(await install(m).run(context().ctx)).toBe(0);
    setVersion(m, "garbage");
    const run = context({ flags: { check: true } });
    expect(await install(m).run(run.ctx)).toBe(1);
    expect(run.err()).toContain("✖ не удалось узнать версию ru-code");
    expect(run.err()).toContain("неизвестна (bin/current.json)");
  });

  it("uninstall ignores the gate: removing always works on a too-old or unverifiable ru-code", async () => {
    for (const version of ["0.0.33", "garbage"]) {
      const m = machine();
      expect(await install(m).run(context().ctx)).toBe(0);
      setVersion(m, version);
      const run = context();
      expect(await uninstall(m).run(run.ctx)).toBe(0);
      expect(existsSync(target(m))).toBe(false);
      expect(run.err()).toContain("✔ плагин pixso удалён");
    }
  });
});

describe("strings", () => {
  it("every Localized has two different, non-empty halves where the text is prose", () => {
    const prose = [
      s.installSummary,
      s.uninstallSummary,
      s.installDetails,
      s.uninstallDetails,
      s.checkArg.description,
      s.noRestartArg.description,
      s.notRunningNote,
      s.noRestartNote,
      s.unchangedNote,
      s.noPayload,
      s.preflightFailed,
      s.ruCodeNotInstalled,
      s.badManifest,
      s.appTooOld("0.0.33", "pixso", "0.0.34"),
      s.appTooOldDetail,
      s.appVersionUnknown("pixso", "0.0.34"),
      s.appVersionUnknownDetail("/r/bin/current.json"),
      s.appVersionUnknownValue,
    ];
    for (const l of prose) {
      expect(l.ru).not.toBe("");
      expect(l.en).not.toBe("");
      expect(l.ru).not.toBe(l.en);
      expect(l.ru).toMatch(/[а-яё]/i);
      expect(l.en).not.toMatch(/[а-яё]/i);
    }
  });

  it("summaries fit the help table's 40 columns", () => {
    for (const l of [s.installSummary, s.uninstallSummary]) {
      expect([...l.ru].length).toBeLessThanOrEqual(40);
      expect([...l.en].length).toBeLessThanOrEqual(40);
    }
  });

  it("payloadOf sorts files, so the swap and the comparison see one order", () => {
    const p = payloadOf({ preflight: "", pluginDir: "x", files: { "b.txt": "b", "a.txt": "a" } });
    expect(p.files.map((f) => f.path)).toEqual(["a.txt", "b.txt"]);
  });
});
