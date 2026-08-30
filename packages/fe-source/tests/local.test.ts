/**
 * THE LOCAL PATH ARM — brief B1 deliverable 3's «local-path cases (ok / missing /
 * file-not-dir)», plus the two decision-order cases that only a local path can produce.
 *
 * Every assertion here is on BEHAVIOUR a caller can observe: which `kind` came back, whether
 * the directory still exists after `cleanup()`, and which `code` a refusal carries. Nothing
 * reaches into the module's internals, and no message text is matched (`fixtures/rejection.ts`
 * says why).
 */
import { existsSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { resolveSource } from "../src/index.ts";
import { rejection } from "./fixtures/rejection.ts";
import { removeDir, scratchDir } from "./fixtures/scratch.ts";

const made: string[] = [];

/** One scratch root per test, all of them removed afterwards — a suite that leaks temp
 *  directories while testing a function whose job is not to leak temp directories would be
 *  hard to take seriously. */
async function root(): Promise<string> {
  const dir = await scratchDir("fe-source-local-");
  made.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(made.splice(0).map(removeDir));
});

describe("an existing directory is used where it is", () => {
  it("comes back as kind:local, at its realpath, and cleanup leaves it alone", async () => {
    const dir = await root();
    await writeFile(join(dir, "package.json"), "{}\n");

    const source = await resolveSource(dir);

    expect(source.kind).toBe("local");
    expect(source.dir).toBe(dir);

    // THE POINT OF `kind: "local"`: cleanup is a no-op, so a caller's
    // `try { … } finally { await src.cleanup() }` cannot delete the user's own project.
    await source.cleanup();
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(dir, "package.json"))).toBe(true);

    // …and calling it twice is still nothing happening.
    await source.cleanup();
    expect(existsSync(dir)).toBe(true);
  });

  it("resolves symlinks: `dir` is the real directory, not the link that was typed", async () => {
    const dir = await root();
    const real = join(dir, "real-project");
    const link = join(dir, "link-to-project");
    await mkdir(real);
    await symlink(real, link, "dir");

    const source = await resolveSource(link);

    expect(source.dir).toBe(real);
    expect(source.dir).not.toBe(link);
    expect(source.kind).toBe("local");
  });
});

describe("the two local refusals", () => {
  it("a path that is not there → path-not-found, carrying the input verbatim", async () => {
    const dir = await root();
    const missing = join(dir, "no-such-project");

    const err = await rejection(resolveSource(missing));

    expect(err.code).toBe("path-not-found");
    expect(err.input).toBe(missing);
    // The stderr channel belongs to `clone-failed` alone; nothing else may put words there.
    expect(err.gitStderr).toBeUndefined();
  });

  it("a file where a directory was expected → not-a-directory", async () => {
    const dir = await root();
    const file = join(dir, "index.html");
    await writeFile(file, "<main>not a project</main>\n");

    const err = await rejection(resolveSource(file));

    expect(err.code).toBe("not-a-directory");
    expect(err.input).toBe(file);
  });

  it("the empty string is a missing path, not a crash", async () => {
    const err = await rejection(resolveSource(""));
    expect(err.code).toBe("path-not-found");
  });
});

describe("what exists wins over what looks like a URL", () => {
  it("a directory literally named `…/repo.git` is analyzed, never cloned", async () => {
    const dir = await root();
    const bareLooking = join(dir, "checkout.git");
    await mkdir(bareLooking);
    await writeFile(join(bareLooking, "app.tsx"), "export const App = () => null;\n");

    // `isGitUrl` says true for this string (`.git` suffix). The filesystem says directory.
    // Decision order (`src/resolve.ts` header, steps 2-3) puts the filesystem first, so this
    // is `local` — the alternative would hand a user's own working copy to `git clone`.
    const source = await resolveSource(bareLooking);

    expect(source.kind).toBe("local");
    expect(source.dir).toBe(bareLooking);
    await source.cleanup();
    expect(existsSync(join(bareLooking, "app.tsx"))).toBe(true);
  });

  it("a FILE named `…/repo.git` is not-a-directory, not a clone attempt", async () => {
    const dir = await root();
    const file = join(dir, "bundle.git");
    await writeFile(file, "not a repository\n");

    const err = await rejection(resolveSource(file));

    expect(err.code).toBe("not-a-directory");
  });
});
