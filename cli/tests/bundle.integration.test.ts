/**
 * TIER 2 — THE PROOF (design 2.1:174-183, brief 3.4 deliverable 2).
 *
 * NEVER part of `pnpm test`; run on demand with `pnpm test:integration`. The filename suffix is
 * the whole mechanism: the `unit` project excludes `tests/**\/*.integration.test.ts` and the
 * `integration` project includes only those (`cli/vite.config.ts:42,62`).
 *
 * WHAT MAKES THIS TIER DIFFERENT FROM TIER 1, precisely. Tier 1 already runs every command
 * end-to-end through the REAL pixso-core pipeline against an injected fake client
 * (report 3.2 §5). It cannot, by construction, answer three questions:
 *
 *   1. Does the SHIPPED ARTIFACT work? Tier 1 imports `src/`. What ships is one minified
 *      `dist/main.mjs` with fe-pixso, cli-kit, pixso-core, the MCP SDK and undici inlined
 *      (`cli/tsdown.config.ts`). An import the bundler failed to inline is invisible until
 *      that file runs somewhere with nothing installed.
 *   2. Does it work over a REAL WIRE? `FetchScanOptions.client` is an in-process seam; a
 *      subprocess has none. Substituting the ENDPOINT is the only injection left, which is
 *      exactly the strategy the design fixes (2.1:121-122: "tests use a fake MCP instead, the
 *      pattern core itself uses") and which `pixso-core` states for itself in
 *      `ru-code-packages/packages/pixso-core/tests/ioFailureKinds.test.ts:20-24`.
 *   3. Does the JOIN hold? Report 3.2 §9 flagged one seam neither package could see alone:
 *      `.env` → `process.env` → the cli's precedence chain → `CommandContext` → fe-pixso's
 *      `pixsoRuntimeOf` → `fetchScan`. Case (f) below is that whole chain, measured at the
 *      far end by the `Token` header a socket actually received.
 *
 * ONE MECHANICAL TRAP, AND IT IS WHY EVERY RUN HERE IS ASYNC. The scaffold's placeholder used
 * `execFileSync`. That call BLOCKS the Node event loop until the child exits — so the fake MCP
 * server, which lives in THIS process, can never answer, and every request the child makes
 * hangs until the SDK's own timeout fires. Measured this session before the suite was written:
 * with `execFileSync` each fetching case took ~15 s and failed with
 * `get_node_dsl failed (transport): MCP error -32001: Request timed out` while the server
 * recorded ZERO calls; with `promisify(execFile)` the same case passes in ~100 ms. A
 * synchronous spawn and an in-process server are mutually exclusive, and the failure mode is a
 * timeout that reads like a network problem.
 */
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { pixsoCommands } from "@smart-tools/fe-pixso";
import {
  CLEAN_DSL,
  DESIGN_URL,
  dslRootNode,
  dslTexts,
  GET_ALL_COMPONENTS,
  GET_NODE_DSL,
  makeTempDir,
  nodeModulesAbove,
  removeTempDir,
  ROOT_GUID,
  startFakeMcp,
  type FakeMcp,
} from "@smart-tools/fe-testkit";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

const run = promisify(execFile);

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtBundle = join(packageRoot, "dist", "main.mjs");

/** The version the manifest declares — read independently of the code under test, so
 *  `--version` agreeing with it is evidence rather than a tautology. */
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  readonly version: string;
  readonly bin: Readonly<Record<string, string>>;
  readonly files: readonly string[];
};

/** The user-visible command surface, spelled out. This list is the CONTRACT — what a person
 *  typing `fe --help` must see — so it is written literally rather than generated from the
 *  registry the help page is itself generated from (a help test fed by the registry cannot
 *  notice the registry losing an entry). The cross-check that it has not drifted from the real
 *  registry is its own case below. */
const EXPECTED_SURFACE = [
  ["--get-pixso-svg", "--psvg"],
  ["--get-pixso-html", "--phtml"],
  ["--get-pixso-prompt", "--pprompt"],
  ["--get-pixso-assets", "--passets"],
] as const;

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * The child's environment is BUILT, never inherited.
 *
 * Case (e) asks for "no token anywhere". Spreading `process.env` would make that claim depend
 * on the machine: a developer who exports `PIXSO_REMOTE_MCP_TOKEN` for real work would see the
 * refusal case pass for the wrong reason on CI and fail on their laptop — or, worse, pass
 * everywhere while silently proving nothing. Starting from `{}` makes "nothing is set" a fact
 * of the test rather than a fact about the host. `PATH` rides along only so the child can find
 * ordinary system tools; the interpreter itself is addressed by absolute path.
 */
