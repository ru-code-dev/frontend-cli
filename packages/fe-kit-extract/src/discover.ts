import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** A package found under the kit's packages directory, before any TypeScript work happens. */
export interface DiscoveredPackage {
  /** Absolute directory. */
  dir: string;
  /** Directory basename — the other thing `--exclude` globs are matched against. */
  dirName: string;
  /** `name` from `package.json`, falling back to the directory basename. */
  name: string;
  version: string;
  /** Absolute path of `src/index.ts`, then root `index.ts`, else `null`. */
  entry: string | null;
  /** Why no entry was found — only set when `entry` is `null`. */
  entryProblem: string | null;
}

export interface DiscoveredKit {
  /**
   * The directory every path in the report is relative to. It is the parent of
   * `<packages-dir>` when that parent carries a `package.json` (the usual monorepo shape),
   * otherwise `<packages-dir>` itself.
   */
  kitRoot: string;
  packagesDir: string;
  name: string;
  version: string;
  packages: DiscoveredPackage[];
  /** Packages skipped by `--exclude`, for the log. */
  excluded: string[];
}

/**
 * `*` and `?` only — the two wildcards a kit maintainer actually types on a command line.
 * Anchored, so `ui-*` does not match `legacy-ui-core`.
 */
export function globToRegExp(pattern: string): RegExp {
  let out = "^";
  for (const ch of pattern) {
    if (ch === "*") out += "[^/]*";
    else if (ch === "?") out += "[^/]";
    else out += ch.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  }
  return new RegExp(`${out}$`, "u");
}

export function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((re) => re.test(value));
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringField(json: Record<string, unknown> | null, key: string): string | null {
  const value = json?.[key];
  return typeof value === "string" ? value : null;
}

function resolveEntry(dir: string): { entry: string | null; problem: string | null } {
  const srcIndex = join(dir, "src", "index.ts");
  if (existsSync(srcIndex)) return { entry: srcIndex, problem: null };
  const srcIndexTsx = join(dir, "src", "index.tsx");
  if (existsSync(srcIndexTsx)) return { entry: srcIndexTsx, problem: null };
  const rootIndex = join(dir, "index.ts");
  if (existsSync(rootIndex)) return { entry: rootIndex, problem: null };
  const rootIndexTsx = join(dir, "index.tsx");
  if (existsSync(rootIndexTsx)) return { entry: rootIndexTsx, problem: null };
  return {
    entry: null,
    problem: "no entry file: none of src/index.ts, src/index.tsx, index.ts, index.tsx exists",
  };
}

/**
 * Enumerate the kit. Pure filesystem work — nothing here parses TypeScript, so a kit that does
 * not compile is still enumerated (its packages simply land in `unresolved` later).
 */
export function discoverKit(
  packagesDirInput: string,
  exclude: readonly string[] = [],
): DiscoveredKit {
  const packagesDir = resolve(packagesDirInput);
  if (!existsSync(packagesDir) || !statSync(packagesDir).isDirectory()) {
    throw new Error(`packages directory not found: ${packagesDir}`);
  }

  const parent = dirname(packagesDir);
  const kitRoot = existsSync(join(parent, "package.json")) ? parent : packagesDir;
  const kitJson = readJson(join(kitRoot, "package.json"));

  const patterns = exclude.filter((p) => p.length > 0).map(globToRegExp);
  const packages: DiscoveredPackage[] = [];
  const excluded: string[] = [];

  for (const dirName of readdirSync(packagesDir).sort()) {
    const dir = join(packagesDir, dirName);
    if (dirName === "node_modules" || dirName.startsWith(".")) continue;
    if (!statSync(dir).isDirectory()) continue;

    const pkgJson = readJson(join(dir, "package.json"));
    const name = stringField(pkgJson, "name") ?? dirName;

    if (matchesAny(dirName, patterns) || matchesAny(name, patterns)) {
      excluded.push(name);
      continue;
    }

    const { entry, problem } = resolveEntry(dir);
    packages.push({
      dir,
      dirName,
      name,
      version: stringField(pkgJson, "version") ?? "0.0.0",
      entry,
      entryProblem: problem,
    });
  }

  packages.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return {
    kitRoot,
    packagesDir,
    name: stringField(kitJson, "name") ?? basename(kitRoot),
    version: stringField(kitJson, "version") ?? "0.0.0",
    packages,
    excluded: excluded.sort(),
  };
}
