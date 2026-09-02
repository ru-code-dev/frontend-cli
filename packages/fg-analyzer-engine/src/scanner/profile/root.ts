import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

import type { PackageManager } from "../../domain/profile.ts";
import { toProjectPath } from "../../shared/path.ts";

/**
 * Locating the project. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/scanner/profile/root.ts:1-172`, except that
 * `PackageManifest.dependencies` is kept for the manifest's own sake and no longer read for
 * a kit version (the field this engine dropped — see `domain/profile.ts`).
 *
 * The scanner is handed a path and nothing else. It may be a single file, a feature folder,
 * a repository root, or nothing at all. Everything downstream needs an anchor to make paths
 * relative to, and getting that anchor wrong silently corrupts every finding coordinate — so
 * this module does one thing and reports what it found.
 */

export interface ProjectLocation {
  /** Absolute project root. */
  readonly root: string;
  /** Absolute path that was requested. */
  readonly target: string;
  /** `target` relative to `root`; `''` when they are the same. */
  readonly scope: string;
  /** `true` when `target` is a single file rather than a directory. */
  readonly targetIsFile: boolean;
}

export interface PackageManifest {
  readonly name: string | null;
  readonly workspaces: string[];
  readonly dependencies: Readonly<Record<string, string>>;
}

const ROOT_MARKERS = ["package.json", ".git"];

/**
 * Walks up from `startDirectory` to the first directory holding a root marker.
 *
 * `package.json` wins over `.git` at the same level, and both are searched in the same
 * upward pass so that a package inside a git repository anchors on the package. When nothing
 * is found the start directory itself is the root — a loose folder of components is still
 * something we can analyse.
 */
export const findProjectRoot = (startDirectory: string): string => {
  const stop = parse(startDirectory).root;
  let current = resolve(startDirectory);

  while (true) {
    for (const marker of ROOT_MARKERS) {
      if (existsSync(join(current, marker))) {
        return current;
      }
    }

    if (current === stop) {
      return resolve(startDirectory);
    }

    current = dirname(current);
  }
};

/** Resolves the requested path into a root, a scope and a target kind. */
export const locateProject = (requestedPath: string): ProjectLocation => {
  const target = resolve(requestedPath);

  if (!existsSync(target)) {
    throw new Error(`Path does not exist: ${target}`);
  }

  const targetIsFile = statSync(target).isFile();
  const root = findProjectRoot(targetIsFile ? dirname(target) : target);

  return { root, target, scope: toProjectPath(root, target), targetIsFile };
};

const readJsonFile = (filePath: string): Record<string, unknown> | null => {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/** `value` as a list of strings, or `null` when it is not an array of them. */
const asStringArray = (value: unknown): string[] | null =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : null;

/** One property off an unknown value, without asserting anything about the whole. */
const readProperty = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

const asStringRecord = (value: unknown): Record<string, string> => {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      result[key] = entry;
    }
  }

  return result;
};

/**
 * Reads `package.json` at `root`.
 *
 * Absence is normal — a folder of `.tsx` files is a legitimate target — so this returns an
 * empty manifest rather than throwing.
 */
export const readPackageManifest = (root: string): PackageManifest => {
  const manifest = readJsonFile(join(root, "package.json"));

  if (!manifest) {
    return { name: null, workspaces: [], dependencies: {} };
  }

  return {
    name: typeof manifest["name"] === "string" ? manifest["name"] : null,
    // npm and pnpm spell this as an array; classic yarn nests it under `packages`.
    workspaces:
      asStringArray(manifest["workspaces"]) ??
      asStringArray(readProperty(manifest["workspaces"], "packages")) ??
      [],
    dependencies: {
      ...asStringRecord(manifest["dependencies"]),
      ...asStringRecord(manifest["devDependencies"]),
      ...asStringRecord(manifest["peerDependencies"]),
    },
  };
};

const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

/** Package manager implied by the lockfile at `root`. */
export const detectPackageManager = (root: string): PackageManager =>
  LOCKFILES.find(([lockfile]) => existsSync(join(root, lockfile)))?.[1] ?? "unknown";

/**
 * Workspace globs declared at `root`, from either `package.json` or `pnpm-workspace.yaml`.
 *
 * The pnpm file is read with a narrow regex rather than a YAML parser: the only shape that
 * matters is a flat list of quoted globs, and adding a YAML dependency to read four lines
 * would be a poor trade.
 */
export const detectWorkspaces = (root: string, manifest: PackageManifest): string[] => {
  if (manifest.workspaces.length > 0) {
    return manifest.workspaces;
  }

  const pnpmWorkspace = join(root, "pnpm-workspace.yaml");
  if (!existsSync(pnpmWorkspace)) {
    return [];
  }

  try {
    const content = readFileSync(pnpmWorkspace, "utf8");
    return [...content.matchAll(/^\s*-\s*['"]?([^'"\n]+?)['"]?\s*$/gm)]
      .map((match) => match[1] ?? "")
      .filter(Boolean);
  } catch {
    return [];
  }
};
