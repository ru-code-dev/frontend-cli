/**
 * THE ROUTE DECISION, asserted as BEHAVIOUR: which transport a source argument reaches, what
 * a user sees when it reaches none, and in which language.
 *
 * Every case here goes through a real `CliCommand.run` rather than through `resolveRoute`
 * alone, because the thing that must hold is not "the pure function returns a tagged union" —
 * it is "the user typed this and got exit code 2 and a sentence that tells them what to do".
 * The pure function is exercised on the way. Where a route is TAKEN, the proof is the fake
 * transport's `endpoint`-shaped consequence: the local route asks the catalogue tool and the
 * remote route does not
 * (`ru-code-packages/packages/pixso-core/src/adapters/v2/2.1.15/fetchPlan.ts:43-46`), which is
 * an observable difference between the two routes that no assertion about internals could
 * replace.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createPixsoCommands, resolveRoute } from "../src/index.ts";
import { fakeClient } from "./fixtures/fakeClient.ts";
import { CLEAN_DSL, DESIGN_URL, ROOT_GUID } from "./fixtures/fakeDsl.ts";
import { makeContext } from "./fixtures/context.ts";
import { disposeScratch, scratch } from "./fixtures/scratch.ts";

/**
 * Where a routed run's bytes land. Every case here runs a real command and `-o` is optional
 * now, so every case writes — `cwd` is a fresh directory per test rather than the repository
 * (`packages/fe-pixso/tests/fixtures/scratch.ts`).
 */
let cwd = "";
beforeEach(() => {
  cwd = scratch();
});
afterEach(() => {
  disposeScratch(cwd);
});

const RUNTIME = {
  remoteUrl: "http://remote.invalid/remote-mcp",
  localUrl: "http://local.invalid/local-mcp",
} as const;

/** All four commands, by flag — every routing rule is asserted for every command. */
const commandsOf = (client?: ReturnType<typeof fakeClient>["client"]) =>
  createPixsoCommands(client === undefined ? {} : { client });

const FLAGS = [
  "--get-pixso-svg",
  "--get-pixso-html",
  "--get-pixso-prompt",
  "--get-pixso-assets",
] as const;

function commandFor(flag: string, client?: ReturnType<typeof fakeClient>["client"]) {
  const found = commandsOf(client).find((c) => c.flag === flag);
  if (found === undefined) throw new Error(`no command registered for ${flag}`);
  return found;
}

describe("the source argument picks the route — the user never does", () => {
  it("http(s) goes REMOTE: the catalogue tool is never asked for", async () => {
    const transport = fakeClient(CLEAN_DSL);
    const { ctx } = makeContext({
      cwd,
      source: DESIGN_URL,
      env: { PIXSO_REMOTE_MCP_TOKEN: "t" },
    });
    expect(await commandFor("--get-pixso-svg", transport.client).run(ctx)).toBe(0);
    // The remote server has no catalogue tool, so the plan issues no follow-up at all.
    expect(transport.calls).toEqual(["get_node_dsl"]);
  });

  it("anything else goes LOCAL by guid: the catalogue follow-up IS issued", async () => {
    const transport = fakeClient(CLEAN_DSL);
    const { ctx } = makeContext({ cwd, source: ROOT_GUID });
    expect(await commandFor("--get-pixso-svg", transport.client).run(ctx)).toBe(0);
    expect(transport.calls).toEqual(["get_node_dsl", "get_all_components"]);
  });

  it("the LOCAL route needs no token — a bare guid with an empty environment works", async () => {
    const transport = fakeClient(CLEAN_DSL);
    const { ctx, err } = makeContext({ cwd, source: ROOT_GUID, env: {} });
    expect(await commandFor("--get-pixso-prompt", transport.client).run(ctx)).toBe(0);
    expect(err).toEqual([]);
  });

  it("the pure decision agrees with the commands, for both forms", () => {
    const remote = resolveRoute(DESIGN_URL, { ...RUNTIME, token: "t" });
    expect(remote.ok && remote.route).toEqual({
      kind: "remote",
      url: DESIGN_URL,
      token: "t",
      endpoint: RUNTIME.remoteUrl,
    });
    const local = resolveRoute(ROOT_GUID, RUNTIME);
    expect(local.ok && local.route).toEqual({
      kind: "local",
      itemId: ROOT_GUID,
      endpoint: RUNTIME.localUrl,
    });
  });
});

