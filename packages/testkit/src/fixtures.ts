/**
 * THE DSL FIXTURES — ONE source, re-exported, never a second copy.
 *
 * Design 2.1:161-163 puts «fake MCP server, DSL fixtures, fixture loaders» in this package so
 * that tiers share machinery. Brief 3.4 deliverable 1 words the constraint precisely: the
 * fixtures are to be reused «so unit and integration tiers share ONE fixture source».
 *
 * The source already exists. Brief 3.2 wrote it at
 * `packages/fe-pixso/tests/fixtures/fakeDsl.ts`, deriving it from the engine's own builder
 * (`ru-code-packages/packages/pixso-core/dev/fixtures/fakeDsl.ts:1-56`) and recording at
 * `packages/fe-pixso/tests/fixtures/fakeDsl.ts:1-18` exactly why it is a derivation and not an
 * import — `dev/` sits outside pixso-core's `"files": ["dist"]`
 * (`ru-code-packages/packages/pixso-core/package.json:6-8`), so it does not exist in the
 * installed package and importing it would work only while the cross-repo symlink is up.
 *
 * SO THIS FILE COPIES NOTHING. It re-exports that module by relative path. The alternative —
 * a second derivation living here — is the exact failure the brief's «one fixture source»
 * clause exists to prevent: tier 1 would assert against one envelope and tier 2 against
 * another, and the day they drifted, the integration suite would still be green.
 *
 * WHY A RELATIVE PATH AND NOT A PACKAGE IMPORT. `@smart-tools/fe-pixso` publishes only its
 * built entry (`packages/fe-pixso/package.json:6-15`: `"files": ["dist"]`, one `"."` export),
 * so `tests/fixtures/` is unreachable through the exports map by construction. A relative
 * import is the only spelling that resolves, and it costs nothing at runtime: the reference is
 * source-level, so `tsdown` inlines the module into this package's own `dist` and no
 * package-graph edge from testkit to fe-pixso is created.
 *
 * WHY THE ARROW POINTS THIS WAY. The other direction — move the fixture here and have fe-pixso
 * import it — is the tidier graph, and it is what a later brief should do. It is not done here
 * because brief 3.4 confines this agent to `packages/testkit/` and
 * `cli/tests/*.integration.test.ts`; rewriting three of 3.2's green suites and adding a
 * devDependency to a package this brief may not restructure would be a bigger change than the
 * one it prevents. Recorded rather than done.
 *
 * Nothing here is executable and nothing is transformed: every export below IS 3.2's binding.
 */
import { CLEAN_DSL, EMPTY_SELECTION_DSL } from "../../fe-pixso/tests/fixtures/fakeDsl.ts";

export {
  CLEAN_DSL,
  DESIGN_URL,
  EMPTY_SELECTION_DSL,
  ROOT_GUID,
} from "../../fe-pixso/tests/fixtures/fakeDsl.ts";

/** The fixtures a caller can ask for by name. */
export type DslFixtureName = "clean" | "emptySelection";

/**
 * THE LOADER (brief 3.4 deliverable 1: «re-export loaders from testkit»).
 *
 * A name rather than a direct import so a suite that parameterises over fixtures — the fake
 * server's `dsl` option is one — names what it wants in data instead of branching on imports.
 */
export function loadDsl(name: DslFixtureName): string {
  return name === "clean" ? CLEAN_DSL : EMPTY_SELECTION_DSL;
}

/** The one root field an assertion needs, READ OUT OF the fixture rather than restated beside
 *  it. A test that hardcodes `"Card"` passes when the fixture changes and the render does not;
 *  this cannot. */
export interface DslRootNode {
  readonly guid: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/** Parse a DSL envelope and hand back its first node. Throws on an envelope with none — an
 *  empty fixture reaching an assertion that needs a root is a broken test, not a soft case. */
export function dslRootNode(dsl: string): DslRootNode {
  const root = nodesOf(dsl)[0];
  if (root === undefined) throw new Error("this DSL fixture carries no nodes");
  return {
    guid: String(root["guid"]),
    name: String(root["name"]),
    width: Number(root["width"]),
    height: Number(root["height"]),
  };
}

/**
 * Every literal string the fixture's TEXT nodes carry, in document order.
 *
 * This is the other half of «fixture-derived content»: the root's geometry ends up in the
 * `<svg>` element's own attributes, and these strings end up in its `<text>` children — so a
 * render asserted against BOTH came from this envelope and not from a cache, a default or a
 * different design.
 */
export function dslTexts(dsl: string): readonly string[] {
  return nodesOf(dsl)
    .map((node) => node["nodeText"])
    .filter((text): text is string => typeof text === "string" && text !== "");
}

function nodesOf(dsl: string): readonly Record<string, unknown>[] {
  const envelope = JSON.parse(dsl) as { pixDslNodes?: readonly Record<string, unknown>[] };
  return envelope.pixDslNodes ?? [];
}
