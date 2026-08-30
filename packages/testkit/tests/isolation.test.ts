/**
 * `nodeModulesAbove` — the guard that makes the tier-2 isolation claim checkable.
 *
 * It is asserted here rather than only used in `cli/tests/bundle.integration.test.ts` for the
 * reason a helper whose whole job is to fail should always be: an `expect(helper(dir)).toEqual([])`
 * in the integration suite passes just as happily when the helper is broken and returns `[]`
 * for everything. These two cases are the calibration — one directory where the answer must be
 * empty, one where it must not — so the integration assertion means something.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { makeTempDir, nodeModulesAbove, removeTempDir } from "../src/index.ts";

const made: string[] = [];

function scratch(): string {
  const dir = makeTempDir("fe-isolation-");
  made.push(dir);
  return dir;
}

afterEach(() => {
  while (made.length > 0) removeTempDir(made.pop() as string);
});

describe("nodeModulesAbove", () => {
  it("finds nothing above a fresh temp directory — the property tier 2 relies on", () => {
    expect(nodeModulesAbove(scratch())).toEqual([]);
  });

  it("FINDS one when there is one — the case that proves the empty answer is a measurement", () => {
    const root = scratch();
    const planted = join(root, "node_modules");
    mkdirSync(planted);
    const nested = join(root, "a", "b");
    mkdirSync(nested, { recursive: true });
    // Found from two levels down, which is the direction Node's own resolver walks.
    expect(nodeModulesAbove(nested)).toEqual([planted]);
  });

  it("terminates at the filesystem root rather than looping", () => {
    // A walk that did not stop at `dirname(x) === x` would hang here instead of failing.
    expect(Array.isArray(nodeModulesAbove("/"))).toBe(true);
  });
});
