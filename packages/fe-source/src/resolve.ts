/**
 * SOURCE ACQUISITION — «give me a directory to analyze» — and it is the ONLY thing this package
 * does.
 *
 * Design h4 puts source resolution in the feature package's prose («local path used directly;
 * http(s)/git URL → shallow `git clone --depth 1` (shell out to system git, zero deps) into a
 * temp dir, cleaned up after» — `WORKFLOW/features/hackathon-analys/plans/h4-design.md:50-53`)
 * and marks it NOT FOUND in the hackathon repo, i.e. new code. Brief B1 lifts it OUT of the
 * feature package into `fe-source` so the analyzer, the report command and anything after them
 * acquire trees the same way. Consequently there is no CLI knowledge here: no `CommandContext`,
 * no `Localized`, no exit codes, not even a dependency on `@smart-tools/fe-cli-kit`. Node
 * builtins, and nothing else, all the way down (brief B1 protocol: «your package has NO runtime
 * deps»).
 *
 * THE DECISION ORDER, and why it is this order and not the one the deliverable lists:
 *
 *   1. an explicit URL SCHEME (`http://`, `https://`, `file://`, `ssh://`, `git://`) → CLONE.
 *      No local path can begin with those five bytes-plus-`://`, so nothing on disk is shadowed
 *      by taking them first.
 *   2. otherwise the input is STATTED. Exists and is a directory → LOCAL. Exists and is not →
 *      `not-a-directory`.
 *   3. only if it does not exist do the two AMBIGUOUS git spellings get their turn — the
 *      scp-like `git@host:org/repo` and the `.git` suffix — and then → CLONE.
 *   4. anything left → `path-not-found`.
 *
 * Steps 2-3 are inverted relative to a naive reading of brief B1 deliverable 1, deliberately,
 * and the deliverable's own ordering is the reason: it states «Existing directory path →
 * kind: "local"» FIRST. A bare repository on disk is a directory literally named `…/repo.git`,
 * and a URL-first rule would hand that directory to `git clone` instead of analyzing it. Under
 * this order, WHAT EXISTS WINS, for every spelling that could be both.
 *
 * WHY `execFile` AND NOT `exec`. Brief B1 deliverable 1: «system git via
 * `child_process.execFile`, never a shell string». `execFile` passes an argv ARRAY to the OS —
 * there is no shell to quote for, so a repository argument containing `;`, `$(…)` or a newline
 * is inert data. `--` before the two operands closes the same hole on git's own side: an input
 * beginning with `-` is an operand, never an option. `tests/clone.test.ts` pins both.
 */
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { SourceError } from "./errors.ts";

const execFileAsync = promisify(execFile);

/** Prefix for the temp directory a clone lands in. Overridable per call so a test can sweep the
 *  temp root for its OWN leftovers without racing every other suite on the machine. */
const DEFAULT_TMP_PREFIX = "fe-source-";

/**
 * Schemes that are UNAMBIGUOUSLY remote — checked before the filesystem (decision order step 1).
 *
 * `http(s)` and `file` are brief B1 deliverable 1's own list. `ssh` and `git` are added because
 * they are real git transports whose canonical spellings would otherwise reach a user as
 * `path-not-found` — a WRONG error, not a missing feature — and because, being schemes, they
 * cannot collide with any local path. Recorded as a documented superset rather than assumed:
 * `WORKFLOW/features/hackathon-analys/reports/b1-fe-source.md` calls it out for the owner.
 */
const REMOTE_SCHEMES = ["http://", "https://", "file://", "ssh://", "git://"] as const;

/** `git@github.com:org/repo` and its `user@host:path` family — brief B1's `git@…` form. Only
 *  consulted for an input that does NOT exist on disk (decision order step 3). */
const SCP_LIKE = /^[^\s/@]+@[^\s/:]+:/;

/** `git`'s output on this path is a line or two of English; 8 MiB is orders of magnitude more
 *  than it can produce with a non-TTY stderr (progress reporting switches itself off), and the
 *  cap exists only so a pathological remote cannot grow the buffer without bound. */
const MAX_BUFFER = 8 * 1024 * 1024;

/** `"local"` — the caller's own directory, left exactly as found. `"cloned"` — a temp checkout
 *  this package created and is responsible for. */
export type SourceKind = "local" | "cloned";

/**
 * A directory to analyze, plus the obligation that comes with it.
 *
 * `cleanup()` is on the value rather than being a separate `cleanupSource(dir)` function so a
 * caller can neither forget WHICH directory to remove nor remove a user's own project by
 * mistake: for `kind: "local"` it is a no-op, so `try { … } finally { await src.cleanup() }` is
 * unconditionally correct and the local/cloned distinction never leaks into caller control flow.
 */
export interface ResolvedSource {
  /** Absolute, symlink-resolved. Always a real directory that exists at return time. */
  readonly dir: string;
  readonly kind: SourceKind;
  /** Removes the temp checkout (`kind: "cloned"`); does nothing (`kind: "local"`). Idempotent —
   *  a second call, or a call after the directory is already gone, resolves quietly. */
  cleanup(): Promise<void>;
}

/** Everything optional about a resolution. Every field is spelled `| undefined` because
 *  `exactOptionalPropertyTypes` (`tsconfig.base.json:28`) rejects an explicit `undefined`
 *  against a bare `?:` — and an options object built by a caller from its own optionals is
 *  exactly what produces one. */
