/**
 * `@smart-tools/fe-testkit` — the shared TEST machinery, and nothing else.
 *
 * Three things live here, and design 2.1:159-163 named all three: the fake MCP HTTP server
 * (`./fakeMcp.ts`), the DSL fixtures and their loaders (`./fixtures.ts`), and the scratch-space
 * primitive below.
 *
 * Two standing rules for this package (design 2.1:161-162): it is PRIVATE — never published,
 * never part of the shipped bundle, imported only from `tests/` — and it takes no runtime
 * dependency beyond node builtins, so nothing it pulls in can ever reach `dist/main.mjs`.
 * Both still hold after 3.4: `./fakeMcp.ts` imports `node:crypto`, `node:http` and `node:net`
 * and nothing else, and `./fixtures.ts` re-exports a source-level module. The one third-party
 * name this package knows, `@smart-tools/pixso-core`, appears ONLY in `tests/` — it is the
 * real client the fake server is proven against (`tests/fakeMcp.test.ts`) — and is declared a
 * devDependency, so `src/` stays importable with nothing installed but node.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export {
  GET_ALL_COMPONENTS,
  GET_NODE_DSL,
  startFakeMcp,
  type FakeMcp,
  type FakeMcpCall,
  type FakeMcpOptions,
} from "./fakeMcp.ts";
export {
  CLEAN_DSL,
  DESIGN_URL,
  dslRootNode,
  dslTexts,
  EMPTY_SELECTION_DSL,
  loadDsl,
  ROOT_GUID,
  type DslFixtureName,
  type DslRootNode,
} from "./fixtures.ts";

/**
 * A fresh directory under the OS temp root.
 *
 * The tier-2 proof needs somewhere with NO `node_modules` anywhere above it to drop
 * `dist/main.mjs` into (design 2.1:176-177) — the OS temp root is that place, and every
 * suite needing scratch space should come through here rather than inventing its own path.
 */
export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Remove a directory made by {@link makeTempDir}. Idempotent — a missing dir is not an error. */
export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Every `node_modules` directory on the path from `dir` up to the filesystem root.
 *
 * WHY THIS IS A FUNCTION AND NOT A COMMENT. The zero-dependency claim is not «the bundle has
 * no `dependencies` key» — that is a manifest fact, and brief 3.4's publish-shape test pins it
 * separately. It is «copy this one file anywhere and it runs» (design 2.1:68), and the only
 * thing that can prove it is running the file somewhere Node's resolver has nowhere to fall
 * back to. Node walks `node_modules` UPWARD from the importing file, so an unresolved import
 * left in the bundle would still resolve — silently, and the test would still pass — if any
 * ancestor of the scratch directory happened to hold one. The scratch root is
 * `os.tmpdir()`-based precisely because that walk is short, but «precisely because» is a
 * belief until something checks it, so this returns the list and the caller asserts it empty.
 *
 * Returns paths, not a boolean: a failure that names the offending directory is a failure
 * someone can act on.
 */
export function nodeModulesAbove(dir: string): readonly string[] {
  const found: string[] = [];
  let current = dir;
  for (;;) {
    const candidate = join(current, "node_modules");
    if (existsSync(candidate)) found.push(candidate);
    const parent = dirname(current);
    if (parent === current) return found;
    current = parent;
  }
}
