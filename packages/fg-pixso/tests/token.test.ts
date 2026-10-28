/**
 * TIER 1 — `fguard token` (E1) and the token refusals of the four link commands (E2).
 *
 * Real files in a scratch directory (the bundle-side `.env` is the whole point), a recorder UI,
 * and for the rejected-token case a transport that answers the way pixso-core reports an HTTP
 * failure: `ok: false` with the status on `httpStatus`
 * (`ru-code-packages/packages/pixso-core/src/io/client.ts:140-155`). The same refusal over a REAL
 * HTTP 401 is proven on the bundle in `cli/tests/token.integration.test.ts`.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

import type { PixsoClient } from "@smart-tools/pixso-core/node";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createPixsoCommands, TOKEN_EXIT, withToken } from "../src/index.ts";
import { makeContext } from "./fixtures/context.ts";
import { DESIGN_URL } from "./fixtures/fakeDsl.ts";
import { disposeScratch, scratch } from "./fixtures/scratch.ts";

const KEY = "PIXSO_REMOTE_MCP_TOKEN";

let dir = "";
beforeEach(() => {
  dir = scratch();
});
afterEach(() => {
  disposeScratch(dir);
});

const tokenCommand = (readSecret: (prompt: string) => Promise<string> = () => Promise.resolve("")) => {
  const found = createPixsoCommands({ readSecret }).find((c) => c.flag === "token");
  if (found === undefined) throw new Error("no token command");
  return found;
};

describe("withToken — the .env line, set or replaced, proven by node's own parser", () => {
  it("a new file gets exactly one line", () => {
    expect(withToken("", "abc")).toBe(`${KEY}=abc\n`);
  });

  it("replaces every earlier definition (plain and export-prefixed) and keeps the rest", () => {
    const before = `A=1\n${KEY}=old\nexport ${KEY}=older\nB="two words"\n`;
    const after = withToken(before, "new") ?? "";
    expect(after.split("\n").filter((l) => l.includes(KEY))).toEqual([`${KEY}=new`]);
    const parsed = parseEnv(after);
    expect(parsed["A"]).toBe("1");
    expect(parsed["B"]).toBe("two words");
    expect(parsed[KEY]).toBe("new");
  });

  it("quotes only when the bare spelling would not read back", () => {
    for (const value of ["a#b", "with space", "it's", 'say "hi"', "$HOME", "x=y"]) {
      const text = withToken("", value) ?? "";
      expect(parseEnv(text)[KEY], value).toBe(value);
    }
    expect(withToken("", "plain-Token_123")).toBe(`${KEY}=plain-Token_123\n`);
  });

  it("refuses a value no spelling can carry (a newline with both quote kinds)", () => {
    expect(withToken("", `a'b"c\nd`)).toBeUndefined();
  });
});

describe("fguard token (E1)", () => {
  it("writes <binDir>/.env with mode 600 and prints the absolute path", async () => {
    const { ctx, out, ui } = makeContext({ cwd: dir, source: "tok-1", binDir: dir });
    expect(await tokenCommand().run(ctx)).toBe(0);
    const file = join(dir, ".env");
    expect(readFileSync(file, "utf8")).toBe(`${KEY}=tok-1\n`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(out.join("")).toContain(file);
    expect(ui.join("\n")).toContain(file);
  });

  it("replaces the token in an existing file, keeps its other lines, and narrows its mode", async () => {
    const file = join(dir, ".env");
    writeFileSync(file, `OTHER=keep\n${KEY}=old\n`, { mode: 0o644 });
    const { ctx } = makeContext({ cwd: dir, source: "tok-2", binDir: dir });
    expect(await tokenCommand().run(ctx)).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(`OTHER=keep\n${KEY}=tok-2\n`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("without a value asks through the hidden prompt — and never echoes the token", async () => {
    const prompts: string[] = [];
    const { ctx, out, err, ui } = makeContext({ cwd: dir, binDir: dir });
    const read = (prompt: string) => {
      prompts.push(prompt);
      return Promise.resolve("  secret-3  ");
    };
    expect(await tokenCommand(read).run(ctx)).toBe(0);
    expect(prompts).toEqual(["токен Pixso: "]);
    expect(parseEnv(readFileSync(join(dir, ".env"), "utf8"))[KEY]).toBe("secret-3");
    for (const text of [...out, ...err, ...ui]) expect(text).not.toContain("secret-3");
  });

  it("an empty answer is exit 2 and writes nothing", async () => {
    const { ctx } = makeContext({ cwd: dir, binDir: dir });
    expect(await tokenCommand().run(ctx)).toBe(2);
    expect(existsSync(join(dir, ".env"))).toBe(false);
  });

  it("an unwritable value is exit 2 and writes nothing", async () => {
    const { ctx } = makeContext({ cwd: dir, source: `a'b"c\nd`, binDir: dir });
    expect(await tokenCommand().run(ctx)).toBe(2);
    expect(existsSync(join(dir, ".env"))).toBe(false);
  });

  it("with no bundle directory it refuses (exit 1) rather than guess a place", async () => {
    const { ctx } = makeContext({ cwd: dir, source: "x" });
    expect(await tokenCommand().run(ctx)).toBe(1);
    expect(existsSync(join(dir, ".env"))).toBe(false);
  });

  it("a directory in the way is a runtime failure (exit 1)", async () => {
    mkdirSync(join(dir, ".env"));
    const { ctx } = makeContext({ cwd: dir, source: "x", binDir: dir });
    expect(await tokenCommand().run(ctx)).toBe(1);
  });
});

/** A transport whose every call fails with `status`, the way pixso-core reports an HTTP error. */
function httpFailing(status: number | null): { client: PixsoClient; calls: string[] } {
  const calls: string[] = [];
  const failure = {
    ok: false as const,
    kind: status === null ? ("transport" as const) : ("http" as const),
    timedOut: false,
    origin: "transport" as const,
    message: "",
    ms: 0,
    httpStatus: status,
  };
  const client = {
    endpoint: "http://transport.invalid/mcp",
    callTimeoutMs: 1,
    listTools: () => Promise.resolve(failure),
    listToolsRaw: () => Promise.resolve(failure),
    callTool: (tool: string) => {
      calls.push(tool);
      return Promise.resolve(failure);
    },
    callToolRaw: () => Promise.resolve(failure),
  } as unknown as PixsoClient;
  return { client, calls };
}

