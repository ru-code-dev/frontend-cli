/**
 * THE EDS 2.x CHECKOUT, as a path set — the v2 twin of `extract/paths.ts`.
 *
 * A separate builder rather than a widened one, and the reason is `resolveKitPaths`'s own first
 * statement: it refuses any root without `packages/theme/src`
 * (`packages/fg-eds-adapter/src/extract/paths.ts:319-323`), and EDS 2.x has no `packages/theme`
 * at all — its tokens live in `packages/base/src/theme/core` (S1 break V1,
 * `WORKFLOW/features/eds2/reports/s1-v2-facts.md:382`). The two layouts share no directory
 * except `packages/base/src`, so one function trying to describe both would be a chain of
 * conditionals with two disjoint outputs.
 *
 * {@link detectKitLayout} is what picks between them, and it asks the cheapest question that
 * separates the two checkouts: which of the two token directories exists.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { ExtractionError } from "../shared/errors.ts";

/** Every path the v2 extractors read, resolved once. */
export interface KitPathsV2 {
  readonly uiKitRoot: string;
  /** `packages/base` — the headless-parts package (`@sds-eng/base-exp`). */
  readonly basePackageDir: string;
  readonly baseSrcDir: string;
  readonly baseComponentsDir: string;
  readonly baseComponentsBarrel: string;
  readonly baseBarrel: string;
  readonly basePackageJson: string;
  /** `packages/kit` — the assembled components (`@sds-eng/kit-exp`). */
  readonly kitPackageDir: string;
  readonly kitSrcDir: string;
  readonly kitComponentsDir: string;
  readonly kitComponentsBarrel: string;
  readonly kitBarrel: string;
  readonly kitPackageJson: string;
  /** `packages/base/src/theme` — the token entry points live directly in it. */
  readonly themeDir: string;
  /** `packages/base/src/theme/core` — the five tier contracts. */
  readonly themeCoreDir: string;
  /** `packages/base/src/theme/core/layers.css.ts` — the 30 component style layers. */
  readonly layersFile: string;
  /** `packages/base/src/components/Icon/svg` — 466 flat `io<size>-<name>.svg` files. */
  readonly iconsSvgDir: string;
}

/**
 * Which EDS a checkout is, from its own directory layout.
 *
 * `null` for a directory that is neither, so the caller can say "this is not the UI kit" with
 * the root it was given rather than with whichever extractor happened to open a file first.
 */
export const detectKitLayout = (uiKitRoot: string): "v1" | "v2" | null => {
  const root = resolve(uiKitRoot);

  if (existsSync(join(root, "packages", "base", "src", "theme", "core"))) return "v2";
  if (existsSync(join(root, "packages", "theme", "src"))) return "v1";

  return null;
};

/** Builds the v2 path set. Fails fast when the root is not an EDS 2.x checkout. */
export const resolveKitPathsV2 = (uiKitRoot: string): KitPathsV2 => {
  const root = resolve(uiKitRoot);

  if (detectKitLayout(root) !== "v2") {
    throw new ExtractionError(
      `"${root}" does not look like an EDS 2.x checkout: packages/base/src/theme/core is missing.`,
    );
  }

  const basePackageDir = join(root, "packages", "base");
  const baseSrcDir = join(basePackageDir, "src");
  const baseComponentsDir = join(baseSrcDir, "components");
  const kitPackageDir = join(root, "packages", "kit");
  const kitSrcDir = join(kitPackageDir, "src");
  const kitComponentsDir = join(kitSrcDir, "components");
  const themeDir = join(baseSrcDir, "theme");

  return {
    uiKitRoot: root,
    basePackageDir,
    baseSrcDir,
    baseComponentsDir,
    baseComponentsBarrel: join(baseComponentsDir, "index.ts"),
    baseBarrel: join(baseSrcDir, "index.ts"),
    basePackageJson: join(basePackageDir, "package.json"),
    kitPackageDir,
    kitSrcDir,
    kitComponentsDir,
    kitComponentsBarrel: join(kitComponentsDir, "index.ts"),
    kitBarrel: join(kitSrcDir, "index.ts"),
    kitPackageJson: join(kitPackageDir, "package.json"),
    themeDir,
    themeCoreDir: join(themeDir, "core"),
    layersFile: join(themeDir, "core", "layers.css.ts"),
    iconsSvgDir: join(baseComponentsDir, "Icon", "svg"),
  };
};

/** Path relative to the kit root, POSIX separators — the v2 twin of `toKitRelativePath`. */
export const toKitRelativePathV2 = (paths: KitPathsV2, absolutePath: string): string =>
  absolutePath.startsWith(paths.uiKitRoot)
    ? absolutePath
        .slice(paths.uiKitRoot.length + 1)
        .split(/[\\/]/)
        .join("/")
    : absolutePath.split(/[\\/]/).join("/");
