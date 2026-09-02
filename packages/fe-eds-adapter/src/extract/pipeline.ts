/**
 * THE PIPELINE — five extractors, one checkout, one order.
 *
 * The hackathon had no such file. It had five CLI entry points that each called `resolvePaths()`
 * for themselves and passed artifacts to one another THROUGH A DIRECTORY: kit-a11y read the
 * `components.json` that `extract-components` had written, kit-knowledge read that one and
 * `kit-a11y.json` too (`ds-analyzer/src/cli/extract-*.ts`; the dependency graph is E1 §1-2's
 * reconstruction, because it was never written down as one). `extract-all.ts:16-59` drove only
 * the three independent extractors, which is why `extraction-summary.json` records durations for
 * three and the other two were run by hand.
 *
 * Here the graph IS this function, in the only order its data dependencies allow:
 *
 *   tokens ─┐
 *   icons ──┤  (independent — all three read only the checkout)
 *   components ─┬─► kit-a11y ─┬─► kit-knowledge
 *               └─────────────┘
 *
 * and every edge is a VALUE, not a file. Three consequences, all of them the point:
 *  - a half-written corpus from an earlier run cannot be picked up by a later stage;
 *  - the five artifacts in a corpus are guaranteed to describe one checkout, because there is
 *    one `KitPaths` and it is resolved once;
 *  - nothing is written until all five have succeeded, so a failure leaves the corpus directory
 *    exactly as it was.
 *
 * The upstream install is the only step that can be skipped, and skipping it is not an error:
 * kit-a11y degrades to `upstreamAvailable: false` with a recorded diagnostic
 * (`kit-a11y/extract.ts:221-246`) and kit-knowledge to empty ARIA fields. That is the hackathon's
 * own promise — "the analyzer must never require a successful install of somebody else's
 * monorepo" — and it is what makes `--parse-ui-kit` usable with no network at all.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { extractComponents } from "./components/extract.ts";
import type { ComponentsArtifact } from "./domain/components.ts";
import type { KitA11yArtifact } from "./domain/kit-a11y.ts";
import type { KitIconsArtifact } from "./domain/kit-icons.ts";
import type { KitSignaturesArtifact } from "./domain/kit-knowledge.ts";
import type { TokensArtifact } from "./domain/tokens.ts";
import { extractIcons } from "./icons/extract.ts";
import { extractKitA11y } from "./kit-a11y/extract.ts";
import { extractKnowledge } from "./kit-knowledge/extract.ts";
import { installUpstream, UPSTREAM_PACKAGE } from "./npm.ts";
import { resolveKitPaths, type KitPaths } from "./paths.ts";
import { extractTokens } from "./tokens/extract.ts";

const execFileAsync = promisify(execFile);

/**
 * The five files a corpus is, keyed by the basename each is written under.
 *
 * `kit-cards.json` — the sixth thing `extractKnowledge` produces — is deliberately absent, for
 * the same reason it is absent from `src/artifacts/` (`src/artifacts/index.ts:29-32`): it feeds
 * only the hackathon's `deep-pack` LLM scenario, no rule in this repository reads it, and an
 * on-disk corpus exists to REPLACE the embedded snapshot file for file. A corpus with a sixth
 * member could not do that.
 */
export interface KitCorpus {
  readonly tokens: TokensArtifact;
  readonly components: ComponentsArtifact;
  readonly "kit-a11y": KitA11yArtifact;
  readonly "kit-icons": KitIconsArtifact;
  readonly "kit-signatures": KitSignaturesArtifact;
}

/** The corpus member names, in the order the command lists the written files. */
export const CORPUS_MEMBERS = [
  "tokens",
  "components",
  "kit-a11y",
  "kit-icons",
  "kit-signatures",
] as const satisfies readonly (keyof KitCorpus)[];

export type CorpusMember = (typeof CORPUS_MEMBERS)[number];

export interface ExtractedKit {
  readonly corpus: KitCorpus;
  /** The design system's own version, from `packages/theme/package.json`. */
  readonly version: string | null;
  /** The checkout's commit sha, or `null` when it is not a git working tree. */
  readonly commit: string | null;
  /** `false` when `@v-uik` was not installed and the two upstream-derived artifacts degraded. */
  readonly upstreamAvailable: boolean;
}