export interface ResolveSourceOptions {
  /**
   * The environment `git` is spawned with. WHEN GIVEN IT REPLACES `process.env` rather than
   * merging into it — that is what makes `git-not-installed` reachable from a test without
   * mutating the runner's own environment (`tests/clone.test.ts`), and what lets a caller run a
   * clone under a scrubbed environment on purpose.
   */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  /** Prefix for the `mkdtemp` directory. Default `"fe-source-"`. */
  readonly tmpPrefix?: string | undefined;
  /** Aborts the clone. `AbortSignal.timeout(ms)` is the intended spelling for a deadline; an
   *  abort surfaces as `clone-failed`, since from this package's side git simply did not
   *  finish. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * True for every spelling this package will hand to `git clone`.
 *
 * Exported because the CALLER needs the same question answered before it has a directory — a
 * command that prints «cloning…» only for remote inputs, say — and a second, drifting copy of
 * this predicate in the feature package is precisely what putting it here prevents.
 */
export function isGitUrl(input: string): boolean {
  return hasRemoteScheme(input) || SCP_LIKE.test(input) || input.endsWith(".git");
}

/**
 * Acquire a directory for `input`, cloning if it is a git URL.
 *
 * Rejects with {@link SourceError} and nothing else. On every failure path INSIDE a clone the
 * temp directory is removed before the rejection leaves this function (brief B1 deliverable 1:
 * «cleanup MUST run on failure paths too»), so a caller that never got a `ResolvedSource` has
 * nothing to clean up and cannot leak one.
 */
export async function resolveSource(
  input: string,
  options: ResolveSourceOptions = {},
): Promise<ResolvedSource> {
  // Step 1 — a scheme settles it without touching the filesystem.
  if (hasRemoteScheme(input)) return await cloneSource(input, options);

  // Step 2 — what exists wins.
  let isDirectory: boolean;
  try {
    isDirectory = (await stat(input)).isDirectory();
  } catch (cause) {
    // Step 3/4 — nothing (readable) is there. `stat` failing for a reason OTHER than absence
    // (`EACCES` on a parent, say) lands here too: the four-code taxonomy is fixed by brief B1
    // deliverable 2 and has no arm for it, so it reports as `path-not-found` — with the real
    // errno preserved on `cause`, which is why `cause` exists.
    if (isGitUrl(input)) return await cloneSource(input, options);
    throw new SourceError({ code: "path-not-found", input, cause });
  }
  if (!isDirectory) throw new SourceError({ code: "not-a-directory", input });

  return {
    dir: await realpath(input),
    kind: "local",
    // A no-op, not an omission: see `ResolvedSource.cleanup`. Written as `Promise.resolve()`
    // rather than an empty `async` body so there is no function to mistake for unfinished work.
    cleanup: () => Promise.resolve(),
  };
}

/** The five unambiguous transports. */
function hasRemoteScheme(input: string): boolean {
  return REMOTE_SCHEMES.some((scheme) => input.startsWith(scheme));
}

/**
 * `git clone --depth 1` into a fresh `mkdtemp` directory under the OS temp root.
 *
 * `--depth 1` is the brief's, and it is load-bearing rather than decorative: the analyzer reads
 * the working tree and never the history, so a full clone would be pure wall-clock and disk cost
 * on a large repository. It is honoured over `file://` too — git treats a `file://` URL as a
 * real transport instead of taking the hardlink shortcut it uses for a bare local path, which is
 * also why the tier-1 fixture in `tests/clone.test.ts` can prove the flag with zero network.
 */
async function cloneSource(input: string, options: ResolveSourceOptions): Promise<ResolvedSource> {
  const prefix = options.tmpPrefix ?? DEFAULT_TMP_PREFIX;
  // `realpath` because `os.tmpdir()` is a symlink on some platforms (`/var` → `/private/var` on
  // macOS). Resolving once here means `dir` is stable and comparable, and `cleanup` removes the
  // same directory either way.
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  const cleanup = async (): Promise<void> => {
    await rm(dir, { recursive: true, force: true });
  };

  try {
    // `mkdtemp` made `dir` and made it EMPTY, which is the one pre-existing directory `git
    // clone` accepts. `--` keeps a `-`-leading input an operand. No shell is involved anywhere.
    await execFileAsync("git", ["clone", "--depth", "1", "--", input, dir], execOptions(options));
  } catch (cause) {
    await cleanup();
    // A spawn failure carries the STRING `"ENOENT"` in `code`; a git that ran and refused
    // carries a NUMBER (its exit status). The two can never be confused, so this one test
    // separates «no git on this machine» from «git said no».
    if (isSpawnEnoent(cause)) throw new SourceError({ code: "git-not-installed", input, cause });
    throw new SourceError({ code: "clone-failed", input, gitStderr: stderrOf(cause), cause });
  }

  return { dir, kind: "cloned", cleanup };
}

/** The child process's spawn options. */
function execOptions(options: ResolveSourceOptions): Parameters<typeof execFileAsync>[2] {
  const base = options.env ?? process.env;
  return {
    // `GIT_TERMINAL_PROMPT=0` turns a private repository from a HANG into a failure: without it
    // git asks for credentials on a terminal this package deliberately did not give it. A caller
    // that sets the variable itself keeps its own value.
    env: { ...base, GIT_TERMINAL_PROMPT: base["GIT_TERMINAL_PROMPT"] ?? "0" },
    maxBuffer: MAX_BUFFER,
    // Conditional spread, same `exactOptionalPropertyTypes` reason as `SourceError`'s `cause`.
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
}

/** `git` could not be spawned at all. */
function isSpawnEnoent(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}

/** Git's own words, trimmed, or `undefined` when it said nothing. `execFile` decodes to a
 *  string by default (utf8), so there is no Buffer case to handle. */
function stderrOf(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("stderr" in cause)) return undefined;
  const raw = cause.stderr;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}
