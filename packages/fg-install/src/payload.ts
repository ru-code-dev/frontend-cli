/**
 * THE PAYLOAD — what `fg install` carries: ru-code's preflight and ONE plugin folder, byte-exact.
 *
 * Two shapes. `PackedPayload` is what the build embeds into `fg.mjs` (brotli + base64 per file,
 * with the sha256 and size of the ORIGINAL bytes); `InstallPayload` is what the install logic
 * works on. Every command takes an `InstallPayload` as an injected value, so the tier-1 suite
 * never needs `vendor/` — it builds small fixture payloads with {@link payloadOf}.
 */
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { brotliDecompressSync } from "node:zlib";

import {
  PLUGIN_API_VERSION,
  PLUGIN_ID_PATTERN,
  PLUGIN_MANIFEST_FILENAME,
  PLUGIN_MANIFEST_PATH_FIELDS,
} from "./constants.ts";

/** One file of the plugin folder: a POSIX path relative to the folder, and its bytes. */
export interface PayloadFile {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export interface InstallPayload {
  /** ru-code's install-time preflight, verbatim. */
  readonly preflight: Uint8Array;
  /** The folder name the plugin had in `vendor/ru-code/plugins/` — must equal the manifest id. */
  readonly pluginDir: string;
  /** Sorted by path. */
  readonly files: readonly PayloadFile[];
}

/** One file as embedded: base64 of the brotli-compressed bytes, plus facts about the original. */
export interface PackedFile {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
  readonly data: string;
}

/** The embedded form. `format` is bumped if the shape ever changes. */
export interface PackedPayload {
  readonly format: 1;
  readonly preflight: PackedFile;
  readonly pluginDir: string;
  readonly files: readonly PackedFile[];
}

/** Lowercase hex sha256. */
export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const bytesOf = (value: Uint8Array | string): Uint8Array =>
  typeof value === "string" ? new TextEncoder().encode(value) : value;

/** Build an `InstallPayload` from raw bytes — the test seam, and what {@link unpackPayload} returns. */
export function payloadOf(input: {
  readonly preflight: Uint8Array | string;
  readonly pluginDir: string;
  readonly files: Readonly<Record<string, Uint8Array | string>>;
}): InstallPayload {
  return {
    preflight: bytesOf(input.preflight),
    pluginDir: input.pluginDir,
    files: Object.entries(input.files)
      .map(([path, value]) => {
        const bytes = bytesOf(value);
        return { path, bytes, sha256: sha256(bytes) };
      })
      .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
}

/** Decompress one packed file and prove it is the file that was packed. */
function unpackFile(file: PackedFile): Uint8Array {
  const bytes = new Uint8Array(brotliDecompressSync(Buffer.from(file.data, "base64")));
  if (bytes.length !== file.size || sha256(bytes) !== file.sha256) {
    throw new Error(`embedded payload is corrupt: ${file.path} does not match its recorded sha256`);
  }
  return bytes;
}

/** The embedded form → the working form, verifying every file's size and sha256. */
export function unpackPayload(packed: PackedPayload): InstallPayload {
  if (packed.format !== 1)
    throw new Error(`unknown embedded payload format ${String(packed.format)}`);
  return {
    preflight: unpackFile(packed.preflight),
    pluginDir: packed.pluginDir,
    files: packed.files.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      bytes: unpackFile(file),
    })),
  };
}

const fail = (problem: ManifestProblem) => ({ ok: false as const, problem });

/** The manifest facts the commands print. */
export interface PluginManifestFacts {
  readonly id: string;
  readonly version: string;
}

/** Why the embedded plugin cannot be installed — one machine-readable reason each. */
export type ManifestProblem =
  | { readonly kind: "missing" }
  | { readonly kind: "json"; readonly detail: string }
  | { readonly kind: "id"; readonly id: string }
  | { readonly kind: "folder"; readonly id: string; readonly folder: string }
  | { readonly kind: "api"; readonly apiVersion: string }
  | { readonly kind: "version" }
  | { readonly kind: "entry"; readonly field: string; readonly value: string };

/**
 * The checks ru-code's loader applies before it will load a folder, run against the payload
 * BEFORE anything is written — so fg never installs something the host would skip:
 *
 *  - `plugin.json` exists and is a JSON object (R/apps/server/src/ru-code/plugins/manifest.ts:152-157);
 *  - `id` matches `PLUGIN_ID_PATTERN` (P/packages/plugin-sdk/src/contracts/manifest.ts:35);
 *  - `id` equals the folder name (manifest.ts:160-164);
 *  - `apiVersion === 2` (manifest.ts:166-170, sdk manifest.ts:27,283-284);
 *  - `version` is a non-empty string (sdk manifest.ts schema);
 *  - each of `server`/`web`/`styles`, when present, is relative, NUL-free, `..`-free and names a
 *    file in the payload (manifest.ts:56,72-81,180-197).
 *
 * The `shared` major check (manifest.ts:172-178) depends on the HOST's versions, which fg cannot
 * know without running ru-code; it is not repeated here.
 */
export function validateManifest(
  payload: InstallPayload,
):
  | { readonly ok: true; readonly manifest: PluginManifestFacts }
  | { readonly ok: false; readonly problem: ManifestProblem } {
  const file = payload.files.find((f) => f.path === PLUGIN_MANIFEST_FILENAME);
  if (file === undefined) return fail({ kind: "missing" });

  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder().decode(file.bytes));
  } catch (error) {
    return fail({ kind: "json", detail: error instanceof Error ? error.message : String(error) });
  }
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return fail({ kind: "json", detail: "not an object" });
  }
  const fields = manifest as Record<string, unknown>;

  const id = fields["id"];
  if (typeof id !== "string" || !PLUGIN_ID_PATTERN.test(id)) {
    return fail({ kind: "id", id: String(id) });
  }
  if (id !== payload.pluginDir) return fail({ kind: "folder", id, folder: payload.pluginDir });
  if (fields["apiVersion"] !== PLUGIN_API_VERSION) {
    return fail({ kind: "api", apiVersion: String(fields["apiVersion"]) });
  }
  const version = fields["version"];
  if (typeof version !== "string" || version === "") return fail({ kind: "version" });

  const paths = new Set(payload.files.map((f) => f.path));
  for (const field of PLUGIN_MANIFEST_PATH_FIELDS) {
    const value = fields[field];
    if (value === undefined) continue;
    const normal = typeof value === "string" ? containedRelative(value) : undefined;
    if (normal === undefined || !paths.has(normal)) {
      return fail({ kind: "entry", field, value: String(value) });
    }
  }
  return { ok: true, manifest: { id, version } };
}

/**
 * `validatePluginRelativePath` (manifest.ts:72-81) plus the resolved-path containment
 * (manifest.ts:186-192): the normalised POSIX path inside the folder, or `undefined`.
 */
function containedRelative(value: string): string | undefined {
  if (value === "" || value.includes("\0")) return undefined;
  if (value.startsWith("/") || value.startsWith("\\") || /^[a-zA-Z]:/.test(value)) return undefined;
  if (value.split(/[/\\]+/).includes("..")) return undefined;
  const normal = posix.normalize(value.replaceAll("\\", "/"));
  return normal === "." || normal.startsWith("../") ? undefined : normal;
}
