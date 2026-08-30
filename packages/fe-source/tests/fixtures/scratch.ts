/**
 * THE TIER-1 MACHINERY: scratch directories, a git repository this file BUILDS, and a
 * leftover sweep.
 *
 * ZERO NETWORK is brief B1 deliverable 3's hard constraint, and it is met by construction
 * rather than by mocking: {@link buildBareRepo} runs `git init --bare`, clones it, commits
 * twice and pushes — all under `os.tmpdir()` — so the «remote» the clone tests point
 * `resolveSource` at is a real git repository reachable over a real git transport (`file://`)
 * that no packet ever leaves the machine for. Nothing in this package is stubbed for the tests;
 * the same `execFile` path that will clone from GitHub clones from here.
 *
 * WHY NOT `@smart-tools/fe-testkit`, which already has `makeTempDir`
 * (`packages/testkit/src/index.ts:48-55`). Two reasons, both structural. Adding it as a
 * devDependency means editing `pnpm-lock.yaml`, which brief B1's protocol forbids outright.
 * And testkit currently re-exports fixtures from `fe-pixso` by relative path
 * (`packages/testkit/src/fixtures.ts:37`), so depending on it from here would couple this
 * package's test lane to a package it has nothing to do with. Two `mkdtemp` calls are the
 * cheaper answer; if a later brief moves the fixtures the other way, this file is four
 * functions to delete.
 */
import { execFile } from "node:child_process";
import { mkdtemp, realpath, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Identity and signing pinned PER INVOCATION with `-c` rather than written into the repo.
 *
 * A machine with no `user.email` configured makes `git commit` fail, and a machine WITH
 * `commit.gpgsign=true` makes it block on a passphrase prompt — either would be a red suite
 * caused by the developer's own `~/.gitconfig` rather than by this package. `-c` overrides both
 * for exactly these commands and leaves no trace.
 */
const IDENTITY = [
  "-c",
  "user.email=fe-source@example.invalid",
  "-c",
  "user.name=fe-source tests",
  "-c",
  "commit.gpgsign=false",
] as const;

/** `init.defaultBranch` is pinned too: git warns and the branch name varies by version and by
 *  user config, and the clone has to find a HEAD that points somewhere. */
const DEFAULT_BRANCH = ["-c", "init.defaultBranch=main"] as const;

/** A fresh, symlink-resolved directory under the OS temp root. Resolved because `os.tmpdir()`
 *  is itself a symlink on macOS, and half these assertions compare paths. */
export async function scratchDir(prefix: string): Promise<string> {
  return await realpath(await mkdtemp(join(tmpdir(), prefix)));
}

/** Idempotent removal — safe in a `finally` that may run after a test already cleaned up. */
export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/**
 * Every entry directly under the OS temp root whose name starts with `prefix`.
 *
 * This is how the «cleanup runs on failure paths too» requirement is PROVEN rather than
 * asserted: a test gives `resolveSource` a private `tmpPrefix`, forces a failure, and expects
 * this to come back empty. A leaked clone directory would be sitting right here.
 */
export async function leftovers(prefix: string): Promise<readonly string[]> {
  const entries = await readdir(tmpdir());
  return entries.filter((name) => name.startsWith(prefix));
}

/** What {@link buildBareRepo} made, described in data so the assertions read it out of the
 *  fixture instead of restating it. */
export interface BareRepoFixture {
  /** The bare repository's path on disk. */
  readonly bare: string;
  /** The same repository as a `file://` URL — what `resolveSource` is actually given. */
  readonly url: string;
  /** A file present at HEAD, and its exact bytes. */
  readonly headFile: string;
  readonly headContent: string;
  /** How many commits the ORIGIN has. Greater than 1 on purpose: it is what makes a shallow
   *  clone distinguishable from a full one. */
  readonly commits: number;
}

/**
 * Build a real, pushed-to, two-commit bare repository under `root`.
 *
 * Two commits, not one, because `--depth 1` is otherwise unfalsifiable: a full clone of a
 * one-commit repository and a shallow clone of it are the same tree. With two, the clone test
 * can assert `rev-list --count HEAD === 1` against `commits === 2` and the flag is proven.
 */
export async function buildBareRepo(root: string): Promise<BareRepoFixture> {
  const bare = join(root, "origin.git");
  const work = join(root, "work");

  await run("git", [...DEFAULT_BRANCH, "init", "--bare", bare]);
  await run("git", [...DEFAULT_BRANCH, "clone", bare, work]);

  await writeFile(join(work, "first.txt"), "first commit\n");
  await run("git", [...IDENTITY, "-C", work, "add", "."]);
  await run("git", [...IDENTITY, "-C", work, "commit", "-m", "first"]);

  const headFile = "index.html";
  const headContent = "<main>fe-source fixture</main>\n";
  await writeFile(join(work, headFile), headContent);
  await run("git", [...IDENTITY, "-C", work, "add", "."]);
  await run("git", [...IDENTITY, "-C", work, "commit", "-m", "second"]);

  await run("git", ["-C", work, "push", "origin", "HEAD:refs/heads/main"]);

  return { bare, url: pathToFileURL(bare).href, headFile, headContent, commits: 2 };
}

/** Read a single-line `git` answer out of a repository. Used to interrogate the CLONE — its
 *  shallowness and its history depth are properties of the checkout `resolveSource` produced,
 *  not of anything this package returns. */
export async function gitOut(dir: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", dir, ...args]);
  return stdout.trim();
}
