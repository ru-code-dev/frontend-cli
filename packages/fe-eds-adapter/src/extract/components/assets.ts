import { join } from "node:path";

import type { ComponentAssetsDto } from "../domain/components.ts";
import { countFilesRecursively, listDirectories, listFiles } from "../shared/fs.ts";
import { compareStrings } from "@smart-tools/fe-analyzer-engine";

/**
 * Inventory of the documentation and test assets that ship alongside a component.
 *
 * These matter beyond bookkeeping:
 *
 *  - `stories` and `examples` are *verified-correct usage samples*. They make an
 *    excellent calibration corpus: a deviation detector that fires on the kit's own
 *    stories has a false-positive problem, and that can be asserted automatically.
 *  - `e2eSnapshots` counts Playwright visual-regression PNGs, which indicates how
 *    tightly a component's rendering is pinned — and therefore how confidently a
 *    consumer override of it can be called a deviation.
 */

const STORY_PATTERN = /\.stories\.tsx?$/;
const DOC_PATTERN = /\.mdx$/i;
const TEST_PATTERN = /\.(test|spec|e2e)\.tsx?$/;

const TESTS_DIRECTORY = "__tests__";
const EXAMPLES_DIRECTORY = "examples";
const SNAPSHOT_DIRECTORY_SUFFIX = "-snapshots";

/** Recursively collects file names matching `pattern`, one directory level deep plus `__tests__`. */
const collectMatching = async (directory: string, pattern: RegExp): Promise<string[]> => {
  const files = await listFiles(directory);
  return files.filter((file) => pattern.test(file));
};

const countSnapshots = async (testsDirectory: string): Promise<number> => {
  const entries = await listFiles(testsDirectory);
  const inline = entries.filter((entry) => entry.endsWith(".png")).length;

  // Playwright stores screenshots in sibling `<spec>-snapshots/` directories.
  const snapshotDirs = (await listDirectories(testsDirectory)).filter((name) =>
    name.endsWith(SNAPSHOT_DIRECTORY_SUFFIX),
  );

  let total = inline;
  for (const dir of snapshotDirs) {
    total += await countFilesRecursively(join(testsDirectory, dir));
  }

  return total;
};

/** Builds the asset inventory for one component directory. */
export const collectComponentAssets = async (
  componentDirectory: string,
): Promise<ComponentAssetsDto> => {
  const testsDirectory = join(componentDirectory, TESTS_DIRECTORY);

  const [stories, docs, rootTests, nestedTests] = await Promise.all([
    collectMatching(componentDirectory, STORY_PATTERN),
    collectMatching(componentDirectory, DOC_PATTERN),
    collectMatching(componentDirectory, TEST_PATTERN),
    collectMatching(testsDirectory, TEST_PATTERN),
  ]);

  const [e2eSnapshots, examples] = await Promise.all([
    countSnapshots(testsDirectory),
    countFilesRecursively(join(componentDirectory, EXAMPLES_DIRECTORY)),
  ]);

  return {
    stories,
    docs,
    testFiles: [...rootTests, ...nestedTests.map((name) => `${TESTS_DIRECTORY}/${name}`)].sort(
      (a, b) => compareStrings(a, b),
    ),
    e2eSnapshots,
    examples,
  };
};
