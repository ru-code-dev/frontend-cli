/**
 * A FAKE PIXSO MCP SERVER — a real `node:http` listener, not a mock of the SDK.
 *
 * WHY A REAL SERVER. The thing tier 2 exists to prove is that the SHIPPED bundle talks to a
 * real endpoint over a real socket: `dist/main.mjs` is a separate process, so there is no
 * seam to inject a fake client into (`FetchScanOptions.client`, the tier-1 seam, lives
 * in-process and cannot cross `execFile`). The only substitutable thing left is the endpoint
 * itself. That is also the pattern `pixso-core` uses on itself — `ioFailureKinds.test.ts:20-24`
 * states it outright: «REAL SERVERS, NOT MOCKS … A mock of the SDK would prove nothing here,
 * because the thing under test is precisely how the SDK's own error objects are read.» Its
 * `serving()` helper (`:80-93`) binds `127.0.0.1:0` and hands back the `/mcp` URL; this is the
 * same helper with a protocol on top.
 *
 * WHY HAND-ROLLED JSON-RPC RATHER THAN THE SDK'S SERVER. `pixso-core`'s own richer fake
 * (`dev/fake-mcp/fakePixsoMcp.ts:104-105`) mounts `McpServer` + `StreamableHTTPServerTransport`.
 * This package cannot: design 2.1:161-162 fixes that testkit «takes no runtime dependency
 * beyond node builtins», which is the property that guarantees nothing importable from here
 * can ever reach `dist/main.mjs`. So the wire is written out by hand — and, because a
 * hand-written protocol is exactly the kind of thing that is subtly wrong, it is not trusted:
 * `tests/fakeMcp.test.ts` drives the REAL `@modelcontextprotocol/sdk` client at it through
 * `makePixsoClient` from `@smart-tools/pixso-core/node`, which is the only evidence that
 * counts.
 *
 * THE SURFACE, read off the pinned client rather than off the spec
 * (`node_modules/.pnpm/@modelcontextprotocol+sdk@1.26.0…/dist/esm/client/streamableHttp.js`):
 *
 *   POST, body carries an `id`  → 200 `application/json`, one JSON-RPC response object
 *                                 (`:384-403` — a non-streaming server may answer plain JSON).
 *   POST, body carries no `id`  → 202, empty body (`:369-371`). This is the
 *                                 `notifications/initialized` path.
 *   GET                         → 405. The client opens a standalone SSE stream right after
 *                                 the initialized notification (`:374-377`) and treats 405 as
 *                                 «this server offers no GET stream» rather than an error
 *                                 (`:100-103`). Refusing it is a legal, and simpler, server.
 *   `mcp-session-id` on the initialize response → the client echoes it on every later request
 *                                 (`:66-68, 307-310`), which is what makes the recorded
 *                                 headers a session and not three unrelated calls.
 *
 * The protocol version is ECHOED, never invented: the client refuses a version outside its own
 * `SUPPORTED_PROTOCOL_VERSIONS` (`dist/esm/client/index.js:304-306`), and the one value
 * guaranteed to be in that list is the one it just asked for.
 *
 * THE TOOL VOCABULARY is Pixso's two, and their argument spellings are the engine's, not
 * invented here (`ru-code-packages/packages/pixso-core/src/adapters/fetchPlan.ts:99-103` and
 * `src/adapters/v2/2.1.15/fetchPlan.ts:29-31, 55-58`):
 *
 *   `get_node_dsl`        both routes. LOCAL sends `{ itemId }`, REMOTE `{ file_key, guid }`.
 *   `get_all_components`  LOCAL only — «the remote server does not offer it».
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

// The DSL the server answers with by default is the fe-pixso fixture itself, re-exported
// through `./fixtures.ts` so tier 1 and tier 2 read the same bytes — see that file's header.
import { CLEAN_DSL } from "./fixtures.ts";

/** The DSL payload tool both routes call. */
export const GET_NODE_DSL = "get_node_dsl";
/** The catalogue tool the LOCAL route follows up with. */
export const GET_ALL_COMPONENTS = "get_all_components";