describe("a REJECTED token (E2) — keyed on pixso-core's httpStatus, never on prose", () => {
  for (const status of [401, 403]) {
    it(`HTTP ${String(status)} on the probe → exit ${String(TOKEN_EXIT)}, «fguard token», the .env path`, async () => {
      const transport = httpFailing(status);
      const command = createPixsoCommands({ client: transport.client }).find(
        (c) => c.flag === "--get-pixso-prompt",
      );
      const { ctx, ui } = makeContext({
        cwd: dir,
        source: DESIGN_URL,
        env: { [KEY]: "stale" },
        binDir: "/root/.app/fg/bin",
      });
      expect(await command?.run(ctx)).toBe(TOKEN_EXIT);
      const message = ui.at(-1) ?? "";
      expect(message).toContain(`HTTP ${String(status)}`);
      expect(message).toContain("fguard token <");
      expect(message).toContain("/root/.app/fg/bin/.env");
      expect(transport.calls).toEqual(["get_node_dsl"]);
    });
  }

  for (const status of [500, null]) {
    it(`a ${status === null ? "transport" : `HTTP ${String(status)}`} failure stays a runtime failure (exit 1)`, async () => {
      const transport = httpFailing(status);
      const command = createPixsoCommands({ client: transport.client }).find(
        (c) => c.flag === "--get-pixso-prompt",
      );
      const { ctx, ui } = makeContext({ cwd: dir, source: DESIGN_URL, env: { [KEY]: "t" } });
      expect(await command?.run(ctx)).toBe(1);
      expect(ui.at(-1) ?? "").not.toContain("fguard token");
    });
  }

  it("the LOCAL route (a guid) is never a token problem, even on a 401", async () => {
    const transport = httpFailing(401);
    const command = createPixsoCommands({ client: transport.client }).find(
      (c) => c.flag === "--get-pixso-prompt",
    );
    const { ctx } = makeContext({ cwd: dir, source: "11:10", env: {} });
    expect(await command?.run(ctx)).toBe(1);
  });
});
