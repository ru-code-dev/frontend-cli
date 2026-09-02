/**
 * The filesystem layout the five extractors read, derived from ONE explicit root.
 *
 * Ported from `hackathon2026/ds-analyzer/src/config.ts:15-122` with three deletions, and each
 * deletion is the same decision restated: this package is a library inside a shipped bundle,
 * not a script sitting next to a checkout.
 *
 *  - `analyzerRoot` is gone. It was `resolve(dirname(fileURLToPath(import.meta.url)), '..')`
 *    (`config.ts:54-57`) — a bundle that computes its own repository root is a bundle that
 *    breaks the moment it is copied somewhere else, which is exactly the failure this repo's
 *    single-file target exists to prevent (`cli/tsdown.config.ts:5-13`).
 *  - `artifactsDir` is gone. The hackathon hardcoded `<analyzerRoot>/artifacts` with no flag to
 *    change it (`config.ts:94`), so every extractor both read and wrote one fixed directory.
 *    Here the pipeline passes artifacts between stages as VALUES ({@link KitCorpus}) and the
 *    command decides where — if anywhere — they land.
 *  - THE DISCOVERY ORDER is gone: explicit arg → a kit-root environment variable → a sibling
 *    directory beside the analyzer (`config.ts:59-77`; the variable's name is one of the
 *    strings `tests/forbidden-content.test.ts` forbids, so it is cited rather than spelled).
 *    The command resolves its source through `@smart-tools/fe-source` — a directory, or a clone
 *    of `--source` — so by the time this function is called the root is known. Guessing a
 *    sibling directory out of a bundle would be guessing about a machine, and reading a root out
 *    of the environment would make two runs of the same command mean different things.
 *
 * What is KEPT verbatim is every path this layout actually names, because those are the kit's
 * shape rather than the analyzer's: `packages/theme/src` and `packages/base/src`, the two
 * barrels, and the `@v-uik` upstream. Changing any of them would change what gets extracted.
 */
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { ExtractionError } from "./shared/errors.ts";

/** Every path the extractors read, resolved once. */
export interface KitPaths {
  /** Root of the UI kit monorepo. */
  readonly uiKitRoot: string;
  /** `packages/theme/src` — the token sources. */
  readonly themeSrcDir: string;
  /** `packages/theme/package.json`. */
  readonly themePackageJson: string;
  /** `packages/base/src` — the component sources. */
  readonly baseSrcDir: string;
  /** `packages/base/src/components`. */
  readonly componentsDir: string;
  /** `packages/base/src/components/index.ts` — the public component barrel. */
  readonly componentsBarrel: string;
  /** `packages/base/src/index.ts` — the package entry point. */
  readonly baseBarrel: string;
  /**
   * `@v-uik` package root, or `null` when the upstream library is not installed.
   *
   * Optional by design, and the hackathon's reasoning (`config.ts:34-42`) is kept word for
   * word: three of the five extractors run on a bare checkout, and that property is worth
   * keeping — the analyzer must never require a successful install of somebody else's
   * monorepo to produce a corpus. What depends on the upstream degrades to a recorded gap
   * (`kit-a11y/extract.ts` returns `upstreamAvailable: false`) instead of a crash.
   */
  readonly upstreamDir: string | null;
}

/** Where `@v-uik` may sit inside a prefix `npm install` created, in order of preference. */
const UPSTREAM_CANDIDATES = [
  ["node_modules", "@v-uik"],
  // The hackathon's probe-install location, kept so a kit checkout that already has one is
  // used as it stands (`config.ts:48-49`).
  [".vuik", "node_modules", "@v-uik"],
] as const;

/**
 * The `@v-uik` directory under `prefix`, or `null`.
 *
 * Exported because the npm step and the path builder are separate concerns: the installer
 * knows a prefix, the extractor knows a directory, and this is the one function that turns the
 * first into the second.
 */
export const resolveUpstreamDir = (prefix: string): string | null => {
  for (const segments of UPSTREAM_CANDIDATES) {
    const candidate = join(prefix, ...segments);
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

export interface KitPathsOptions {
  /** The UI kit checkout root — a directory that contains `packages/theme/src`. */
  readonly uiKitRoot: string;
  /**
   * Where to look for an installed `@v-uik`. Defaults to the kit root itself, which is where a
   * `yarn install` in the checkout would put it; the command points it at the temp prefix that
   * `npm install --prefix` filled instead.
   */
  readonly upstreamPrefix?: string | undefined;
}

/**
 * Builds the path set every extractor takes. Fails fast when the root is not a UI kit.
 *
 * The `packages/theme/src` existence check is the hackathon's own test for "is this the kit"
 * (`config.ts:68`), kept because it is the cheapest question that separates a real checkout
 * from a directory someone typed by mistake — and because failing here costs a user one line,
 * while failing later costs them a ts-morph load of the wrong tree.
 */
export const resolveKitPaths = (options: KitPathsOptions): KitPaths => {
  const uiKitRoot = resolve(options.uiKitRoot);

  if (!existsSync(join(uiKitRoot, "packages", "theme", "src"))) {
    throw new ExtractionError(
      `"${uiKitRoot}" does not look like the UI kit: packages/theme/src is missing.`,
    );
  }

  const baseSrcDir = join(uiKitRoot, "packages", "base", "src");
  const componentsDir = join(baseSrcDir, "components");

  return {
    uiKitRoot,
    themeSrcDir: join(uiKitRoot, "packages", "theme", "src"),
    themePackageJson: join(uiKitRoot, "packages", "theme", "package.json"),
    baseSrcDir,
    componentsDir,
    componentsBarrel: join(componentsDir, "index.ts"),
    baseBarrel: join(baseSrcDir, "index.ts"),
    upstreamDir: resolveUpstreamDir(options.upstreamPrefix ?? uiKitRoot),
  };
};

/**
 * Path relative to the UI kit root, with POSIX separators, for stable artifact fields.
 *
 * Verbatim from `config.ts:120-122`. It is what keeps `meta.sourceRoot` and every
 * `directory`/`file` field in the corpus identical on Windows and Linux — and therefore what
 * makes the byte-identity test a test of the extraction rather than of the machine.
 */
export const toKitRelativePath = (paths: KitPaths, absolutePath: string): string =>
  relative(paths.uiKitRoot, absolutePath).split(/[\\/]/).join("/");