function childEnv(extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  return { PATH: process.env["PATH"] ?? "", ...extra };
}

/**
 * A scratch directory holding the bundle and NOTHING else.
 *
 * Both halves are asserted, not assumed: the directory contains exactly `main.mjs` after the
 * copy, and no `node_modules` exists on the path from it to the filesystem root — so an import
 * the bundler failed to inline has nowhere to resolve from and the run dies instead of quietly
 * succeeding (design 2.1:176-177).
 */
function scratchWithBundle(): string {
  const dir = makeTempDir("fe-tier2-");
  scratches.push(dir);
  copyFileSync(builtBundle, join(dir, "main.mjs"));
  expect(readdirSync(dir)).toEqual(["main.mjs"]);
  expect(nodeModulesAbove(dir)).toEqual([]);
  return dir;
}

/** Run the copied bundle. Never throws: a non-zero exit is the ANSWER in most cases here, and
 *  a helper that throws on it would force every such case into a try/catch. */
async function fe(dir: string, args: readonly string[], env = childEnv()): Promise<RunResult> {
  try {
    const { stdout, stderr } = await run(process.execPath, [join(dir, "main.mjs"), ...args], {
      cwd: dir,
      env,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: string; stderr?: string };
    return {
      // `promisify(execFile)` reports the exit status on `code` (not `status`, which is the
      // synchronous API's spelling) and it is a string for a signal death.
      code: typeof failure.code === "number" ? failure.code : -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

/**
 * WHAT `stderr` CARRIES NOW: the terminal UI, and nothing but.
 *
 * These runs are `execFile` children, so neither stream is a TTY — which puts the UI in its
 * plain lane (`packages/cli-kit/src/ui.ts`): one line per phase, then the final card, with NOT
 * ONE escape sequence and no carriage return in the whole of it. That is the property these
 * cases used to state as `stderr === ""`, restated for a CLI that now says what it is doing:
 * the payload is still exclusively on stdout, and a piped `2>` log is still readable text.
 *
 * `✗` is asserted absent as well, because a card marking a failed phase on a run that exited 0
 * would be a contradiction no other assertion here would catch.
 */
function expectQuietUi(stderr: string): void {
  expect(stderr).not.toContain("\u001b");
  expect(stderr).not.toContain("\r");
  expect(stderr).toContain("  > fe\n");
  expect(stderr).toContain("\u2713 ");
  expect(stderr).not.toContain("\u2717");
}

const scratches: string[] = [];
let fake: FakeMcp | null = null;

beforeAll(() => {
  // A stale or missing build would produce failures that look like product defects. This tier
  // assumes `pnpm build` ran; say so where it is cheap to say.
  expect(readdirSync(join(packageRoot, "dist"))).toEqual(["main.mjs"]);
});

afterEach(async () => {
  await fake?.close();
  fake = null;
  while (scratches.length > 0) removeTempDir(scratches.pop() as string);
});

async function serving(options?: Parameters<typeof startFakeMcp>[0]): Promise<FakeMcp> {
  fake = await startFakeMcp(options);
  return fake;
}

// ── (a) help, both languages ──────────────────────────────────────────────────────────────

describe("(a) --help lists the whole pixso surface, in both languages", () => {
  it("the literal surface above IS the registry — neither may drift from the other", () => {
    // Both directions. A fifth command that never reached the help page, and a renamed flag
    // that left this list stale, are the same bug seen from two sides.
    expect(pixsoCommands.map((command) => [command.flag, command.alias])).toEqual(
      EXPECTED_SURFACE.map(([flag, alias]) => [flag, alias]),
    );
  });

  it("default (ru) — every flag and every alias, in Russian", async () => {
    const dir = scratchWithBundle();
    const result = await fe(dir, ["--help"]);
    expect(result.code).toBe(0);
    for (const [flag, alias] of EXPECTED_SURFACE) {
      expect(result.stdout).toContain(flag);
      expect(result.stdout).toContain(alias);
    }
    // The page itself is rendered in the language, not just the summaries (report 3.3 §4).
    expect(result.stdout).toContain("команды:");
    expect(result.stdout).toMatch(/[А-Яа-яЁё]/u);
  });

  it("--lang en — the same surface, a different page", async () => {
    const dir = scratchWithBundle();
    const ru = await fe(dir, ["--help"]);
    const en = await fe(dir, ["--lang", "en", "--help"]);
    expect(en.code).toBe(0);
    for (const [flag, alias] of EXPECTED_SURFACE) {
      expect(en.stdout).toContain(flag);
      expect(en.stdout).toContain(alias);
    }
    expect(en.stdout).toContain("commands:");
    // Not a Russian page with English flag names, and not the same page twice.
    expect(en.stdout).not.toMatch(/[А-Яа-яЁё]/u);
    expect(en.stdout).not.toBe(ru.stdout);
  });
});

// ── (b) version ───────────────────────────────────────────────────────────────────────────

describe("(b) --version", () => {
  it("prints exactly the version in cli/package.json, and not the build-time fallback", async () => {
    const dir = scratchWithBundle();
    const result = await fe(dir, ["--version"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(manifest.version);
    // The `define` really fired — `0.0.0-dev` is what `src/version.ts` degrades to when it
    // did not (`cli/src/version.ts:19-33`), and it is the one string that would still pass a
    // looser regex assertion.
    expect(result.stdout).not.toContain("0.0.0-dev");
  });
});

// ── (c) the local route, over a real socket ───────────────────────────────────────────────

describe("(c) --get-pixso-svg <guid> against a fake MCP on the local endpoint", () => {
  it("emits real SVG bytes on stdout, exit 0, and the server saw the guid", async () => {
    const server = await serving();
    const dir = scratchWithBundle();

    const result = await fe(dir, ["--get-pixso-svg", ROOT_GUID], {
      ...childEnv({ PIXSO_LOCAL_MCP_URL: server.url }),
    });

    expectQuietUi(result.stderr);
    expect(result.code).toBe(0);

    // CHANGED IN E2b. The bare run used to print the SVG on stdout; now it WRITES, to the
    // documented default, and stdout carries the absolute path of what it wrote (the owner's
    // law, `WORKFLOW/features/eds-parser/briefs/e2b-output-normalization.md:19-34`). The
    // directory did not exist a moment ago — this is the "created on demand" half.
    const written = join(dir, "fe-out", "pixso", "11-10.svg");
    expect(existsSync(written)).toBe(true);
    expect(result.stdout.trimEnd().split("\n").at(-1)).toBe(written);

    const svg = readFileSync(written, "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    // FIXTURE-DERIVED, not restated: the geometry is read out of the very envelope the fake
    // served, so this cannot pass against a cached or default render.
    const root = dslRootNode(CLEAN_DSL);
    expect(svg).toContain(`width="${String(root.width)}"`);
    expect(svg).toContain(`height="${String(root.height)}"`);
    for (const text of dslTexts(CLEAN_DSL)) expect(svg).toContain(text);
    expect(dslTexts(CLEAN_DSL).length).toBeGreaterThan(0);

    // Nothing is appended to the file — the artifact is the artifact (report 3.2 §1).
    expect(svg.endsWith("</svg>")).toBe(true);

    // The wire, seen from the far end. LOCAL route ⇒ `{ itemId }` plus the catalogue follow-up
    // (`ru-code-packages/packages/pixso-core/src/adapters/fetchPlan.ts:99-103` and
    // `src/adapters/v2/2.1.15/fetchPlan.ts:55-58`), and NO token.
    expect(server.calls.map((call) => call.tool)).toEqual([GET_NODE_DSL, GET_ALL_COMPONENTS]);
    expect(server.calls[0]?.args).toEqual({ itemId: ROOT_GUID });
    expect(server.calls[0]?.token).toBeUndefined();
  });
});

// ── (d) the four assets ───────────────────────────────────────────────────────────────────

describe("(d) --get-pixso-assets <guid> -o <dir>", () => {
  it("writes exactly card.svg / card.html / card.md / card.json, from ONE scan", async () => {
    const server = await serving();
    const dir = scratchWithBundle();
    const out = join(dir, "assets");

    const result = await fe(dir, ["--get-pixso-assets", ROOT_GUID, "-o", out], {
      ...childEnv({ PIXSO_LOCAL_MCP_URL: server.url }),
    });

    expectQuietUi(result.stderr);
    expect(result.code).toBe(0);
    // EXACTLY these four — `toEqual` on the sorted listing, so a fifth file fails too.
    expect(readdirSync(out).sort()).toEqual(["card.html", "card.json", "card.md", "card.svg"]);

    // Each file is the face it claims to be, and each carries the fixture's own content.
    const svg = readFileSync(join(out, "card.svg"), "utf8");
    const html = readFileSync(join(out, "card.html"), "utf8");
    const md = readFileSync(join(out, "card.md"), "utf8");
    const meta = JSON.parse(readFileSync(join(out, "card.json"), "utf8")) as {
      readonly name?: unknown;
    };
    expect(svg.startsWith("<svg")).toBe(true);
    expect(html.toLowerCase()).toContain("<!doctype html>");
    expect(md.length).toBeGreaterThan(0);
    expect(meta.name).toBe(dslRootNode(CLEAN_DSL).name);
    for (const text of dslTexts(CLEAN_DSL)) expect(svg).toContain(text);

    // ONE scan, measured at the seam rather than asserted about the code: four faces off four
    // fetches would be four `get_node_dsl` calls here.
    expect(server.calls.filter((call) => call.tool === GET_NODE_DSL)).toHaveLength(1);
  });
});

// ── (e) a remote link with no token anywhere ──────────────────────────────────────────────

describe("(e) a design link with no token anywhere", () => {
  it("refuses in Russian naming all three fixes, exit 2, and dials NOTHING", async () => {
    const server = await serving();
    const dir = scratchWithBundle();

    // Both endpoints point at the fake, so a refusal that leaked into a fetch would be VISIBLE
    // as a recorded call rather than invisible as a connection error.
    const result = await fe(dir, ["--get-pixso-svg", DESIGN_URL], {
      ...childEnv({ PIXSO_REMOTE_MCP_URL: server.url, PIXSO_LOCAL_MCP_URL: server.url }),
    });

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    // All three fixes the user can apply (report 3.2 §2).
    expect(result.stderr).toContain("--token");
    expect(result.stderr).toContain("PIXSO_REMOTE_MCP_TOKEN");
    expect(result.stderr).toContain(".env");
    expect(result.stderr).toMatch(/[А-Яа-яЁё]/u);

    // The refusal is decided BEFORE the transport: a mistyped line costs no round trip.
    expect(server.calls).toHaveLength(0);
    expect(server.sessions).toHaveLength(0);
  });

  it("--lang en says the same three things in English", async () => {
    const server = await serving();
    const dir = scratchWithBundle();
    const result = await fe(dir, ["--lang", "en", "--get-pixso-svg", DESIGN_URL], {
      ...childEnv({ PIXSO_REMOTE_MCP_URL: server.url }),
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--token");
    expect(result.stderr).toContain("PIXSO_REMOTE_MCP_TOKEN");
    expect(result.stderr).toContain(".env");
    expect(result.stderr).not.toMatch(/[А-Яа-яЁё]/u);
    expect(server.calls).toHaveLength(0);
  });
});

// ── (f) the .env join, measured at the far end of the wire ────────────────────────────────

describe("(f) a .env file beside the bundle carries the remote token onto the wire", () => {
  it("the fake server receives the Token header with the value from .env", async () => {
    const server = await serving();
    const dir = scratchWithBundle();
    const token = "token-from-dotenv-4f2a";

    // The remote endpoint is pointed at the fake THROUGH THE SAME FILE, so this case proves
    // the `.env` route for both settings at once.
    writeFileSync(
      join(dir, ".env"),
      `PIXSO_REMOTE_MCP_URL=${server.url}\nPIXSO_REMOTE_MCP_TOKEN=${token}\n`,
      "utf8",
    );
    // …and nothing is in the environment: `process.loadEnvFile` does not clobber an existing
    // entry (report 3.3 §3), so a value in `childEnv` would make this case prove the wrong
    // tier of the chain.
    const env = childEnv();
    expect(env["PIXSO_REMOTE_MCP_TOKEN"]).toBeUndefined();

    const result = await fe(dir, ["--get-pixso-svg", DESIGN_URL], env);

    expectQuietUi(result.stderr);
    expect(result.code).toBe(0);
    // CHANGED IN E2b: the payload is a FILE now, so the proof that the run succeeded is the
    // file rather than the first bytes of stdout. Its name comes from the link's `item-id`,
    // which is the same guid the local route names — see the default-output case in (h).
    expect(readFileSync(join(dir, "fe-out", "pixso", "11-10.svg"), "utf8").startsWith("<svg")).toBe(
      true,
    );

    // THE POINT OF THE CASE. `.env` → `process.loadEnvFile` → `process.env` → the cli's
    // precedence chain → `settingsToEnv` → `CommandContext` → `pixsoRuntimeOf` → `fetchScan`
    // → `makePixsoClient(endpoint, undefined, { Token })` → an HTTP header a socket received.
    // Report 3.2 §9 called this join the one thing neither package could verify alone.
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]?.token).toBe(token);
    // REMOTE route ⇒ `{ file_key, guid }` and no catalogue follow-up — the route decision,
    // visible on the wire rather than inferred.
    expect(server.calls[0]?.tool).toBe(GET_NODE_DSL);
    expect(Object.keys(server.calls[0]?.args ?? {}).sort()).toEqual(["file_key", "guid"]);
    expect(server.calls[0]?.args["guid"]).toBe(ROOT_GUID);
  });

  it("the guard: WITHOUT the .env file the same line refuses — so .env is what did it", async () => {
    const server = await serving();
    const dir = scratchWithBundle();
    // Same argv, same environment, same server; the only difference is the missing file.
    const result = await fe(dir, ["--get-pixso-svg", DESIGN_URL], {
      ...childEnv({ PIXSO_REMOTE_MCP_URL: server.url }),
    });
    expect(result.code).toBe(2);
    expect(server.calls).toHaveLength(0);
  });
});

// ── (g) an unknown flag ───────────────────────────────────────────────────────────────────

describe("(g) an unknown flag", () => {
  it("names the offending flag, exit 2, nothing on stdout", async () => {
    const dir = scratchWithBundle();
    const result = await fe(dir, ["--not-a-real-flag"]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--not-a-real-flag");
  });

  it("a bare invocation is also exit 2, with the help page as the answer", async () => {
    // The scaffold's placeholder passed only because the skeleton's `run` returned 0 for
    // everything (report 3.3 DEVIATIONS §2). Pinned here so that can never silently return.
    const dir = scratchWithBundle();
    const result = await fe(dir, []);
    expect(result.code).toBe(2);
    for (const [flag] of EXPECTED_SURFACE) {
      expect(result.stdout + result.stderr).toContain(flag);
    }
  });
});

// ── (g2) a flag the selected command has not declared ─────────────────────────────────────

/**
 * V3 MAJOR-1, through the SHIPPED bundle. The audit's repro was
 * `node main.mjs --parse-ui-kit eds --source <kit> -o /tmp/zzz` → EXIT 0, corpus written,
 * `/tmp/zzz` never created, no warning anywhere. It is now a parse-time refusal, which is also
 * why this case is cheap: nothing is cloned, nothing is installed, no network is touched,
 * because the invocation never reaches `run`.
 */
describe("(g2) a flag the selected command has not declared", () => {
  it("refuses `-o` on --parse-ui-kit, exit 2, naming the flag and the command, writing nothing", async () => {
    const dir = scratchWithBundle();
    const target = join(dir, "zzz.json");
    const result = await fe(dir, ["--parse-ui-kit", "eds", "-o", target]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("-o");
    expect(result.stderr).toContain("--parse-ui-kit");
    // The whole point of the finding: the destination the user named is not silently dropped,
    // and nothing else appears beside the bundle either.
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(dir)).toEqual(["main.mjs"]);
  });

  it("says it in English under --lang en", async () => {
    const dir = scratchWithBundle();
    const result = await fe(dir, ["--lang", "en", "--parse-ui-kit", "eds", "-o", "x.json"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("is not supported by --parse-ui-kit");
  });

  it("refuses `--source` on --project-report the same way", async () => {
    const dir = scratchWithBundle();
    const result = await fe(dir, ["--project-report", ".", "--source", "/tmp/zzz"]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--source");
    expect(result.stderr).toContain("--project-report");
    expect(readdirSync(dir)).toEqual(["main.mjs"]);
  });

  it("still accepts the flags each command DOES declare — `--source` on --parse-ui-kit", async () => {
    // Proof the refusal is scoped and not a blanket ban: the same flag on the command that
    // declares it gets past parsing and fails later, on the path that does not exist, which is
    // exit 1 (a runtime failure) rather than exit 2 (a usage error).
    const dir = scratchWithBundle();
    const result = await fe(dir, ["--parse-ui-kit", "eds", "--source", join(dir, "no-such-kit")]);
    expect(result.code).toBe(1);
  });
});

// ── the isolation claim itself ────────────────────────────────────────────────────────────

describe("the bundle is genuinely self-contained", () => {
  it("`dist/` holds ONE file and it runs with no node_modules anywhere above it", async () => {
    expect(readdirSync(join(packageRoot, "dist"))).toEqual(["main.mjs"]);
    const dir = scratchWithBundle();
    // `scratchWithBundle` already asserted both halves of the isolation; running a command
    // that reaches the pixso engine is what makes it mean something — an un-inlined
    // `@modelcontextprotocol/sdk` or `undici` would throw ERR_MODULE_NOT_FOUND here.
    const server = await serving();
    const result = await fe(dir, ["--get-pixso-prompt", ROOT_GUID], {
      ...childEnv({ PIXSO_LOCAL_MCP_URL: server.url }),
    });
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
    expect(result.code).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it("a directory that is NOT isolated is detected — the guard above can fail", () => {
    // Calibration for `scratchWithBundle`'s `nodeModulesAbove(dir)` assertion: this repo's own
    // `cli/` sits under a `node_modules`, so an empty answer there would mean the check is
    // blind and every isolation claim in this file is decoration.
    expect(nodeModulesAbove(packageRoot).length).toBeGreaterThan(0);
  });
});

// ── the terminal UI, through the shipped bundle ───────────────────────────────────────────

/**
 * TIER 2 for the UI: the same renderer `packages/cli-kit/tests/ui.test.ts` drives with a fake
 * stream, here reached the only way a user reaches it — the built single file, in a child
 * process, with the environment as the only lever.
 *
 * A child process has no pseudo-terminal, so the full-color lane is entered with `FORCE_COLOR`
 * rather than a pty. That is not a test-only backdoor: it is the conventional node CLI switch,
 * it is implemented in `capabilityOf` alongside `NO_COLOR` and `FORCE_COLOR=0`, and it is what
 * lets anyone see the real output of a piped run without `script`.
 *
 * THE ONE CLAIM THAT MATTERS MOST is the last case but one: whatever the UI does, `stdout` is
 * the same bytes it has always been. Everything else on this page is decoration if that is not
 * true.
 */
describe("(g) the terminal UI", () => {
  it("piped: plain sequential phases and a card, with not one escape code", async () => {
    const server = await serving();
    const dir = scratchWithBundle();
    const result = await fe(dir, ["--get-pixso-svg", ROOT_GUID], {
      ...childEnv({ PIXSO_LOCAL_MCP_URL: server.url }),
    });

    expect(result.code).toBe(0);
    expectQuietUi(result.stderr);
    // The four phases a face command walks, in order, in the default language.
    const order = ["Разбор источника", "Загрузка макета", "Рендер", "Запись"];
    const positions = order.map((label) => result.stderr.indexOf(`  ${label}…`));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("FORCE_COLOR: the installer's palette — green arrow, cyan bar, redraws and a box", async () => {
    const server = await serving();
    const dir = scratchWithBundle();
    const result = await fe(dir, ["--get-pixso-assets", ROOT_GUID, "-o", join(dir, "assets")], {
      ...childEnv({ PIXSO_LOCAL_MCP_URL: server.url, FORCE_COLOR: "1", COLORTERM: "truecolor" }),
    });

    expect(result.code).toBe(0);
    // `install:245-249` — the green arrow, then a 24-bit sweep starting at cyan.
    expect(result.stderr).toContain("\u001b[0;32m▸\u001b[0m");
    expect(result.stderr).toContain("\u001b[1;38;2;56;217;238m");
    // `install:266-267` — every frame clears its row before drawing.
    expect(result.stderr).toContain("\r\u001b[K");
    // `install:262-264` — a cyan bar of ▓/░, and the four writes counted to 100%.
    expect(result.stderr).toContain("\u001b[0;36m");
    expect(result.stderr).toContain("▓");
    expect(result.stderr).toContain("100%");
    // `install:585-660` — the card: a tick per phase and a double-rule box.
    expect(result.stderr).toContain("\u001b[0;32m✓\u001b[0m");
    expect(result.stderr).toContain("╔");
    expect(result.stderr).toContain("╚");
  });

  it("NO_COLOR beats FORCE_COLOR: the plain lane, even when both are set", async () => {
    const server = await serving();
    const dir = scratchWithBundle();
    const result = await fe(dir, ["--get-pixso-svg", ROOT_GUID], {
      ...childEnv({ PIXSO_LOCAL_MCP_URL: server.url, FORCE_COLOR: "1", NO_COLOR: "1" }),
    });
    expect(result.code).toBe(0);
    expectQuietUi(result.stderr);
  });

  it("a failure marks the phase it died in with ✗ and never claims a ✓ for it", async () => {
    const dir = scratchWithBundle();
    // Nothing is serving on that port, so the FETCH phase is the one that dies.
    const result = await fe(dir, ["--get-pixso-svg", ROOT_GUID], {
      ...childEnv({ PIXSO_LOCAL_MCP_URL: "http://127.0.0.1:1/mcp" }),
    });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("✓ Разбор источника");
    expect(result.stderr).toContain("✗ Загрузка макета");
  });

  it("STDOUT IS BYTE-IDENTICAL whatever the UI is doing — plain, colored, or off", async () => {
    const server = await serving();
    // ONE directory for all four runs, because stdout now carries an absolute path and four
    // scratch directories would differ in exactly that path — which would make this case fail
    // for a reason that has nothing to do with the UI.
    const dir = scratchWithBundle();
    const bytes: string[] = [];
    for (const extra of [
      {},
      { FORCE_COLOR: "1", COLORTERM: "truecolor" },
      { NO_COLOR: "1" },
      { FORCE_COLOR: "0" },
    ]) {
      const result = await fe(dir, ["--get-pixso-svg", ROOT_GUID], {
        ...childEnv({ PIXSO_LOCAL_MCP_URL: server.url, ...extra }),
      });
      expect(result.code).toBe(0);
      bytes.push(result.stdout);
    }
    expect(new Set(bytes).size).toBe(1);
    // CHANGED IN E2b: stdout is the RESULT — a headline and the absolute path — never the
    // artifact. Not one escape byte and not one `\r` in it, whatever the UI drew on stderr.
    expect(bytes[0]?.trimEnd().split("\n").at(-1)).toBe(join(dir, "fe-out", "pixso", "11-10.svg"));
    // `not.toContain`, not a regex: a regex spelling a control character trips
    // `eslint(no-control-regex)`, and the repo's lint baseline is zero warnings. It is also the
    // spelling `expectQuietUi` above already uses for exactly this check.
    expect(bytes[0]).not.toContain("\u001b");
    expect(bytes[0]).not.toContain("\r");
  });

  it("--help and --version draw NOTHING: no banner, no card, an empty stderr", async () => {
    const dir = scratchWithBundle();
    for (const args of [["--help"], ["--version"], ["--lang", "en", "--help"]]) {
      const result = await fe(dir, args, {
        ...childEnv({ FORCE_COLOR: "1", COLORTERM: "truecolor" }),
      });
      expect(result.code).toBe(0);
      // The UI is lazy: it is built for a command invocation and draws its banner on the first
      // phase, so an invocation that never reaches a command leaves stderr untouched.
      expect(result.stderr).toBe("");
    }
  });
});

// ── (h) the default output contract, from a bare directory ────────────────────────────────

/**
 * THE OWNER'S LAW, through the SHIPPED bundle, from a directory holding nothing but that
 * bundle: `-o` omitted on every pixso command, files appear at the documented defaults, and the
 * final card's result lines are their absolute paths
 * (`WORKFLOW/features/eds-parser/briefs/e2b-output-normalization.md:19-32, 40-43`).
 *
 * This is the tier the brief asks for because it is the only tier where "cwd-relative, created
 * on demand" means anything: the child process really has a cwd, `fe-out/` really does not
 * exist when it starts, and the paths on stdout are really absolute rather than resolved
 * against a test's imagination.
 */
describe("(h) no -o anywhere — the defaults, in a bare temp directory", () => {
  it("the three faces write ./fe-out/pixso/<name>.<ext> and report absolute paths", async () => {
    const server = await serving();
    const dir = scratchWithBundle();

    for (const [flag, file] of [
      ["--psvg", "11-10.svg"],
      ["--phtml", "11-10.html"],
      ["--pprompt", "11-10.md"],
    ] as const) {
      const result = await fe(dir, [flag, ROOT_GUID], {
        ...childEnv({ PIXSO_LOCAL_MCP_URL: server.url }),
      });
      expect(result.code).toBe(0);
      expectQuietUi(result.stderr);

      const written = join(dir, "fe-out", "pixso", file);
      expect(existsSync(written)).toBe(true);
      // stdout: a headline, then the absolute path — and the path is the LAST line, so
      // `fe --psvg 11:10 | tail -1` is a usable idiom.
      const lines = result.stdout.trimEnd().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[1]).toBe(written);
      expect(isAbsolute(lines[1] ?? "")).toBe(true);
      // …and the card on stderr carries the same absolute path. Whitespace and the box glyphs
      // are stripped before the comparison, so this holds whether the path fitted on one row or
      // was hard-broken across two (`packages/cli-kit/src/ui.ts`'s `wrap`).
      expect(result.stderr.replace(/[\s║╔╚╗╝═]/gu, "")).toContain(written);
    }

    // One stem, three extensions, all beside each other — and nothing else in the directory.
    expect(readdirSync(join(dir, "fe-out", "pixso")).sort()).toEqual([
      "11-10.html",
      "11-10.md",
      "11-10.svg",
    ]);
    expect(readdirSync(dir).sort()).toEqual(["fe-out", "main.mjs"]);
  });

  it("--passets writes ./fe-out/pixso/<name>/ and the card lists all FOUR paths", async () => {
    const server = await serving();
    const dir = scratchWithBundle();

    const result = await fe(dir, ["--passets", ROOT_GUID], {
      ...childEnv({ PIXSO_LOCAL_MCP_URL: server.url }),
    });

    expect(result.code).toBe(0);
    expectQuietUi(result.stderr);

    const out = join(dir, "fe-out", "pixso", "11-10");
    expect(readdirSync(out).sort()).toEqual(["card.html", "card.json", "card.md", "card.svg"]);

    // FIVE lines: the headline and one absolute path per file, in write order.
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(5);
    expect(lines.slice(1)).toEqual([
      join(out, "card.svg"),
      join(out, "card.html"),
      join(out, "card.md"),
      join(out, "card.json"),
    ]);
    for (const path of lines.slice(1)) expect(isAbsolute(path)).toBe(true);
  });

  it("a design link with a token names the SAME file as its guid", async () => {
    const server = await serving();
    const dir = scratchWithBundle();

    const result = await fe(dir, ["--psvg", DESIGN_URL], {
      ...childEnv({ PIXSO_REMOTE_MCP_URL: server.url, PIXSO_REMOTE_MCP_TOKEN: "t" }),
    });

    expect(result.code).toBe(0);
    // The name follows the DESIGN, not the spelling: the link's `item-id` is the guid.
    expect(readdirSync(join(dir, "fe-out", "pixso"))).toEqual(["11-10.svg"]);
  });

  it("`-o` still wins, and its parent directories are created", async () => {
    const server = await serving();
    const dir = scratchWithBundle();
    const target = join(dir, "deep", "er", "still", "card.svg");

    const result = await fe(dir, ["--psvg", ROOT_GUID, "-o", target], {
      ...childEnv({ PIXSO_LOCAL_MCP_URL: server.url }),
    });

    expect(result.code).toBe(0);
    expect(existsSync(target)).toBe(true);
    expect(result.stdout.trimEnd().split("\n").at(-1)).toBe(target);
    // …and NO default was written beside it.
    expect(existsSync(join(dir, "fe-out"))).toBe(false);
  });
});
