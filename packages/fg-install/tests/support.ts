/**
 * Shared fixtures for the tier-1 suite. NOTHING here reads `vendor/`: the payload is a tiny
 * fixture plugin and the preflight is a fake script that prints the stdout contract
 * (R/apps/server/src/ru-code/preflight/preflight.ts:75-95,139-142) for a scratch root.
 */
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type CommandContext, type Lang, createUi } from "@smart-tools/fg-cli-kit";

import { type InstallPayload, payloadOf } from "../src/payload.ts";

const made: string[] = [];

/** A fresh scratch directory, removed by {@link cleanScratch}. */
export function scratch(prefix = "fg-install-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

export function cleanScratch(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** A preflight that prints the contract for `root` and exits `code` (1 = a failed check, keys still printed). */
export function fakePreflight(root: string, code = 1, extra = ""): string {
  return [
    "const out = (s) => process.stdout.write(s + '\\n');",
    "process.stderr.write('Диагностика:\\n  HOME=fake\\n');",
    `out(${JSON.stringify(`OUR_ROOT=${root}`)});`,
    "out('APP_BIN=ru-code'); out('NODE_OK=1'); out('CLI_JS=');",
    "out('CHECK_NODE=ok'); out('CHECK_CLI=fail'); out('CHECK_GIT=ok'); out('CHECK_CLI_KIND=missing');",
    extra,
    `process.exitCode = ${code};`,
  ].join("\n");
}

export const MANIFEST = {
  id: "pixso",
  name: { en: "Pixso", ru: "Pixso" },
  version: "1.0.0",
  apiVersion: 2,
  server: "server/index.mjs",
  web: "web/index.mjs",
  styles: "web/styles.css",
};

/** The fixture plugin: four files, the real plugin's shape. `tag` changes the bytes. */
export function fixturePayload(
  root: string,
  tag = "v1",
  manifest: object = MANIFEST,
): InstallPayload {
  return payloadOf({
    preflight: fakePreflight(root),
    pluginDir: "pixso",
    files: {
      "plugin.json": JSON.stringify(manifest),
      "server/index.mjs": `export default "server ${tag}";\n`,
      "web/index.mjs": `export default "web ${tag}";\n`,
      "web/styles.css": `/* ${tag} */\n`,
    },
  });
}

/** The wrapper the installer writes (R/ru-code/installer/parts/30-core.sh:492-505), POSIX form, baking `node`. */
export function launcherText(node: string): string {
  const quoted = `'${node.replaceAll("'", "'\\''")}'`;
  return [
    "#!/bin/sh",
    `if [ -x ${quoted} ] || [ -f ${quoted} ]; then`,
    `  exec ${quoted} --experimental-sqlite --disable-warning=ExperimentalWarning "$(dirname "$0")/cli.js" "$@"`,
    "fi",
    `exec node --experimental-sqlite --disable-warning=ExperimentalWarning "$(dirname "$0")/cli.js" "$@"`,
    "",
  ].join("\n");
}

/**
 * A fake INSTALLED ru-code under `root`: `bin/cli.js` is a node script that records its argv (one
 * per line) into `<root>/launcher-argv.txt`, optionally dumps its environment as JSON to
 * `envFile`, and exits `exitCode` — it is what fg's restart RUNS (node directly, like the
 * installer). `bin/ru-code` is the installer's wrapper (never executed by fg), and
 * `bin/current.json` points at `versions/<v>/cli.js`.
 */
export function fakeRuCode(
  root: string,
  options: { exitCode?: number; version?: string; envFile?: string; node?: string } = {},
): void {
  const bin = join(root, "bin");
  const version = options.version ?? "0.0.40";
  mkdirSync(join(bin, "versions", version), { recursive: true });
  const fs = 'process.getBuiltinModule("node:fs")';
  writeFileSync(
    join(bin, "cli.js"),
    [
      `${fs}.writeFileSync(${JSON.stringify(join(root, "launcher-argv.txt"))}, process.argv.slice(2).join("\\n") + "\\n");`,
      `${fs}.writeFileSync(${JSON.stringify(join(root, "launcher-execargv.txt"))}, process.execArgv.join("\\n") + "\\n");`,
      options.envFile === undefined
        ? ""
        : `${fs}.writeFileSync(${JSON.stringify(options.envFile)}, JSON.stringify(process.env));`,
      `process.exitCode = ${options.exitCode ?? 0};`,
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(bin, "current.json"),
    JSON.stringify({ schema: 1, version, entry: `versions/${version}/cli.js` }),
  );
  const launcher = join(bin, "ru-code");
  writeFileSync(launcher, launcherText(options.node ?? process.execPath));
  chmodSync(launcher, 0o755);
}

/** Make ru-code ship its own copy of `id` in the pointed version — the shadow case. */
export function shipOwnCopy(root: string, id = "pixso", version = "0.0.40"): string {
  const dir = join(root, "bin", "versions", version, "plugins", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), "{}");
  return dir;
}

/** Write a `server-runtime.json` naming `pid`. */
export function runtimeState(root: string, pid: number): void {
  mkdirSync(join(root, "userdata"), { recursive: true });
  writeFileSync(
    join(root, "userdata", "server-runtime.json"),
    JSON.stringify({
      version: 1,
      pid,
      port: 7777,
      origin: "http://127.0.0.1:7777",
      startedAt: "2026-10-26T00:00:00Z",
    }),
  );
}

/** Every path under `dir`, sorted — a snapshot to prove a run wrote nothing. */
export function listTree(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true }).map(String).toSorted();
  } catch {
    return [];
  }
}

export interface Captured {
  readonly ctx: CommandContext;
  /** Everything the UI drew plus every bare stderr line, ANSI-free. */
  readonly err: () => string;
  readonly out: () => string;
}

/** A context whose UI is the REAL renderer writing plain text, so assertions read real output. */
export function context(
  options: {
    readonly lang?: Lang;
    readonly flags?: Readonly<Record<string, string | boolean | undefined>>;
    readonly source?: string;
    readonly verbose?: boolean;
    /** The context's `env` — default: a copy of `process.env` (what `run()` hands a command after `.env` + the PIXSO_* overlay). */
    readonly env?: Readonly<Record<string, string | undefined>>;
    /** The running bundle's directory (`setup`/`teardown` copy from / source the installer beside it). */
    readonly binDir?: string;
  } = {},
): Captured {
  const lang = options.lang ?? "ru";
  let err = "";
  let out = "";
  const ui = createUi({
    stream: { write: (chunk) => void (err += chunk), isTTY: false },
    lang,
    env: { NO_COLOR: "1" },
    version: "1.1.0",
    stdoutIsTTY: false,
  });
  const ctx: CommandContext = {
    cwd: tmpdir(),
    lang,
    env: options.env ?? { ...process.env },
    flags: options.flags ?? {},
    ...(options.source === undefined ? {} : { source: options.source }),
    ...(options.binDir === undefined ? {} : { binDir: options.binDir }),
    stdout: (s) => void (out += s),
    stderr: (s) => {
      if (!ui.ended()) err += s;
    },
    stdoutIsTTY: false,
    verbose: options.verbose ?? false,
    ui,
  };
  return { ctx, err: () => err, out: () => out };
}
