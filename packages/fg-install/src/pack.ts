/**
 * BUILD TIME ONLY: `vendor/ru-code/` → the `PackedPayload` the `fg` bundle embeds.
 *
 * Imported by `cli/tsdown.config.ts` (through this package's `./pack` export), never by the
 * runtime: nothing here ships in `fg.mjs`. The owner swaps `vendor/ru-code/` for another ru-code
 * build and rebuilds; no code changes. The build FAILS — this throws — when the vendor tree is
 * not what `fg install` needs:
 *
 *   vendor/ru-code/preflight.mjs            ru-code's install-time preflight
 *   vendor/ru-code/plugins/<id>/plugin.json  exactly ONE plugin folder, real files only
 *
 * EVERY file packed (the preflight and each plugin file) is first scanned with the repo's full
 * forbidden-string set (`./forbidden.ts`): a hit FAILS THE BUILD, naming the file and the literal
 * or pattern. The payload is embedded compressed, so this is the only place it can be checked.
 *
 * Every file is stored brotli-compressed (node:zlib) and base64-encoded, with the sha256 and size
 * of its ORIGINAL bytes, which `unpackPayload` re-checks at run time and the installer re-checks
 * after writing.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

import { PLUGIN_MANIFEST_FILENAME, PLUGINS_DIR_NAME } from "./constants.ts";
import { forbiddenIn } from "./forbidden.ts";
import { type PackedFile, type PackedPayload, sha256 } from "./payload.ts";

/** The preflight's file name inside `vendor/ru-code/` (= ru-code's PREFLIGHT_BASENAME, 10-head-config.sh:33). */
export const VENDOR_PREFLIGHT = "preflight.mjs";

/** A vendor tree that cannot be packed. The message is the whole diagnosis. */
export class VendorError extends Error {
  override readonly name = "VendorError";
}

/**
 * Refuse `bytes` when they carry anything of the forbidden set. `where` is what the message names
 * (the vendor-relative path). Bytes are read as latin1 so every ASCII needle matches whatever the
 * file's encoding, and a binary file cannot throw on decoding.
 */
function assertClean(where: string, bytes: Uint8Array): void {
  const hits = forbiddenIn(Buffer.from(bytes).toString("latin1"));
  if (hits.length > 0) {
    throw new VendorError(
      `forbidden content in ${where}: ${hits.join(", ")} — the vendor tree must not carry the leaked webhook / credential strings (packages/fg-install/src/forbidden.ts)`,
    );
  }
}

function packFile(path: string, bytes: Uint8Array): PackedFile {
  const compressed = brotliCompressSync(bytes, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  return { path, sha256: sha256(bytes), size: bytes.length, data: compressed.toString("base64") };
}

/** What every "missing" message ends with: how to fix it. */
const HINT = "copy ru-code's build into vendor/ru-code/ (docs/CONTRIBUTING.md)";

function read(path: string, what: string): Uint8Array {
  try {
    return new Uint8Array(readFileSync(path));
  } catch {
    throw new VendorError(`${what} is missing: ${path} — ${HINT}`);
  }
}

/** Every file under `dir`, sorted, as POSIX relative paths. Symlinks and specials are refused. */
function treeOf(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    const abs = join(entry.parentPath, entry.name);
    if (entry.isDirectory()) continue;
    if (!entry.isFile()) {
      throw new VendorError(`only regular files can be embedded, and this is not one: ${abs}`);
    }
    files.push(relative(dir, abs).split(sep).join("/"));
  }
  return files.toSorted();
}

/**
 * Pack `vendorDir` (normally `<repo>/vendor/ru-code`). Throws {@link VendorError} with a message
 * naming the missing or offending path.
 */
export function packVendor(vendorDir: string): PackedPayload {
  const preflight = read(join(vendorDir, VENDOR_PREFLIGHT), "ru-code preflight");
  assertClean(VENDOR_PREFLIGHT, preflight);

  const pluginsRoot = join(vendorDir, PLUGINS_DIR_NAME);
  let dirs: string[];
  try {
    dirs = readdirSync(pluginsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();
  } catch {
    throw new VendorError(
      `plugin folder is missing: ${join(pluginsRoot, "<id>", PLUGIN_MANIFEST_FILENAME)} — ${HINT}`,
    );
  }
  const [pluginDir, ...extra] = dirs;
  if (pluginDir === undefined) {
    throw new VendorError(
      `plugin folder is missing: ${join(pluginsRoot, "<id>", PLUGIN_MANIFEST_FILENAME)} — ${HINT}`,
    );
  }
  if (extra.length > 0) {
    throw new VendorError(
      `exactly one plugin folder is expected in ${pluginsRoot}, found: ${dirs.join(", ")}`,
    );
  }
  const pluginRoot = join(pluginsRoot, pluginDir);
  read(join(pluginRoot, PLUGIN_MANIFEST_FILENAME), "plugin manifest");

  return {
    format: 1,
    preflight: packFile(VENDOR_PREFLIGHT, preflight),
    pluginDir,
    files: treeOf(pluginRoot).map((path) => {
      const bytes = read(join(pluginRoot, ...path.split("/")), "plugin file");
      assertClean(`${PLUGINS_DIR_NAME}/${pluginDir}/${path}`, bytes);
      return packFile(path, bytes);
    }),
  };
}
