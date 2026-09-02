import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { compareStrings } from "@smart-tools/fe-analyzer-engine";

/** Writes `value` as pretty-printed JSON, creating parent directories as needed. */
export const writeJsonFile = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

/** Immediate child directory names of `directory`, sorted; `[]` when the path is missing. */
export const listDirectories = async (directory: string): Promise<string[]> => {
  if (!existsSync(directory)) {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareStrings);
};

/** Immediate child file names of `directory`, sorted; `[]` when the path is missing. */
export const listFiles = async (directory: string): Promise<string[]> => {
  if (!existsSync(directory)) {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort(compareStrings);
};

/** Recursively counts files under `directory`; `0` when the path is missing. */
export const countFilesRecursively = async (directory: string): Promise<number> => {
  if (!existsSync(directory)) {
    return 0;
  }

  const entries = await readdir(directory, { withFileTypes: true });
  let total = 0;

  for (const entry of entries) {
    if (entry.isDirectory()) {
      total += await countFilesRecursively(join(directory, entry.name));
    } else if (entry.isFile()) {
      total += 1;
    }
  }

  return total;
};

/** Returns the first path in `candidates` that exists on disk, or `null`. */
export const firstExisting = (candidates: readonly string[]): string | null =>
  candidates.find((candidate) => existsSync(candidate)) ?? null;
