/**
 * WHERE THINGS ARE, given the root ru-code's preflight reported — names inside `OUR_ROOT`, never
 * a rule for finding it (owner decision, brief a1 §3).
 */
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  APP_COMMAND,
  BIN_DIR_NAME,
  ENTRY_JS,
  PLUGINS_DIR_NAME,
  POINTER_JSON,
  POINTER_SCHEMA,
  SERVER_RUNTIME_FILE,
  STATE_DIR_NAME,
  WORK_DIR_NAME,
} from "./constants.ts";

export interface Layout {
  readonly root: string;
  readonly binDir: string;
  /** `<bin>/cli.js` — present ⇔ ru-code is installed. */
  readonly cliJs: string;
  /** `<bin>/ru-code` — the launcher a user types. */
  readonly launcher: string;
  readonly pluginsDir: string;
  /** `<OUR_ROOT>/.fg-install` — fg's own scratch (lock, stage, backup); never inside `<plugins>/`. */
  readonly workDir: string;
  /** `<plugins>/<id>` — THE folder fg writes, and the only one. */
  readonly target: string;
  readonly stateDir: string;
  /** `<stateDir>/plugins/<id>` — the plugin's data; fg never touches it. */
  readonly dataDir: string;
  readonly runtimeState: string;
}

/** `OUR_ROOT` + the manifest id → every path the commands use. Pure. */
export function layoutOf(ourRoot: string, id: string): Layout {
  const root = resolve(ourRoot);
  const binDir = join(root, BIN_DIR_NAME);
  const pluginsDir = join(root, PLUGINS_DIR_NAME);
  const stateDir = join(root, STATE_DIR_NAME);
  return {
    root,
    binDir,
    cliJs: join(binDir, ENTRY_JS),
    launcher: join(binDir, APP_COMMAND),
    pluginsDir,
    workDir: join(root, WORK_DIR_NAME),
    target: join(pluginsDir, id),
    stateDir,
    // `<stateDir>/plugins/<id>` (R/apps/server/src/ru-code/plugins/paths.ts:177-194).
    dataDir: join(stateDir, PLUGINS_DIR_NAME, id),
    runtimeState: join(stateDir, SERVER_RUNTIME_FILE),
  };
}

/** `true` when `path` is a regular file (following links, like the installer's `[ -f ]`). */
export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** `true` when `path` is a directory (following links). */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** `<bin>/current.json` — which installed version boots, and its bundle. */
export interface Pointer {
  readonly version: string;
  readonly entry: string;
}

/**
 * THE ONE READER OF `<bin>/current.json`. ru-code writes `{ schema: 1, version, entry }` there
 * (R/apps/server/src/ru-code/auto-update/apply/pointer.ts:17-22,62-85; a fresh layout in
 * wrapper/installLayout.ts:105-111; the installer copies the bundle's own pointer into `<bin>`,
 * R/ru-code/installer/parts/30-core.sh:443-480). Validated the way the frozen wrapper validates it
 * (wrapperSource.ts:170-175): `undefined` when absent, unreadable or not that shape.
 */
export async function pointerOf(layout: Layout): Promise<Pointer | undefined> {
  let pointer: unknown;
  try {
    pointer = JSON.parse(await readFile(join(layout.binDir, POINTER_JSON), "utf8"));
  } catch {
    return undefined;
  }
  if (pointer === null || typeof pointer !== "object") return undefined;
  const { schema, version, entry } = pointer as Record<string, unknown>;
  if (schema !== POINTER_SCHEMA) return undefined;
  if (typeof version !== "string" || version === "") return undefined;
  if (typeof entry !== "string" || entry === "") return undefined;
  return { version, entry };
}

/** Is our copy shadowed by one ru-code ships itself? */
export type Shadow =
  | { readonly kind: "shadowed"; readonly shippedDir: string; readonly version: string }
  | { readonly kind: "clear"; readonly shippedDir: string; readonly version: string }
  /** No readable pointer: ru-code is not installed, or its `current.json` is broken. */
  | { readonly kind: "unknown" };

/**
 * THE SHADOW RULE. ru-code scans its SHIPPED root before the user root and, on an id collision,
 * the shipped copy wins and ours is skipped with a log line (R/apps/server/src/ru-code/plugins/PluginHost.ts:773-813).
 * The shipped root is `plugins/` beside the running server bundle (paths.ts:107-110), and the
 * bundle is the pointer's entry: the frozen launcher reads `<bin>/current.json` and imports
 * `path.resolve(<bin>, entry)` (wrapperSource.ts:170-175,202-210,261). So the shipped copy of
 * `id` is `dirname(<bin>/<entry>)/plugins/<id>`, and it counts when it is a directory (a scanned
 * entry must be one: scan.ts:86-87).
 *
 * The pointer is validated the way the wrapper validates it ({@link pointerOf}); when it does not
 * validate, the wrapper falls back to the newest `versions/<v>` — fg does not re-implement that
 * fallback and answers `unknown` instead.
 */
export async function shadowOf(layout: Layout, id: string): Promise<Shadow> {
  const pointer = await pointerOf(layout);
  if (pointer === undefined) return { kind: "unknown" };
  const { version, entry } = pointer;
  const shippedDir = join(dirname(resolve(layout.binDir, entry)), PLUGINS_DIR_NAME, id);
  return (await isDirectory(shippedDir))
    ? { kind: "shadowed", shippedDir, version }
    : { kind: "clear", shippedDir, version };
}
