/**
 * TIER 2 — THE PUBLISH SHAPE (brief 3.4 deliverable 2, design 2.1:62-69, 2.1:182-183).
 *
 * THE CLAIM UNDER TEST is the one thing about this package a user meets before running
 * anything: `npm i -g @smart-tools/frontend-cli` installs ONE file and pulls in NOTHING. The
 * design's mechanism for it is unusual enough to be worth re-proving on every change — every
 * runtime dependency is declared a **devDependency** and inlined at build time, so the
 * published manifest has no `dependencies` field at all (2.1:59-60). That arrangement is one
 * careless `pnpm add` away from silently becoming a normal dependency graph, and nothing in
 * `pnpm build`, `pnpm test` or `pnpm typecheck` would notice.
 *
 * SO THE ARTIFACT IS PACKED, NOT INSPECTED. Reading `cli/package.json` and asserting it has no
 * `dependencies` key would prove a fact about a source file. What ships is what `pnpm pack`
 * writes, after pnpm has applied whatever manifest rewriting it does (`workspace:*` ranges are
 * rewritten on publish, for instance) — so the assertions below are made against the manifest
 * EXTRACTED FROM THE TARBALL, and the file list is the tarball's own, not the `files` field's
 * promise about it.
 *
 * A separate file from `bundle.integration.test.ts` because it answers a different question
 * with a different apparatus: no fake server, no subprocess runs of the bundle, one slow
 * `pnpm pack`. `cli/vite.config.ts:63` runs the integration lane with `fileParallelism: false`,
 * so the two do not contend.
 */
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { makeTempDir, removeTempDir } from "@smart-tools/fe-testkit";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const run = promisify(execFile);

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtBundle = join(packageRoot, "dist", "main.mjs");

interface PackedManifest {
  readonly name: string;
  readonly version: string;
  readonly bin?: Readonly<Record<string, string>>;
  readonly files?: readonly string[];
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly peerDependencies?: unknown;
  readonly optionalDependencies?: unknown;
}

let scratch = "";
/** Where the tarball was unpacked; `tar` writes everything under a single `package/` root. */
let extracted = "";
let packed: PackedManifest;
let entries: readonly string[] = [];

beforeAll(async () => {
  scratch = makeTempDir("fe-pack-");
  extracted = join(scratch, "extracted");
  mkdirSync(extracted);

  // Packed into the scratch directory rather than into `cli/`, so a failed run cannot leave a
  // tarball behind in the working tree.
  await run("pnpm", ["pack", "--pack-destination", scratch], {
    cwd: packageRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const tarballs = readdirSync(scratch).filter((name) => name.endsWith(".tgz"));
  expect(tarballs).toHaveLength(1);
  const tarball = join(scratch, tarballs[0] as string);

  // The tarball's OWN listing, before extraction — this is the file set npm would install,
  // and it is what makes the `files` field a checked claim instead of a stated one.
  const listing = await run("tar", ["-tzf", tarball], { encoding: "utf8" });
  entries = listing.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.endsWith("/"))
    .sort();

  await run("tar", ["-xzf", tarball, "-C", extracted], { encoding: "utf8" });
  packed = JSON.parse(
    readFileSync(join(extracted, "package", "package.json"), "utf8"),
  ) as PackedManifest;
}, 300_000);

afterAll(() => {
  if (scratch !== "") removeTempDir(scratch);
});

describe("the packed tarball", () => {
  it("declares NO runtime dependencies of any kind — the zero-dep publish", () => {
    // `dependencies` ABSENT, per the brief, and not merely empty: an empty object would mean
    // someone added and removed one, and the next addition would be invisible.
    expect(Object.hasOwn(packed, "dependencies")).toBe(false);
    // The three other channels through which a dependency could reach an installer. The
    // design's arrangement puts everything in devDependencies precisely because npm does not
    // install those for a consumer — but a `peerDependencies` or `optionalDependencies` entry
    // would install (or prompt) all the same, and nothing else in this repo looks at them.
    expect(Object.hasOwn(packed, "peerDependencies")).toBe(false);
    expect(Object.hasOwn(packed, "optionalDependencies")).toBe(false);
  });

  it("carries no devDependency into the published manifest either", () => {
    // Not required for correctness — npm ignores devDependencies on install — but it is the
    // clause the brief words as "NO `dependencies`/`devDependencies` carried into runtime
    // deps", and a packed manifest still listing `@smart-tools/fe-pixso": "workspace:*"` would
    // be a broken spec for anyone reading the published package.
    const dev = packed.devDependencies;
    if (dev !== undefined) {
      // If pnpm keeps the block, nothing in it may be a workspace range: those cannot resolve
      // for an installer.
      const ranges = Object.values(dev as Record<string, string>);
      expect(ranges.filter((range) => range.startsWith("workspace:"))).toEqual([]);
    }
  });

  it("`bin.fe` points at dist/main.mjs", () => {
    expect(packed.bin?.["fe"]).toBe("./dist/main.mjs");
  });

  it("`files` is dist and nothing else", () => {
    expect(packed.files).toEqual(["dist"]);
  });

  it("and the tarball's own contents agree — package.json plus ONE dist file", () => {
    // The `files` field is a request; this is what the request produced. A stray `src/`,
    // a sourcemap or a second chunk would show up here and nowhere else.
    expect(entries).toEqual(["package/dist/main.mjs", "package/package.json"]);
  });

  it("the packed dist/main.mjs is BYTE-IDENTICAL to the one `pnpm build` emitted", () => {
    const fromTarball = readFileSync(join(extracted, "package", "dist", "main.mjs"));
    const fromBuild = readFileSync(builtBundle);
    // `.equals` rather than a string compare: this is the claim that what was tested in
    // `bundle.integration.test.ts` — that exact file, run as a subprocess — is the artifact
    // that ships. A re-transform, a shebang rewrite or a line-ending change on the way into
    // the tarball would break the link between the two suites, and a text comparison could
    // hide the last of those.
    expect(fromTarball.equals(fromBuild)).toBe(true);
    expect(fromBuild.length).toBeGreaterThan(0);
  });

  it("names and versions the package the manifest says it does", () => {
    const source = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      readonly name: string;
      readonly version: string;
    };
    expect(packed.name).toBe(source.name);
    expect(packed.version).toBe(source.version);
    // The one publishable package in the workspace carries no `private` key; every other one
    // does (design 2.1:69). A `private: true` that crept in here would make `pnpm publish`
    // refuse, long after the fact.
    expect(Object.hasOwn(packed, "private")).toBe(false);
  });
});