/**
 * ONE recorded `tools/call`.
 *
 * `headers` are as `node:http` delivers them: **lower-cased names**, which is the HTTP/1.1
 * normalization Node applies to every request, not a choice made here. The remote token
 * therefore arrives under `token`, though `pixso-core` spells the header `Token` when it
 * builds the client (`ru-code-packages/packages/pixso-core/src/api/scan.ts:279-287`).
 * {@link FakeMcpCall.token} is that lookup done once, so a test asserting the token never has
 * to know about the case folding.
 */
export interface FakeMcpCall {
  /** The tool name from `params.name`. */
  readonly tool: string;
  /** `params.arguments`, verbatim — the engine's own argument spelling is the thing under test. */
  readonly args: Readonly<Record<string, unknown>>;
  /** Every request header, lower-cased by `node:http`. */
  readonly headers: Readonly<Record<string, string>>;
  /** The `Token` header if one rode along, else `undefined`. */
  readonly token: string | undefined;
  /** The session this call belongs to — the id handed out at `initialize`. */
  readonly sessionId: string | undefined;
}

export interface FakeMcpOptions {
  /** The text `get_node_dsl` answers with. Defaults to {@link CLEAN_DSL}. */
  readonly dsl?: string;
  /** The text `get_all_components` answers with. Defaults to an empty JSON catalogue. */
  readonly components?: string;
  /**
   * Tools that must answer `isError: true` instead of their payload. A tool-level error is
   * DATA to the engine, not a transport failure
   * (`ru-code-packages/packages/pixso-core/src/io/client.ts:545-557`), which is what makes
   * this the honest way to fail one call without breaking the session.
   */
  readonly failing?: readonly string[];
  /** The name this server reports at `initialize`. Cosmetic; the client does not check it. */
  readonly serverName?: string;
}

export interface FakeMcp {
  /** The endpoint to hand a client — `http://127.0.0.1:<port>/mcp`. */
  readonly url: string;
  /**
   * Every `tools/call` this server answered, in order. LIVE: the array is the recorder itself,
   * so a test may hold it before the calls happen and read it after.
   */
  readonly calls: readonly FakeMcpCall[];
  /** Every session id handed out, in order — one per `initialize`. */
  readonly sessions: readonly string[];
  /** Stops listening and drops keep-alive sockets. Idempotent. */
  close: () => Promise<void>;
}

/** An empty catalogue: a call that SUCCEEDED with nothing in it, which the engine joins as an
 *  empty catalogue rather than treating as an absent one
 *  (`ru-code-packages/packages/pixso-core/src/adapters/v2/2.1.15/fetchPlan.ts:59-63`). */
const EMPTY_CATALOG = JSON.stringify({ components: [] });

const JSON_RPC_METHOD_NOT_FOUND = -32601;

interface JsonRpcMessage {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, payload: unknown, sessionId?: string): void {
  const body = JSON.stringify(payload);
  response.writeHead(200, {
    "content-type": "application/json",
    ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId }),
  });
  response.end(body);
}

