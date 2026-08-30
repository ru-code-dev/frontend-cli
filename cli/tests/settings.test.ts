/**
 * TIER 1 — unit. The precedence chain, exercised against FABRICATED environments — which is
 * possible only because `resolveSettings` takes the environment as an argument instead of
 * reading `process.env` (brief 3.3 deliverable 5, "fake env objects").
 *
 * All three values are covered independently, because the design's rule is precedence PER VALUE
 * (design 2.1:110-111): a suite that only checked "flags win" would not notice a bug where one
 * flag flattens an unrelated setting.
 */
import { describe, expect, it } from "vite-plus/test";

import {
  PIXSO_LOCAL_MCP_URL,
  PIXSO_REMOTE_MCP_TOKEN,
  PIXSO_REMOTE_MCP_URL,
} from "../src/constants.ts";
import { SETTING_KEYS, resolveSettings, settingsToEnv } from "../src/settings.ts";

const EMPTY = {} as const;

describe("the constants are the owner's three, spelled exactly", () => {
  it("uses the owner-fixed names as the env keys", () => {
    expect(SETTING_KEYS.remoteUrl).toBe("PIXSO_REMOTE_MCP_URL");
    expect(SETTING_KEYS.localUrl).toBe("PIXSO_LOCAL_MCP_URL");
    expect(SETTING_KEYS.token).toBe("PIXSO_REMOTE_MCP_TOKEN");
  });

  it("defaults the URLs to pixso-core's own endpoint values", () => {
    // Copied from `ru-code-packages/packages/pixso-core/src/io/constants.ts:23` and `:10`.
    expect(PIXSO_REMOTE_MCP_URL).toBe("http://127.0.0.1:3667/remote-mcp");
    expect(PIXSO_LOCAL_MCP_URL).toBe("http://127.0.0.1:3667/local-mcp");
  });

  it("defaults the token to empty — a secret is never a literal in a published bundle", () => {
    expect(PIXSO_REMOTE_MCP_TOKEN).toBe("");
  });
});

describe("tier 3 — constants, when nothing else says anything", () => {
  it("falls all the way through", () => {
    expect(resolveSettings({}, EMPTY)).toEqual({
      remoteUrl: PIXSO_REMOTE_MCP_URL,
      localUrl: PIXSO_LOCAL_MCP_URL,
      token: PIXSO_REMOTE_MCP_TOKEN,
    });
  });
});

describe("tier 2 — the environment beats the constants", () => {
  it("PIXSO_REMOTE_MCP_URL", () => {
    const r = resolveSettings({}, { PIXSO_REMOTE_MCP_URL: "http://env/remote" });
    expect(r.remoteUrl).toBe("http://env/remote");
    expect(r.localUrl).toBe(PIXSO_LOCAL_MCP_URL);
  });

  it("PIXSO_LOCAL_MCP_URL", () => {
    const r = resolveSettings({}, { PIXSO_LOCAL_MCP_URL: "http://env/local" });
    expect(r.localUrl).toBe("http://env/local");
    expect(r.remoteUrl).toBe(PIXSO_REMOTE_MCP_URL);
  });

  it("PIXSO_REMOTE_MCP_TOKEN", () => {
    expect(resolveSettings({}, { PIXSO_REMOTE_MCP_TOKEN: "env-token" }).token).toBe("env-token");
  });

  it("an EMPTY env URL is treated as absent, not as an empty endpoint", () => {
    // `PIXSO_LOCAL_MCP_URL=` in a .env is a user clearing a line; talking to "" could only fail
    // later and more confusingly.
    expect(resolveSettings({}, { PIXSO_LOCAL_MCP_URL: "" }).localUrl).toBe(PIXSO_LOCAL_MCP_URL);
  });
});

describe("tier 1 — the flag beats the environment", () => {
  it("--token beats PIXSO_REMOTE_MCP_TOKEN", () => {
    const r = resolveSettings({ token: "flag-token" }, { PIXSO_REMOTE_MCP_TOKEN: "env-token" });
    expect(r.token).toBe("flag-token");
  });

  it("--endpoint beats BOTH URL variables", () => {
    // One flag, two settings: the route is chosen automatically from the source
    // (design 2.1:112-121), so at the moment `--endpoint` is typed the user cannot say which of
    // the two they mean, and exactly one will be consulted.
    const r = resolveSettings(
      { endpoint: "http://flag/mcp" },
      { PIXSO_REMOTE_MCP_URL: "http://env/remote", PIXSO_LOCAL_MCP_URL: "http://env/local" },
    );
    expect(r.remoteUrl).toBe("http://flag/mcp");
    expect(r.localUrl).toBe("http://flag/mcp");
  });
});

describe("precedence is PER VALUE, not per source", () => {
  it("a --token flag does not discard an endpoint that came from the environment", () => {
    const r = resolveSettings(
      { token: "flag-token" },
      { PIXSO_REMOTE_MCP_URL: "http://env/remote", PIXSO_LOCAL_MCP_URL: "http://env/local" },
    );
    expect(r.token).toBe("flag-token");
    expect(r.remoteUrl).toBe("http://env/remote");
    expect(r.localUrl).toBe("http://env/local");
  });

  it("an --endpoint flag does not discard a token that came from the environment", () => {
    const r = resolveSettings(
      { endpoint: "http://flag/mcp" },
      { PIXSO_REMOTE_MCP_TOKEN: "env-token" },
    );
    expect(r.token).toBe("env-token");
    expect(r.remoteUrl).toBe("http://flag/mcp");
  });

  it("all three tiers at once, each value taking its own winner", () => {
    const r = resolveSettings({ token: "flag-token" }, { PIXSO_LOCAL_MCP_URL: "http://env/local" });
    expect(r.token).toBe("flag-token"); // tier 1
    expect(r.localUrl).toBe("http://env/local"); // tier 2
    expect(r.remoteUrl).toBe(PIXSO_REMOTE_MCP_URL); // tier 3
  });

  it("ignores unrelated environment variables", () => {
    const r = resolveSettings({}, { PIXSO_ENDPOINT: "http://legacy", PATH: "/usr/bin" });
    expect(r.remoteUrl).toBe(PIXSO_REMOTE_MCP_URL);
    expect(r.localUrl).toBe(PIXSO_LOCAL_MCP_URL);
  });
});

describe("the resolved values reach a command under the owner-fixed names", () => {
  it("projects back onto exactly the three keys", () => {
    const overlay = settingsToEnv({
      remoteUrl: "http://r",
      localUrl: "http://l",
      token: "tok",
    });
    expect(overlay).toEqual({
      PIXSO_REMOTE_MCP_URL: "http://r",
      PIXSO_LOCAL_MCP_URL: "http://l",
      PIXSO_REMOTE_MCP_TOKEN: "tok",
    });
  });

  it("an absent token becomes an empty string rather than a missing key", () => {
    const overlay = settingsToEnv({ remoteUrl: "http://r", localUrl: "http://l" });
    expect(overlay["PIXSO_REMOTE_MCP_TOKEN"]).toBe("");
  });

  it("round-trips: what resolveSettings decides is what a command reads", () => {
    const runtime = resolveSettings({ endpoint: "http://flag" }, { PIXSO_REMOTE_MCP_TOKEN: "t" });
    const overlay = settingsToEnv(runtime);
    expect(overlay[SETTING_KEYS.remoteUrl]).toBe("http://flag");
    expect(overlay[SETTING_KEYS.localUrl]).toBe("http://flag");
    expect(overlay[SETTING_KEYS.token]).toBe("t");
  });
});
