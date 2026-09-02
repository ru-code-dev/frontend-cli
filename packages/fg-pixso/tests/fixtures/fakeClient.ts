/**
 * A COUNTING FAKE TRANSPORT — the pattern the engine uses on itself
 * (`ru-code-packages/packages/pixso-core/tests/scanHandle.test.ts:57-91`), reproduced here so
 * these suites drive the REAL core pipeline with zero network (design 2.1:149-153).
 *
 * It answers exactly one tool, `get_node_dsl`, with the fixture bytes, and refuses everything
 * else. Refusing `get_all_components` is not a shortcut: the catalogue follow-up is issued on
 * the LOCAL route only (`ru-code-packages/packages/pixso-core/src/adapters/v2/2.1.15/fetchPlan.ts:43-46`)
 * and a failed catalogue call DEGRADES the join rather than failing the scan
 * (`ru-code-packages/packages/pixso-core/src/api/scan.ts:311-315`), so refusing it is what
 * keeps the local and remote routes comparable — the same choice the engine's own suite makes
 * and for the same stated reason.
 *
 * `calls` is what makes "ONE scan, four files" provable at the seam instead of asserted about
 * the code: four files written after exactly one `get_node_dsl` is the whole claim.
 */
import type { PixsoClient } from "@smart-tools/pixso-core/node";

export interface FakeTransport {
  readonly client: PixsoClient;
  /** Every tool name the pipeline asked for, in order. */
  readonly calls: string[];
}

/** A transport that answers `get_node_dsl` with `text` and records what it was asked. */
export function fakeClient(text: string): FakeTransport {
  const calls: string[] = [];
  const client = {
    endpoint: "http://transport.invalid/mcp",
    callTimeoutMs: 1,
    listTools: () => Promise.resolve({ ok: true, tools: [], ms: 0 }),
    listToolsRaw: () => Promise.resolve({ ok: true, tools: [], ms: 0 }),
    callTool: (tool: string) => {
      calls.push(tool);
      return Promise.resolve(
        tool === "get_node_dsl"
          ? { ok: true as const, texts: [text], ms: 0 }
          : {
              ok: false as const,
              timedOut: false,
              origin: "tool" as const,
              message: "no such tool",
              ms: 0,
              httpStatus: null,
            },
      );
    },
    callToolRaw: () =>
      Promise.resolve({
        ok: false as const,
        timedOut: false,
        origin: "tool" as const,
        message: "unused",
        ms: 0,
        httpStatus: null,
      }),
  } as unknown as PixsoClient;
  return { client, calls };
}

/** A transport whose every call fails — the dead-endpoint case. */
export function deadClient(): FakeTransport {
  const calls: string[] = [];
  const refusal = {
    ok: false as const,
    timedOut: false,
    origin: "transport" as const,
    message: "connection refused",
    ms: 0,
    httpStatus: null,
  };
  const client = {
    endpoint: "http://transport.invalid/mcp",
    callTimeoutMs: 1,
    listTools: () => Promise.resolve({ ok: true, tools: [], ms: 0 }),
    listToolsRaw: () => Promise.resolve({ ok: true, tools: [], ms: 0 }),
    callTool: (tool: string) => {
      calls.push(tool);
      return Promise.resolve(refusal);
    },
    callToolRaw: () => Promise.resolve(refusal),
  } as unknown as PixsoClient;
  return { client, calls };
}
