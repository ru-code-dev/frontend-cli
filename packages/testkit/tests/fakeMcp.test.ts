/**
 * THE FAKE SERVER IS PROVEN AGAINST THE REAL CLIENT — brief 3.4 deliverable 1's own clause:
 * «Get the protocol shape RIGHT by testing against the REAL client: prove with a testkit unit
 * test that `makePixsoClient(url).callTool("get_node_dsl", …)` from
 * `@smart-tools/pixso-core/node` succeeds against it.»
 *
 * This is the only thing that can prove it. `src/fakeMcp.ts` writes the MCP streamable-http
 * wire out by hand (it may take no runtime dependency, design 2.1:161-162), and a hand-written
 * protocol read off another library's source is exactly the kind of artifact that is subtly
 * wrong in a way no self-test would catch — a suite that drove the fake with a hand-written
 * client would be checking one of my readings against the other. So the driver here is the
 * SHIPPED `@modelcontextprotocol/sdk` client, reached exactly the way the product reaches it:
 * through `makePixsoClient` from `@smart-tools/pixso-core/node`
 * (`ru-code-packages/packages/pixso-core/src/io/client.ts:598-613`), the same factory
 * `fetchScan` itself calls (`src/api/scan.ts:279-287`).
 *
 * TIER 1, deliberately, even though it opens a socket. The tier boundary the design draws is
 * about what a suite DEPENDS ON, not about whether bytes move: tier 2 is «fake MCP server +
 * the bundled `dist/main.mjs` as a subprocess + packed-manifest assertions» (design
 * 2.1:153-156), and this file has no build artifact, no subprocess and no packed manifest in
 * it. It is a unit test of one module, whose unit happens to be a listener on `127.0.0.1:0`.
 * Putting it in tier 2 would mean the fake server's own correctness was only checked on demand,
 * while `pnpm test` shipped it untested.
 */
import { makePixsoClient } from "@smart-tools/pixso-core/node";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { CLEAN_DSL, dslRootNode, loadDsl, ROOT_GUID } from "../src/fixtures.ts";
import { type FakeMcp, GET_ALL_COMPONENTS, GET_NODE_DSL, startFakeMcp } from "../src/fakeMcp.ts";

let running: FakeMcp | null = null;

async function serving(options?: Parameters<typeof startFakeMcp>[0]): Promise<FakeMcp> {
  running = await startFakeMcp(options);
  return running;
}

afterEach(async () => {
  await running?.close();
  running = null;
});