function textResult(text: string, isError = false): Record<string, unknown> {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

/** Header names arrive lower-cased and values may be arrays (`set-cookie` and friends); flatten
 *  to the one shape an assertion wants. */
function headersOf(request: IncomingMessage): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    flat[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return flat;
}

function argsOf(params: unknown): Record<string, unknown> {
  if (typeof params !== "object" || params === null) return {};
  const args = (params as { arguments?: unknown }).arguments;
  return typeof args === "object" && args !== null ? { ...(args as Record<string, unknown>) } : {};
}

/**
 * Bind a fake Pixso MCP server on an ephemeral loopback port.
 *
 * Ephemeral (`:0`) and loopback (`127.0.0.1`) for the reason `pixso-core`'s own helper gives by
 * doing the same (`tests/ioFailureKinds.test.ts:89`): a fixed port makes two suites — or two
 * runs — collide, and a non-loopback bind puts a test server on the network.
 */
export async function startFakeMcp(options: FakeMcpOptions = {}): Promise<FakeMcp> {
  const dsl = options.dsl ?? CLEAN_DSL;
  const components = options.components ?? EMPTY_CATALOG;
  const failing = new Set(options.failing ?? []);
  const serverName = options.serverName ?? "fe-testkit-fake-pixso";

  const calls: FakeMcpCall[] = [];
  const sessions: string[] = [];

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    // The client's standalone SSE stream. 405 is the documented «no GET stream here» answer
    // and is NOT an error to it (SDK `client/streamableHttp.js:100-103`).
    if (request.method !== "POST") {
      response.writeHead(405, { allow: "POST" });
      response.end();
      return;
    }

    const raw = await readBody(request);
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(raw) as JsonRpcMessage;
    } catch {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("malformed JSON-RPC body");
      return;
    }

    // A notification (no `id`) gets 202 with no body — `notifications/initialized` is the one
    // that actually arrives (SDK `client/streamableHttp.js:369-377`).
    if (message.id === undefined || message.id === null) {
      response.writeHead(202);
      response.end();
      return;
    }

    const id = message.id;
    const method = message.method;
    const sessionHeader = request.headers["mcp-session-id"];
    const sessionId = typeof sessionHeader === "string" ? sessionHeader : undefined;

    if (method === "initialize") {
      const requested = (message.params as { protocolVersion?: unknown } | undefined)
        ?.protocolVersion;
      const issued = randomUUID();
      sessions.push(issued);
      sendJson(
        response,
        {
          jsonrpc: "2.0",
          id,
          result: {
            // ECHOED, not chosen — see the module header.
            protocolVersion: typeof requested === "string" ? requested : "2025-03-26",
            // What a real server declares. NOT load-bearing for this client, and the
            // difference was MEASURED rather than assumed: the SDK's
            // `assertCapabilityForMethod` does refuse `tools/call` against a server with no
            // `tools` capability (`client/index.js:372-376`), but `Protocol.request` only
            // calls it when `enforceStrictCapabilities` is set, and `pixso-core` constructs
            // its `Client` without that option
            // (`ru-code-packages/packages/pixso-core/src/io/client.ts:249`). Dropping this
            // key reds nothing — checked this session. It stays because a fake whose
            // handshake differs from a real server's is a fake that will mislead the first
            // caller who does turn strict mode on.
            capabilities: { tools: {} },
            serverInfo: { name: serverName, version: "0.0.0" },
          },
        },
        issued,
      );
      return;
    }

    if (method === "ping") {
      sendJson(response, { jsonrpc: "2.0", id, result: {} });
      return;
    }

    if (method === "tools/list") {
      sendJson(response, {
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: GET_NODE_DSL,
              description: "Fetch the DSL envelope for one node.",
              inputSchema: {
                type: "object",
                properties: {
                  itemId: { type: "string" },
                  file_key: { type: "string" },
                  guid: { type: "string" },
                },
              },
            },
            {
              name: GET_ALL_COMPONENTS,
              description: "The local plugin's component catalogue.",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      });
      return;
    }

    if (method === "tools/call") {
      const params = message.params;
      const tool =
        typeof params === "object" && params !== null
          ? String((params as { name?: unknown }).name ?? "")
          : "";
      const headers = headersOf(request);
      const token = headers["token"];
      calls.push({
        tool,
        args: argsOf(params),
        headers,
        token,
        sessionId,
      });

      if (failing.has(tool)) {
        sendJson(response, {
          jsonrpc: "2.0",
          id,
          result: textResult(`${tool} refused by the fake server`, true),
        });
        return;
      }
      if (tool === GET_NODE_DSL) {
        sendJson(response, { jsonrpc: "2.0", id, result: textResult(dsl) });
        return;
      }
      if (tool === GET_ALL_COMPONENTS) {
        sendJson(response, { jsonrpc: "2.0", id, result: textResult(components) });
        return;
      }
      // An unknown TOOL is a tool-level error, not a protocol error: the server is fine, the
      // request named something it does not have.
      sendJson(response, {
        jsonrpc: "2.0",
        id,
        result: textResult(`unknown tool: ${tool}`, true),
      });
      return;
    }

    sendJson(response, {
      jsonrpc: "2.0",
      id,
      error: { code: JSON_RPC_METHOD_NOT_FOUND, message: `unknown method: ${String(method)}` },
    });
  };

  const server: Server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo | null;
  const port = address === null ? 0 : address.port;

  return {
    url: `http://127.0.0.1:${String(port)}/mcp`,
    calls,
    sessions,
    close: () =>
      new Promise<void>((resolve) => {
        // Keep-alive sockets outlive the last response; without this `close()` waits for them
        // and the suite hangs on teardown.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
