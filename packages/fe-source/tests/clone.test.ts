/**
 * THE CLONE ARM — brief B1 deliverable 3's «clone case against a LOCAL bare repo fixture the
 * test builds itself», its cleanup, its two refusals, and the shell that is never there.
 *
 * ZERO NETWORK, and not by mocking: `tests/fixtures/scratch.ts` builds a real bare repository
 * under `os.tmpdir()` and this suite points `resolveSource` at it with a `file://` URL. The
 * code path exercised is byte-for-byte the one a `https://github.com/…` argument takes — same
 * `execFile`, same `git clone --depth 1 --`, same temp directory, same cleanup.
 */
import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { resolveSource } from "../src/index.ts";
import { rejection } from "./fixtures/rejection.ts";
import {
  buildBareRepo,
  gitOut,
  leftovers,
  removeDir,
  scratchDir,
  type BareRepoFixture,
} from "./fixtures/scratch.ts";

/** The origin every test in this file clones from. Built ONCE: it is read-only to the suite,
 *  and `git init`/commit/push is the slowest thing here by an order of magnitude. */
let origin: BareRepoFixture;
let originRoot: string;
/** `os.tmpdir()`, symlink-resolved — clone directories are compared against it and macOS
 *  reports `/var` for a directory that really lives at `/private/var`. */
let tempRoot: string;

/** Per-test directories, emptied after every test. The origin is NOT in here; it outlives the
 *  tests by design and is removed once, below. */
const made: string[] = [];

beforeAll(async () => {
  tempRoot = await realpath(tmpdir());
  originRoot = await scratchDir("fe-source-origin-");
  origin = await buildBareRepo(originRoot);
});

afterEach(async () => {
  await Promise.all(made.splice(0).map(removeDir));
});

afterAll(async () => {
  await removeDir(originRoot);
});

/** A temp prefix nobody else on this machine is using, so {@link leftovers} sees THIS test's
 *  clone directories and no others — file parallelism is on (`vite.config.ts:16`). */
function privatePrefix(name: string): string {
  return `fe-source-${name}-${process.pid}-${Math.random().toString(36).slice(2, 10)}-`;
}

describe("a git URL is cloned, shallowly, into a temp directory", () => {
  it("checks out the tree at HEAD and reports kind:cloned", async () => {
    const source = await resolveSource(origin.url);
    made.push(source.dir);

    expect(source.kind).toBe("cloned");
    // Somewhere under the OS temp root, and NOT the origin — the user's repository is never
    // the thing handed back for analysis.
    expect(source.dir.startsWith(tempRoot)).toBe(true);
    expect(source.dir).not.toBe(origin.bare);

    // A real working tree, with real content, and a real `.git`.
    expect(await readFile(join(source.dir, origin.headFile), "utf8")).toBe(origin.headContent);
    expect(existsSync(join(source.dir, ".git"))).toBe(true);
  });

  it("`--depth 1` is honoured: one commit here, two at the origin", async () => {
    const source = await resolveSource(origin.url);
    made.push(source.dir);

    // The fixture has two commits precisely so this assertion can tell a shallow clone from a
    // full one (`fixtures/scratch.ts`, `buildBareRepo`).
    expect(origin.commits).toBe(2);
    expect(await gitOut(source.dir, ["rev-list", "--count", "HEAD"])).toBe("1");
    expect(await gitOut(source.dir, ["rev-parse", "--is-shallow-repository"])).toBe("true");
  });

  it("cleanup removes the checkout, and a second cleanup is not an error", async () => {
    const source = await resolveSource(origin.url);
    expect(existsSync(source.dir)).toBe(true);

    await source.cleanup();
    expect(existsSync(source.dir)).toBe(false);

    await source.cleanup();
    expect(existsSync(source.dir)).toBe(false);

    // The origin is untouched by any of it.
    expect(existsSync(origin.bare)).toBe(true);
  });

  it("two resolutions of the same URL get two independent directories", async () => {
    const a = await resolveSource(origin.url);
    const b = await resolveSource(origin.url);
    made.push(a.dir, b.dir);

    expect(a.dir).not.toBe(b.dir);

    // Cleaning one up leaves the other usable — the obligation is per-`ResolvedSource`.
    await a.cleanup();
    expect(existsSync(a.dir)).toBe(false);
    expect(await readFile(join(b.dir, origin.headFile), "utf8")).toBe(origin.headContent);
  });
});

describe("the clone refusals, and the temp directory they must not leave behind", () => {
  it("git says no → clone-failed, carrying its trimmed stderr on the side", async () => {
    const tmpPrefix = privatePrefix("cf");
    const missingOrigin = pathToFileURL(join(originRoot, "not-a-repo.git")).href;

    const err = await rejection(resolveSource(missingOrigin, { tmpPrefix }));

    expect(err.code).toBe("clone-failed");
    expect(err.input).toBe(missingOrigin);
    // Git's own words are KEPT — for a bug report or a verbose lane — but on their own field,
    // never as the message a caller is expected to render (`src/errors.ts` header).
    expect(err.gitStderr).toBeDefined();
    expect(err.gitStderr).not.toBe("");
    expect(err.gitStderr?.trim()).toBe(err.gitStderr);
    // Deliverable 1: «cleanup MUST run on failure paths too». The caller never received a
    // `ResolvedSource`, so nothing but this can be responsible for the directory.
    expect(await leftovers(tmpPrefix)).toEqual([]);
  });

  it("no git on PATH → git-not-installed, and still nothing left behind", async () => {
    const tmpPrefix = privatePrefix("gni");
    const emptyBin = await scratchDir("fe-source-nogit-");
    made.push(emptyBin);

    // PATH manipulation in the CHILD's environment (brief B1 deliverable 3). `env` REPLACES
    // `process.env` for the spawn (`ResolveSourceOptions.env`), so the runner's own environment
    // is untouched and this suite stays parallel-safe: git is missing for this one `execFile`
    // and for nothing else.
    const err = await rejection(resolveSource(origin.url, { tmpPrefix, env: { PATH: emptyBin } }));

    expect(err.code).toBe("git-not-installed");
    // Distinguished from `clone-failed` by the spawn error, not by parsing text — so a git that
    // exists and merely refuses can never be reported as an absent git.
    expect(err.gitStderr).toBeUndefined();
    expect(await leftovers(tmpPrefix)).toEqual([]);
  });

  it("a `.git` path that does not exist is a clone attempt, not path-not-found", async () => {
    const tmpPrefix = privatePrefix("suffix");
    // No scheme at all — this is decision-order step 3: nothing is at that path, and the `.git`
    // suffix is what routes it to git rather than to a «no such directory» refusal.
    const err = await rejection(
      resolveSource(join(originRoot, "absent-checkout.git"), { tmpPrefix }),
    );

    expect(err.code).toBe("clone-failed");
    expect(await leftovers(tmpPrefix)).toEqual([]);
  });
});

describe("there is no shell for a source argument to escape into", () => {
  it("shell metacharacters in the input are inert data", async () => {
    const tmpPrefix = privatePrefix("shell");
    const marker = join(originRoot, "pwned.txt");
    // If any part of this reached `/bin/sh`, the `;` would end the clone command and `touch`
    // would run. `execFile` hands the OS an argv array and `--` closes git's own option
    // parsing, so the whole string is one repository operand that git simply cannot find.
    const hostile = `${origin.url}; touch ${marker}`;

    const err = await rejection(resolveSource(hostile, { tmpPrefix }));

    expect(err.code).toBe("clone-failed");
    expect(existsSync(marker)).toBe(false);
    expect(await leftovers(tmpPrefix)).toEqual([]);
  });
});
