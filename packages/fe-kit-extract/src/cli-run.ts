import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { extractKit } from "./extract.ts";
import { DEFAULT_COMPILER_OPTIONS_DOC } from "./project.ts";
import { stableStringify } from "./serialize.ts";

export const USAGE = `fe-kit-extract <packages-dir> [options]

Extract the components and types of a React UI kit by static analysis. The kit is never
built, installed or rendered.

Options:
  --exclude <a,b>   Skip packages whose directory name or package name matches a glob
                    (\`*\` and \`?\`). Repeatable; comma-separated.
  -o, --out <file>  Write the JSON here. Without it the JSON goes to stdout.
  -h, --help        Show this message.

Compiler options: the kit's own tsconfig.json is used when one sits at the kit root or at
<packages-dir>. Otherwise the defaults are: ${DEFAULT_COMPILER_OPTIONS_DOC}.
`;

export interface ParsedArgs {
  packagesDir: string | null;
  exclude: string[];
  out: string | null;
  help: boolean;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { packagesDir: null, exclude: [], out: null, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "-h" || arg === "--help") {
      parsed.help = true;
      continue;
    }
    if (arg === "--exclude" || arg === "-e") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("--exclude needs a value");
      parsed.exclude.push(
        ...value
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part.length > 0),
      );
      index += 1;
      continue;
    }
    if (arg.startsWith("--exclude=")) {
      parsed.exclude.push(
        ...arg
          .slice("--exclude=".length)
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part.length > 0),
      );
      continue;
    }
    if (arg === "-o" || arg === "--out") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("-o needs a value");
      parsed.out = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      parsed.out = arg.slice("--out=".length);
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    if (parsed.packagesDir !== null) throw new Error(`unexpected extra argument: ${arg}`);
    parsed.packagesDir = arg;
  }

  return parsed;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Pure-ish entry point: returns what to print instead of printing, so tests can assert it. */
export function run(argv: readonly string[]): RunResult {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    return { code: 2, stdout: "", stderr: `${(error as Error).message}\n\n${USAGE}` };
  }

  if (parsed.help) return { code: 0, stdout: USAGE, stderr: "" };
  if (parsed.packagesDir === null)
    return { code: 2, stdout: "", stderr: `missing <packages-dir>\n\n${USAGE}` };

  let json: string;
  try {
    json = stableStringify(
      extractKit({ packagesDir: parsed.packagesDir, exclude: parsed.exclude }),
    );
  } catch (error) {
    return { code: 1, stdout: "", stderr: `${(error as Error).message}\n` };
  }

  if (parsed.out === null) return { code: 0, stdout: json, stderr: "" };

  const outPath = resolve(parsed.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json, "utf8");
  return { code: 0, stdout: `wrote ${outPath}\n`, stderr: "" };
}

export function main(argv: readonly string[] = process.argv.slice(2)): void {
  const result = run(argv);
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
