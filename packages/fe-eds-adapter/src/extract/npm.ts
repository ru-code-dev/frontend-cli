/**
 * THE ONE STEP THAT NEEDS THE NETWORK — installing `@v-uik` so kit-a11y has something to read.
 *
 * Two of the five extractors describe the library the kit WRAPS rather than the kit itself
 * (`kit-a11y/extract.ts:9-23`), and only its compiled `dist/esm` ships, so there is no source
 * checkout to read: the package has to be installed. Everything about how that is done here is
 * a consequence of two facts.
 *
 * ── FACT ONE: `@v-uik` IS ON A PRIVATE REGISTRY, EVERYTHING ELSE IS NOT ─────────────────────
 *
 * `ui-kit-eds-ce/yarn.lock` resolves every `@v-uik/*` from
 * `https://gitverse.ru/api/packages/sbertech/npm/`, and that registry serves ONLY that scope —
 * pointing npm's DEFAULT registry at it fails on the first ordinary dependency
 * (`@popperjs/core` 404s, verified). So the registry is applied as a SCOPED override,
 * `--@v-uik:registry=…`, and the public registry keeps serving the rest. Reading the URL off a
 * lockfile is not something this code does: the default is a constant here and `--registry` on
 * the command overrides it, because a URL a tool discovers is a URL nobody reviewed.
 *
 * ── FACT TWO: WHICH PACKAGES, EXACTLY ───────────────────────────────────────────────────────
 *
 * `@v-uik/base` and nothing else. That is not a simplification — it is the answer the acceptance
 * test forced. Installing the four packages the kit's manifests pin yields 66 packages and a
 * `kit-a11y.json` that differs from the embedded one in four numbers; `@v-uik/base`'s own
 * dependency closure is 63, which is what `meta.packagesScanned` records, and it reproduces the
 * artifact byte for byte. The three surplus packages — `clickstream`, `next-js-provider`,
 * `tree-dnd` — are unreachable from `base`, are named by no component's `wraps`, and between
 * them contribute the single extra spacing declaration that moved every ratio.
 *
 * ── WHY `execFile` AND NOT A SHELL, AND WHY SYSTEM npm ──────────────────────────────────────
 *
 * `execFile` passes an argv ARRAY: there is no shell to quote for, so a registry URL or a
 * version containing `;` or `$(…)` is inert data — the same reasoning, and the same shape, as
 * `packages/fe-source/src/resolve.ts:32-36`. And npm is SHELLED OUT TO rather than reimplemented
 * because a registry client, a tarball extractor and a dependency resolver are exactly the three
 * things that must not be in a bundle whose promise is zero dependencies.
 *
 * npm's absence is therefore a first-class, typed outcome rather than a crash: {@link NpmError}
 * with `code: "npm-not-installed"`, which the command turns into a localized sentence — the same
 * arrangement `fe-source` uses for a missing git (`packages/fe-source/src/errors.ts`).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { resolveUpstreamDir } from "./paths.ts";

const execFileAsync = promisify(execFile);

/** The scope whose packages come from the private registry. */
export const UPSTREAM_SCOPE = "@v-uik";

/** The package whose dependency closure IS the upstream evidence — see the file header. */
export const UPSTREAM_PACKAGE = "@v-uik/base";

/** Sbertech's registry, as `ui-kit-eds-ce/yarn.lock` resolves every `@v-uik/*` from. */
export const DEFAULT_UPSTREAM_REGISTRY = "https://gitverse.ru/api/packages/sbertech/npm/";

/**
 * An install that did not produce a readable `@v-uik`.
 *
 * Two codes, because the two have different answers: one is "install npm", the other is
 * "the registry said no, here is what it said".
 */
export class NpmError extends Error {
  override readonly name = "NpmError";
  readonly code: "npm-not-installed" | "install-failed";
  /** npm's own words, when it produced any. English and unlocalized, by nature. */
  readonly detail: string | undefined;