describe("startFakeMcp — the REAL SDK client speaks to it", () => {
  it("`get_node_dsl` succeeds and returns the fixture bytes verbatim", async () => {
    const fake = await serving();
    const client = makePixsoClient(fake.url);

    const result = await client.callTool(GET_NODE_DSL, { itemId: ROOT_GUID });

    // `ok` first and with the failure text in view: an `expect(texts[0])` on a failed call
    // reports «undefined !== <envelope>», which says nothing about WHY the wire failed.
    expect(result.ok ? null : result.message).toBeNull();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.texts[0]).toBe(CLEAN_DSL);
  });

  it("binds an ephemeral loopback port — never a fixed one, never a public interface", async () => {
    const fake = await serving();
    expect(fake.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const second = await startFakeMcp();
    try {
      // Two servers at once is what a fixed port would make impossible, and it is the exact
      // shape `fileParallelism` would produce.
      expect(second.url).not.toBe(fake.url);
    } finally {
      await second.close();
    }
  });

  it("records tool, arguments and headers per call — the LOCAL route's argument spelling", async () => {
    const fake = await serving();
    const client = makePixsoClient(fake.url);

    await client.callTool(GET_NODE_DSL, { itemId: ROOT_GUID });
    await client.callTool(GET_ALL_COMPONENTS, {});

    expect(fake.calls.map((call) => call.tool)).toEqual([GET_NODE_DSL, GET_ALL_COMPONENTS]);
    // The spelling is the engine's, not this file's:
    // `ru-code-packages/packages/pixso-core/src/adapters/fetchPlan.ts:99-103`.
    expect(fake.calls[0]?.args).toEqual({ itemId: ROOT_GUID });
    expect(fake.calls[1]?.args).toEqual({});
    // No token was configured, so none may appear — the local route sends none
    // (`packages/fe-pixso/src/routing.ts:92`).
    expect(fake.calls[0]?.token).toBeUndefined();
    expect(fake.calls[0]?.headers["content-type"]).toContain("application/json");
  });

  it("the `Token` header rides on every call a token-carrying client makes", async () => {
    const fake = await serving();
    // `{ Token: … }` is exactly how the engine builds a remote client
    // (`ru-code-packages/packages/pixso-core/src/api/scan.ts:279-287`).
    const client = makePixsoClient(fake.url, undefined, { Token: "secret-token" });

    await client.callTool(GET_NODE_DSL, { file_key: "AbCdEfGh1234", guid: ROOT_GUID });
    await client.callTool(GET_NODE_DSL, { file_key: "AbCdEfGh1234", guid: ROOT_GUID });

    expect(fake.calls.map((call) => call.token)).toEqual(["secret-token", "secret-token"]);
    // `node:http` lower-cases header names; the recorder does not re-case them, it exposes the
    // lookup as `token` so no assertion has to know that.
    expect(fake.calls[0]?.headers["token"]).toBe("secret-token");
  });

  it("the initialize handshake really happens — one session per call, echoed back on it", async () => {
    const fake = await serving();
    const client = makePixsoClient(fake.url);

    await client.callTool(GET_NODE_DSL, { itemId: ROOT_GUID });
    await client.callTool(GET_NODE_DSL, { itemId: ROOT_GUID });

    // `withSession` is one connect → use → close per call
    // (`ru-code-packages/packages/pixso-core/src/io/client.ts:242-336`), so two calls are two
    // initializes and two distinct session ids…
    expect(fake.sessions).toHaveLength(2);
    expect(new Set(fake.sessions).size).toBe(2);
    // …and each call carried the id its own handshake had just been given, which is the proof
    // the handshake was a real one and not a header the fake invented.
    expect(fake.calls.map((call) => call.sessionId)).toEqual(fake.sessions);
  });

  it("`tools/list` answers, so `checkConnection` works against it too", async () => {
    const fake = await serving();
    const listed = await makePixsoClient(fake.url).listTools();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      GET_ALL_COMPONENTS,
      GET_NODE_DSL,
    ]);
  });

  it("`failing` makes ONE tool answer isError — a tool error, not a transport failure", async () => {
    const fake = await serving({ failing: [GET_ALL_COMPONENTS] });
    const client = makePixsoClient(fake.url);

    const dsl = await client.callTool(GET_NODE_DSL, { itemId: ROOT_GUID });
    const catalog = await client.callTool(GET_ALL_COMPONENTS, {});

    expect(dsl.ok).toBe(true);
    expect(catalog.ok).toBe(false);
    if (catalog.ok) return;
    // The engine's own classification of an `isError` result: origin `tool`, and NO http
    // status, because a 200 carrying `isError` is not an HTTP failure
    // (`ru-code-packages/packages/pixso-core/src/io/client.ts:545-556`).
    expect(catalog.origin).toBe("tool");
    expect(catalog.httpStatus).toBeNull();
  });

  it("an unknown tool is refused as a tool error rather than crashing the session", async () => {
    const fake = await serving();
    const client = makePixsoClient(fake.url);
    const bogus = await client.callTool("no_such_tool", {});
    expect(bogus.ok).toBe(false);
    if (bogus.ok) return;
    expect(bogus.origin).toBe("tool");
    // The session survived it: the next real call still works.
    const dsl = await client.callTool(GET_NODE_DSL, { itemId: ROOT_GUID });
    expect(dsl.ok).toBe(true);
  });

  it("`dsl` is configurable, and `loadDsl` is what names the alternative", async () => {
    const fake = await serving({ dsl: loadDsl("emptySelection") });
    const result = await makePixsoClient(fake.url).callTool(GET_NODE_DSL, { itemId: ROOT_GUID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.texts[0]).toBe(loadDsl("emptySelection"));
    expect(result.texts[0]).not.toBe(CLEAN_DSL);
  });

  it("`close()` really stops it — a call afterwards is a transport failure, not a hang", async () => {
    const fake = await startFakeMcp();
    const { url } = fake;
    await fake.close();
    const result = await makePixsoClient(url, 4000).callTool(GET_NODE_DSL, { itemId: ROOT_GUID });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("transport");
  });
});

describe("the fixtures are ONE source, shared with tier 1", () => {
  it("`dslRootNode` reads the root out of the fixture instead of restating it", () => {
    const root = dslRootNode(CLEAN_DSL);
    expect(root.guid).toBe(ROOT_GUID);
    expect(root.name).not.toBe("");
    expect(root.width).toBeGreaterThan(0);
    expect(root.height).toBeGreaterThan(0);
  });

  it("the re-export IS fe-pixso's module — not a copy that can drift", async () => {
    // Identity, not equality: if this file ever grew its own derivation, the two bindings
    // would be different strings the day one of them changed. `toBe` on the imported binding
    // is what makes «one fixture source» a checked fact rather than a comment.
    const fePixso = await import("../../fe-pixso/tests/fixtures/fakeDsl.ts");
    expect(CLEAN_DSL).toBe(fePixso.CLEAN_DSL);
    expect(ROOT_GUID).toBe(fePixso.ROOT_GUID);
  });
});
