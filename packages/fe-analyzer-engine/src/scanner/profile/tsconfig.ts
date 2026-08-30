import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { ts } from "ts-morph";

import type { Alias, Limitation, TsconfigInfo } from "../../domain/profile.ts";
import { toPosix, toProjectPath } from "../../shared/path.ts";
import { compareStrings } from "../../shared/sort.ts";

/**
 * TypeScript configuration discovery. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/scanner/profile/tsconfig.ts:1-210`.
 *
 * A project may have one `tsconfig.json` or fifteen. Monorepos routinely put a base config
 * at the root, a per-app config next to each app, and a `tsconfig.node.json` for build
 * tooling. Each file in the project is governed by the nearest config above it, and `paths`
 * from the wrong config resolves imports to the wrong files.
 *
 * Configs are read through `ts.parseConfigFileTextToJson` rather than `JSON.parse`:
 * `tsconfig.json` is JSONC, and comments in it are the norm, not an edge case.
 */

export interface TsconfigScan {
  readonly configs: TsconfigInfo[];
  readonly aliases: Alias[];
  readonly limitations: Limitation[];
}

interface ResolvedConfig {
  readonly baseUrl: string | null;
  readonly paths: Readonly<Record<string, string[]>>;
  readonly extendsChain: string[];
}

const CONFIG_NAMES = new Set(["tsconfig.json", "jsconfig.json"]);

/** `true` for a file name this module knows how to read. */
export const isTsconfigFile = (fileName: string): boolean => CONFIG_NAMES.has(fileName);

const parseJsonc = (filePath: string): Record<string, unknown> | null => {
  const result = ts.parseConfigFileTextToJson(filePath, readFileSync(filePath, "utf8"));

  if (result.error !== undefined) {
    return null;
  }

  // TypeScript types the parsed document as `any`; narrow it before anything reads it.
  const config: unknown = result.config;

  return typeof config === "object" && config !== null ? (config as Record<string, unknown>) : null;
};

/**
 * Resolves an `extends` value to a file path.
 *
 * Relative forms are resolved against the extending config. Bare specifiers point into
 * `node_modules`, which may not be installed — that is a recorded limitation, not a failure,
 * because a missing base config only costs us some `paths` entries.
 */
const resolveExtends = (specifier: string, fromDirectory: string): string | null => {
  const candidates = specifier.startsWith(".")
    ? [resolve(fromDirectory, specifier), resolve(fromDirectory, `${specifier}.json`)]
    : isAbsolute(specifier)
      ? [specifier]
      : [
          join(fromDirectory, "node_modules", specifier),
          join(fromDirectory, "node_modules", `${specifier}.json`),
          join(fromDirectory, "node_modules", specifier, "tsconfig.json"),
        ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
};

const asPathsRecord = (value: unknown): Record<string, string[]> => {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const result: Record<string, string[]> = {};
  for (const [pattern, targets] of Object.entries(value)) {
    if (Array.isArray(targets)) {
      const strings = targets.filter((entry): entry is string => typeof entry === "string");
      if (strings.length > 0) {
        result[pattern] = strings;
      }
    }
  }

  return result;
};

/**
 * Reads a config and everything it extends, innermost first.
 *
 * `extends` may be an array (TypeScript 5.0+). Later entries win, and the extending file
 * wins over all of them, which is why the chain is folded in order and the local options are
 * applied last.
 */
const resolveConfig = (
  configPath: string,
  limitations: Limitation[],
  root: string,
  seen: ReadonlySet<string> = new Set(),
): ResolvedConfig => {
  if (seen.has(configPath)) {
    // Circular `extends`. TypeScript itself rejects this; we stop rather than loop.
    return { baseUrl: null, paths: {}, extendsChain: [] };
  }

  const config = parseJsonc(configPath);
  if (!config) {
    limitations.push({
      file: toProjectPath(root, configPath),
      line: null,
      reason: "unreadable-config",
      detail: "tsconfig is not valid JSONC",
    });
    return { baseUrl: null, paths: {}, extendsChain: [] };
  }

  const directory = dirname(configPath);
  const rawExtends = config["extends"];
  const parents =
    typeof rawExtends === "string" ? [rawExtends] : Array.isArray(rawExtends) ? rawExtends : [];

  let baseUrl: string | null = null;
  let paths: Record<string, string[]> = {};
  const extendsChain: string[] = [];
  const nextSeen = new Set([...seen, configPath]);

  for (const parent of parents) {
    if (typeof parent !== "string") {
      continue;
    }

    const parentPath = resolveExtends(parent, directory);
    if (!parentPath) {
      limitations.push({
        file: toProjectPath(root, configPath),
        line: null,
        reason: "unreadable-config",
        detail: `extends "${parent}" could not be resolved; its paths are unavailable`,
      });
      continue;
    }

    const inherited = resolveConfig(parentPath, limitations, root, nextSeen);
    extendsChain.push(toProjectPath(root, parentPath), ...inherited.extendsChain);
    // A relative `baseUrl` is relative to the config that declares it.
    baseUrl = inherited.baseUrl ?? baseUrl;
    paths = { ...paths, ...inherited.paths };
  }

  const compilerOptions = config["compilerOptions"];
  if (typeof compilerOptions === "object" && compilerOptions !== null) {
    const options = compilerOptions as Record<string, unknown>;
    if (typeof options["baseUrl"] === "string") {
      baseUrl = resolve(directory, options["baseUrl"]);
    }
    paths = { ...paths, ...asPathsRecord(options["paths"]) };
  }

  return { baseUrl, paths, extendsChain };
};

/**
 * Builds the config inventory and the aliases implied by it.
 *
 * `paths` targets are resolved against `baseUrl` when there is one and against the config
 * directory otherwise, which is what TypeScript does.
 */
export const scanTsconfigs = (root: string, configPaths: readonly string[]): TsconfigScan => {
  const limitations: Limitation[] = [];
  const configs: TsconfigInfo[] = [];
  const aliasesByPattern = new Map<string, Alias>();

  const ordered = [...configPaths].sort(compareStrings);

  for (const configPath of ordered) {
    const resolved = resolveConfig(configPath, limitations, root);
    const directory = dirname(configPath);

    configs.push({
      path: toProjectPath(root, configPath),
      directory: toProjectPath(root, directory),
      baseUrl: resolved.baseUrl === null ? null : toProjectPath(root, resolved.baseUrl),
      extendsChain: resolved.extendsChain,
    });

    for (const [pattern, targets] of Object.entries(resolved.paths)) {
      // The first config to define a pattern wins. Configs are visited in sorted path order,
      // so the shallowest — the one governing the most files — comes first.
      if (aliasesByPattern.has(pattern)) {
        continue;
      }

      aliasesByPattern.set(pattern, {
        pattern,
        resolvesTo: targets.map((target) =>
          toPosix(toProjectPath(root, resolve(resolved.baseUrl ?? directory, target))),
        ),
        source: "tsconfig",
      });
    }
  }

  return {
    configs,
    aliases: [...aliasesByPattern.values()].sort((left, right) =>
      compareStrings(left.pattern, right.pattern),
    ),
    limitations,
  };
};