export interface ExtractKitOptions {
  /** The UI kit checkout — already on disk, resolved by `@smart-tools/fe-source`. */
  readonly uiKitRoot: string;
  /** Where to install `@v-uik`. Omitted means "do not install" — see the file header. */
  readonly upstreamPrefix?: string | undefined;
  /** Overrides the private registry the upstream comes from. */
  readonly registry?: string | undefined;
  /** Announces each stage as it starts, so a CLI can put a phase label on a long run. */
  readonly onStage?: ((stage: CorpusMember) => void) | undefined;
}

/**
 * The `@v-uik` version this checkout pins, read from the kit's own manifest.
 *
 * `packages/base/package.json`'s `dependencies["@v-uik/base"]` is the authority — the brief's
 * "the version pinned in the EDS clone". Reading it rather than hardcoding `1.23.0` is what
 * makes a regeneration from a NEWER checkout describe that checkout's upstream instead of the
 * one this package happened to be written against.
 */
export const readUpstreamVersion = async (uiKitRoot: string): Promise<string | null> => {
  try {
    const manifest: unknown = JSON.parse(
      await readFile(join(uiKitRoot, "packages", "base", "package.json"), "utf8"),
    );
    if (typeof manifest !== "object" || manifest === null) return null;
    const dependencies = (manifest as Record<string, unknown>)["dependencies"];
    if (typeof dependencies !== "object" || dependencies === null) return null;
    const pinned = (dependencies as Record<string, unknown>)[UPSTREAM_PACKAGE];
    return typeof pinned === "string" && pinned !== "" ? pinned : null;
  } catch {
    return null;
  }
};

/** The kit's own version, from `packages/theme/package.json` — the string the notice prints. */
export const readKitVersion = async (uiKitRoot: string): Promise<string | null> => {
  try {
    const manifest: unknown = JSON.parse(
      await readFile(join(uiKitRoot, "packages", "theme", "package.json"), "utf8"),
    );
    if (typeof manifest !== "object" || manifest === null) return null;
    const version = (manifest as Record<string, unknown>)["version"];
    return typeof version === "string" && version !== "" ? version : null;
  } catch {
    return null;
  }
};

/**
 * The checkout's commit, or `null`.
 *
 * Total by design: a corpus extracted from a directory that is not a git working tree — a
 * tarball, a vendored copy — is a perfectly good corpus, it simply cannot say which commit it
 * came from, and `null` says exactly that. `execFile`, never a shell string, for the reason
 * `npm.ts`'s header gives.
 */
export const readCommitSha = async (dir: string): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync("git", ["-C", dir, "rev-parse", "HEAD"]);
    const sha = stdout.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
};

/**
 * Run all five extractors against one checkout.
 *
 * Throws {@link NpmError} when an upstream install was requested and failed, and
 * {@link ExtractionError}/{@link ArtifactValidationError} when the checkout is not the kit or an
 * extractor produced something its own schema rejects. Nothing is written here — the caller
 * decides where the corpus lands.
 */
export const extractKit = async (options: ExtractKitOptions): Promise<ExtractedKit> => {
  const announce = options.onStage ?? ((): void => {});

  let paths: KitPaths = resolveKitPaths({ uiKitRoot: options.uiKitRoot });

  if (options.upstreamPrefix !== undefined) {
    const version = await readUpstreamVersion(paths.uiKitRoot);
    if (version !== null) {
      await installUpstream({
        prefix: options.upstreamPrefix,
        version,
        ...(options.registry === undefined ? {} : { registry: options.registry }),
      });
      // Re-resolved rather than patched: `upstreamDir` is derived from the prefix by the same
      // probe the no-install path uses, so there is one statement of where `@v-uik` may sit.
      paths = resolveKitPaths({
        uiKitRoot: options.uiKitRoot,
        upstreamPrefix: options.upstreamPrefix,
      });
    }
  }

  announce("tokens");
  const tokens = await extractTokens(paths);

  announce("components");
  const components = await extractComponents(paths);

  announce("kit-a11y");
  const kitA11y = extractKitA11y({ paths, components });

  announce("kit-icons");
  const kitIcons = extractIcons(paths);

  announce("kit-signatures");
  const knowledge = extractKnowledge({ paths, components, a11y: kitA11y });

  return {
    corpus: {
      tokens,
      components,
      "kit-a11y": kitA11y,
      "kit-icons": kitIcons,
      "kit-signatures": knowledge.signatures,
    },
    version: await readKitVersion(paths.uiKitRoot),
    commit: await readCommitSha(paths.uiKitRoot),
    upstreamAvailable: kitA11y.meta.upstreamAvailable,
  };
};