  // Written as assignments rather than as constructor parameter properties: this repo compiles
  // under `erasableSyntaxOnly` (`tsconfig.base.json`), which forbids the shorthand because it
  // emits code rather than erasing.
  constructor(
    code: "npm-not-installed" | "install-failed",
    message: string,
    detail?: string | undefined,
  ) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export const isNpmError = (error: unknown): error is NpmError => error instanceof NpmError;

export interface InstallUpstreamOptions {
  /** An existing, empty directory to install into; becomes `<prefix>/node_modules/@v-uik`. */
  readonly prefix: string;
  /** The version to pin, read from the kit checkout's own manifest. */
  readonly version: string;
  /** Overrides {@link DEFAULT_UPSTREAM_REGISTRY}. */
  readonly registry?: string | undefined;
  /** Replaces `process.env` for the child when given — how a test reaches `npm-not-installed`. */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  /** Aborts the install. `AbortSignal.timeout(ms)` is the intended spelling for a deadline. */
  readonly signal?: AbortSignal | undefined;
}

/** npm can be chatty on a slow network; 32 MiB is far more than it can produce here. */
const MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Install `@v-uik/base@<version>` into `prefix`, and return the `@v-uik` directory.
 *
 * The flags, each for a stated reason:
 *  - `--prefix` — install into a directory this process owns, never the user's project.
 *  - `--@v-uik:registry` — fact one above.
 *  - `--ignore-scripts` — a corpus extraction must not execute a third party's postinstall.
 *    This is the security-relevant one: the packages are read as TEXT and nothing in them is
 *    ever run, so there is no reason to let them run at install time either.
 *  - `--omit=dev --omit=optional` — the extractor reads `dist/esm/**\/*.js`, which is shipped
 *    code; a dev dependency of the upstream cannot appear in it.
 *  - `--legacy-peer-deps` — `@v-uik` peers on React, which is not being installed. Without this
 *    npm refuses the tree over a peer nothing here will ever import.
 *  - `--no-audit --no-fund` — two network round-trips and a paragraph of output, for a tree
 *    nobody will run.
 */
export const installUpstream = async (options: InstallUpstreamOptions): Promise<string> => {
  const registry = options.registry ?? DEFAULT_UPSTREAM_REGISTRY;

  try {
    await execFileAsync(
      "npm",
      [
        "install",
        "--prefix",
        options.prefix,
        `--${UPSTREAM_SCOPE}:registry=${registry}`,
        "--ignore-scripts",
        "--omit=dev",
        "--omit=optional",
        "--legacy-peer-deps",
        "--no-audit",
        "--no-fund",
        "--",
        `${UPSTREAM_PACKAGE}@${options.version}`,
      ],
      {
        ...(options.env === undefined ? {} : { env: options.env }),
        maxBuffer: MAX_BUFFER,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  } catch (cause) {
    // A spawn failure carries the STRING `"ENOENT"` in `code`; an npm that ran and refused
    // carries a NUMBER (its exit status). The two can never be confused — the same test
    // `packages/fe-source/src/resolve.ts:192-195` uses to separate "no git" from "git said no".
    if (isSpawnEnoent(cause)) {
      throw new NpmError(
        "npm-not-installed",
        `npm is required to install ${UPSTREAM_PACKAGE} and was not found on PATH.`,
      );
    }
    throw new NpmError(
      "install-failed",
      `npm could not install ${UPSTREAM_PACKAGE}@${options.version} from ${registry}.`,
      stderrOf(cause),
    );
  }

  const upstreamDir = resolveUpstreamDir(options.prefix);
  if (upstreamDir === null) {
    throw new NpmError(
      "install-failed",
      `npm reported success but no ${UPSTREAM_SCOPE} directory appeared under ${options.prefix}.`,
    );
  }

  return upstreamDir;
};

/** `npm` could not be spawned at all. */
const isSpawnEnoent = (cause: unknown): boolean =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";

/** npm's own words, trimmed, or `undefined` when it said nothing. */
const stderrOf = (cause: unknown): string | undefined => {
  if (typeof cause !== "object" || cause === null || !("stderr" in cause)) return undefined;
  const raw = cause.stderr;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
};