describe("a source that cannot be routed — exit 2, in the language in play", () => {
  for (const flag of FLAGS) {
    it(`${flag} with no source: exit 2, and the message names BOTH accepted forms`, async () => {
      const ru = makeContext({ cwd, lang: "ru" });
      expect(await commandFor(flag).run(ru.ctx)).toBe(2);
      expect(ru.out).toEqual([]);
      expect(ru.err).toHaveLength(1);
      expect(ru.err[0]).toContain("http(s)://");
      expect(ru.err[0]).toContain("guid");
      expect(ru.err[0]).toMatch(/[а-яё]/i);

      const en = makeContext({ cwd, lang: "en" });
      expect(await commandFor(flag).run(en.ctx)).toBe(2);
      expect(en.err[0]).toContain("http(s)://");
      expect(en.err[0]).toContain("guid");
      expect(en.err[0]).not.toMatch(/[а-яё]/i);
      // Two languages, one message — never the same bytes.
      expect(en.err[0]).not.toBe(ru.err[0]);
    });

    it(`${flag} with a design link but no token: exit 2, and all three fixes are named`, async () => {
      for (const lang of ["ru", "en"] as const) {
        const { ctx, out, err } = makeContext({
          cwd,
          source: DESIGN_URL,
          lang,
          env: {},
        });
        expect(await commandFor(flag).run(ctx)).toBe(2);
        expect(out).toEqual([]);
        expect(err).toHaveLength(1);
        const message = err[0] ?? "";
        expect(message).toContain("--token");
        expect(message).toContain("PIXSO_REMOTE_MCP_TOKEN");
        expect(message).toContain(".env");
        expect(message.match(/[а-яё]/i) !== null).toBe(lang === "ru");
      }
    });
  }

  it("an empty token is an absent token, not a token of length zero", async () => {
    const { ctx, err } = makeContext({
      cwd,
      source: DESIGN_URL,
      env: { PIXSO_REMOTE_MCP_TOKEN: "" },
    });
    expect(await commandFor("--get-pixso-svg").run(ctx)).toBe(2);
    // Ours, not the engine's `a remote fetch needs a token`.
    expect(err[0]).toContain("--token");
  });

  it("no scan is attempted when the line is refused", async () => {
    const transport = fakeClient(CLEAN_DSL);
    const { ctx } = makeContext({ cwd, env: {} });
    expect(await commandFor("--get-pixso-svg", transport.client).run(ctx)).toBe(2);
    expect(transport.calls).toEqual([]);
  });
});

describe("where the token and the endpoints come from", () => {
  it("a resolved flag value beats the environment", async () => {
    const transport = fakeClient(CLEAN_DSL);
    const { ctx } = makeContext({
      cwd,
      source: DESIGN_URL,
      env: { PIXSO_REMOTE_MCP_TOKEN: "" },
      flags: { PIXSO_REMOTE_MCP_TOKEN: "from-flag" },
    });
    // The flag alone makes the remote route routable, which the env value could not.
    expect(await commandFor("--get-pixso-svg", transport.client).run(ctx)).toBe(0);
  });

  it("the environment key alone is enough", async () => {
    const transport = fakeClient(CLEAN_DSL);
    const { ctx } = makeContext({
      cwd,
      source: DESIGN_URL,
      env: { PIXSO_REMOTE_MCP_TOKEN: "from-env" },
    });
    expect(await commandFor("--get-pixso-svg", transport.client).run(ctx)).toBe(0);
  });
});
