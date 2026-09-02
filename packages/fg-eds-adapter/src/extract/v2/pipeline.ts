/**
 * The EDS 2.x pipeline — the same five artifacts, the same order, a different checkout.
 *
 * `extract/pipeline.ts` states the graph once and this file does not restate it: tokens and
 * icons are independent, components feeds kit-a11y, and both feed kit-signatures. What changes
 * is which extractor sits at each node, and that is the whole of the "adding a third profile"
 * cost the package README describes — one `KitProfile`, one path builder and one pipeline
 * function, with every shared helper reused.
 *
 * NOTHING IS INSTALLED. EDS 2.x wraps no upstream (S1 break V10), so the `npm install` step the
 * v1 pipeline can take has no counterpart here — which also means `--pkit eds2` works with no
 * network beyond the clone.
 */
import { readFile } from "node:fs/promises";

import type { KitCorpus } from "../pipeline.ts";
import { isPlainRecord } from "../shared/object.ts";

import { extractComponentsV2, V2_PACKAGES } from "./components.ts";
import { extractIconsV2 } from "./icons.ts";
import { extractKitA11yV2 } from "./kit-a11y.ts";
import { resolveKitPathsV2, type KitPathsV2 } from "./paths.ts";
import { extractTokensV2 } from "./tokens.ts";

import { extractKnowledge } from "../kit-knowledge/extract.ts";
import type { KitPaths } from "../paths.ts";

/** The kit's own version — `packages/base/package.json` (S1 break V11). */
export const readKitVersionV2 = async (uiKitRoot: string): Promise<string | null> => {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(resolveKitPathsV2(uiKitRoot).basePackageJson, "utf8"),
    );
    return isPlainRecord(parsed) && typeof parsed["version"] === "string"
      ? parsed["version"]
      : null;
  } catch {
    return null;
  }
};

export interface ExtractCorpusV2Options {
  readonly paths: KitPathsV2;
  readonly onStage?: ((stage: keyof KitCorpus) => void) | undefined;
}

export const extractCorpusV2 = async (options: ExtractCorpusV2Options): Promise<KitCorpus> => {
  const { paths } = options;
  const announce = options.onStage ?? ((): void => {});

  announce("tokens");
  const tokens = await extractTokensV2(paths);

  announce("components");
  const components = await extractComponentsV2(paths);

  announce("kit-a11y");
  const kitA11y = extractKitA11yV2({ paths, components });

  announce("kit-icons");
  const kitIcons = extractIconsV2(paths);

  announce("kit-signatures");
  // `extractKnowledge` takes a `KitPaths` for two reads only — the examples directory (off
  // `uiKitRoot`) and the default component directory, which `componentsDirs` overrides here.
  const knowledgePaths: KitPaths = {
    uiKitRoot: paths.uiKitRoot,
    themeSrcDir: paths.themeDir,
    themePackageJson: paths.basePackageJson,
    baseSrcDir: paths.baseSrcDir,
    componentsDir: paths.baseComponentsDir,
    componentsBarrel: paths.baseComponentsBarrel,
    baseBarrel: paths.baseBarrel,
    upstreamDir: null,
  };
  const knowledge = extractKnowledge({
    paths: knowledgePaths,
    components,
    a11y: kitA11y,
    componentsDirs: [paths.baseComponentsDir, paths.kitComponentsDir],
    // The package the kit's own Quick Start tells consumers to import (S1 §2a).
    importPackage: V2_PACKAGES[1].name,
  });

  return {
    tokens,
    components,
    "kit-a11y": kitA11y,
    "kit-icons": kitIcons,
    "kit-signatures": knowledge.signatures,
  };
};
