/**
 * TIER 1 — unit. `run` end to end, in-process, with every impure thing injected.
 *
 * No subprocess and no environment access: `RunDeps` gives the suite the streams, the
 * environment, the cwd, the `.env` loader and the registry, so what is exercised here is the
 * real dispatch path and nothing around it (design 2.1:148-153).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createUi, silentUi } from "@smart-tools/fe-cli-kit";
import { describe, expect, it } from "vite-plus/test";

import { type RunDeps, run } from "../src/main.ts";
import { COMMANDS } from "../src/registry.ts";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from "../src/parse.ts";
import { SETTING_KEYS } from "../src/settings.ts";
import { CLI_VERSION } from "../src/version.ts";
import { FAKE_COMMANDS, REFUSAL_TEXT, calls, loudlyRefusingCommand } from "./fixtures.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Harness {
  readonly deps: RunDeps;
  out(): string;
  err(): string;
}

function harness(overrides: Partial<RunDeps> = {}): Harness {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const deps: RunDeps = {
    commands: FAKE_COMMANDS,
    version: "9.9.9",
    readEnv: () => ({}),
    cwd: () => packageRoot,
    // A no-op loader by default: `.env` behaviour has its own suite against real directories
    // (`cli/tests/dotenv.test.ts`), and dispatch must not depend on what is on disk.
    loadEnv: () => ({ loaded: false }),
    stdout: (s) => void outChunks.push(s),
    stderr: (s) => void errChunks.push(s),
    // `silentUi` by default, so every assertion in this file keeps measuring DISPATCH rather
    // than rendering: the terminal UI has its own suite (`packages/cli-kit/tests/ui.test.ts`)
    // and would otherwise put a banner and a card into `err()` in every case here.
    ui: () => silentUi,
    ...overrides,
  };
  return { deps, out: () => outChunks.join(""), err: () => errChunks.join("") };
}

describe("--version", () => {
  it("prints the version and exits 0", async () => {
    const h = harness();
    expect(await run(["--version"], h.deps)).toBe(EXIT_OK);
    expect(h.out().trim()).toBe("9.9.9");
    expect(h.err()).toBe("");
  });

  it("the version baked into the code IS cli/package.json's version", async () => {
    // The proof that build-time injection works. `CLI_VERSION` is a literal substituted by
    // `define` (declared identically in `cli/tsdown.config.ts` and `cli/vite.config.ts`); this
    // test reads the manifest independently and asserts the two agree. A missing `define` would
    // leave the `0.0.0-dev` fallback here and fail loudly.
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      version: string;
    };
    expect(CLI_VERSION).toBe(manifest.version);
    expect(CLI_VERSION).not.toBe("0.0.0-dev");

    const h = harness({ version: CLI_VERSION });
    await run(["--version"], h.deps);
    expect(h.out().trim()).toBe(manifest.version);
  });

  it("-v is the same", async () => {
    const h = harness();
    expect(await run(["-v"], h.deps)).toBe(EXIT_OK);
    expect(h.out().trim()).toBe("9.9.9");
  });
});

describe("--help", () => {
  it("goes to stdout with exit 0 and carries the version", async () => {
    const h = harness();
    expect(await run(["--help"], h.deps)).toBe(EXIT_OK);
    expect(h.out()).toContain("--fake-alpha");
    expect(h.out()).toContain("9.9.9");
    expect(h.err()).toBe("");
  });

  it("is ru by default and en on request", async () => {
    const ru = harness();
    await run(["--help"], ru.deps);
    expect(ru.out()).toContain("команды:");

    const en = harness();
    await run(["--help", "--lang", "en"], en.deps);
    expect(en.out()).toContain("commands:");
    expect(en.out()).not.toContain("команды:");
  });

  it("no command at all still prints help — but exits 2", async () => {
    const h = harness();
    expect(await run([], h.deps)).toBe(EXIT_USAGE);
    expect(h.out()).toContain("--fake-alpha");
  });
});

describe("errors go to stderr, localized, exit 2", () => {
  it("an unknown flag names itself and points at --help", async () => {
    const h = harness();
    expect(await run(["--nope"], h.deps)).toBe(EXIT_USAGE);
    expect(h.out()).toBe("");
    expect(h.err()).toContain("--nope");
    expect(h.err()).toContain("fe --help");
  });

  it("the same error in en", async () => {
    const h = harness();
    await run(["--lang", "en", "--nope"], h.deps);
    expect(h.err()).toContain("unknown flag");
  });

  it("two commands is an error, printed with the full help", async () => {
    const h = harness();
    expect(await run(["--fake-alpha", "--fake-beta"], h.deps)).toBe(EXIT_USAGE);
    expect(h.err()).toContain("--fake-alpha");
  });

  it("a bad --lang value is reported", async () => {
    const h = harness();
    expect(await run(["--lang", "de", "--fake-beta"], h.deps)).toBe(EXIT_USAGE);
    expect(h.err()).toContain("de");
  });

  /**
   * V3 MAJOR-1 through the real dispatch path: a flag the command has not declared exits 2,
   * says so on stderr in the resolved language, and NOTHING runs. The registry is the shipped
   * one here because the defect is about the shipped commands' surfaces; `parse.test.ts` proves
   * the derivation rule generically.
   */
  it("a flag the selected command has not declared exits 2 without running it", async () => {
    const h = harness({ commands: COMMANDS });
    expect(await run(["--parse-ui-kit", "eds", "-o", "/tmp/zzz"], h.deps)).toBe(EXIT_USAGE);
    expect(h.out()).toBe("");
    expect(h.err()).toContain("-o");
    expect(h.err()).toContain("--parse-ui-kit");
    expect(h.err()).toContain("fe --help");
  });

  it("the same refusal in en", async () => {
    const h = harness({ commands: COMMANDS });
    expect(await run(["--lang", "en", "--project-report", "/p", "--source", "/x"], h.deps)).toBe(
      EXIT_USAGE,
    );
    expect(h.err()).toContain("is not supported by --project-report");
  });
});

describe("dispatch", () => {
  it("runs the selected command and returns ITS exit code", async () => {
    calls.length = 0;
    const h = harness();
    expect(await run(["--fake-alpha", "the-guid"], h.deps)).toBe(EXIT_OK);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.flag).toBe("--fake-alpha");
  });

  it("passes a non-zero code from the command straight through", async () => {
    const h = harness();
    expect(await run(["--fake-refuse"], h.deps)).toBe(2);
  });

  it("hands the command its source, its --out and the resolved language", async () => {
    calls.length = 0;
    const h = harness();
    await run(["--falpha", "https://example/design", "-o", "card.svg", "--lang", "en"], h.deps);
    const ctx = calls[0]?.ctx;
    expect(ctx?.source).toBe("https://example/design");
    expect(ctx?.out).toBe("card.svg");
    expect(ctx?.lang).toBe("en");
  });

  /**
   * THE CWD SEAM. `-o` is optional on every command now, so a run without one writes to a
   * cwd-relative default (`packages/cli-kit/src/out.ts`). That makes `deps.cwd` an input to
   * where files LAND, not just to where `.env` is looked for — so it has to reach the context,
   * and it has to be the SAME cwd the `.env` loader was given, or a run and its `.env` would
   * disagree about where "here" is.
   */
  it("hands the command the invocation's cwd — the same one the .env loader was given", async () => {
    calls.length = 0;
    const seen: string[] = [];
    const h = harness({
      cwd: () => "/somewhere/else",
      loadEnv: (cwd) => {
        seen.push(cwd);
        return { loaded: false };
      },
    });
    await run(["--fake-beta"], h.deps);
    expect(calls[0]?.ctx.cwd).toBe("/somewhere/else");
    expect(seen).toEqual(["/somewhere/else"]);
  });

  it("`-o` absent leaves ctx.out undefined — the command decides the default, not the CLI", async () => {
    calls.length = 0;
    const h = harness();
    await run(["--fake-beta"], h.deps);
    // The CLI does NOT substitute a default path: which default a command has is that command's
    // to know (a pixso face, a report and a corpus have three different answers), and a value
    // invented here would be one the help page could not describe.
    expect(calls[0]?.ctx.out).toBeUndefined();
    expect(calls[0]?.ctx.cwd).toBe(packageRoot);
  });

  it("hands the command the RESOLVED settings under the owner-fixed env names", async () => {
    calls.length = 0;
    const h = harness({ readEnv: () => ({ PIXSO_LOCAL_MCP_URL: "http://env/local" }) });
    await run(["--fake-beta", "--token", "flag-token"], h.deps);
    const env = calls[0]?.ctx.env;
    // Flag override applied...
    expect(env?.[SETTING_KEYS.token]).toBe("flag-token");
    // ...environment respected where no flag spoke...
    expect(env?.[SETTING_KEYS.localUrl]).toBe("http://env/local");
    // ...and the constant default filling the rest.
    expect(env?.[SETTING_KEYS.remoteUrl]).toBe("http://127.0.0.1:3667/remote-mcp");
  });

  it("puts the SAME resolved values in ctx.flags — the slot fe-pixso reads FIRST", async () => {
    // THE SEAM, asserted. `packages/fe-pixso/src/runtime.ts:51-56` resolves each value as
    // `ctx.flags[KEY]` then `ctx.env[KEY]`, where KEY is one of the three owner-fixed names
    // (`runtime.ts:32-36`) — NOT a plain `token`/`endpoint`. Writing both slots means the seam
    // holds whichever one a feature package consults, and this test fails if either is dropped.
    calls.length = 0;
    const h = harness({ readEnv: () => ({ PIXSO_LOCAL_MCP_URL: "http://env/local" }) });
    await run(["--fake-beta", "--token", "flag-token"], h.deps);
    const ctx = calls[0]?.ctx;
    for (const [key, expected] of [
      [SETTING_KEYS.token, "flag-token"],
      [SETTING_KEYS.localUrl, "http://env/local"],
      [SETTING_KEYS.remoteUrl, "http://127.0.0.1:3667/remote-mcp"],
    ] as const) {
      expect(ctx?.flags[key]).toBe(expected);
      expect(ctx?.env[key]).toBe(expected);
    }
    // The three names are the owner-fixed spellings, not invented shorthands.
    expect(Object.keys(ctx?.flags ?? {})).toEqual(
      expect.arrayContaining([
        "PIXSO_REMOTE_MCP_URL",
        "PIXSO_LOCAL_MCP_URL",
        "PIXSO_REMOTE_MCP_TOKEN",
      ]),
    );
  });

  it("an unset token reaches the command as empty — which the feature reads as absent", async () => {
    // `runtime.ts:53,55` counts `""` as absent in both slots, so the remote route refuses with
    // its own localized message rather than sending an empty token to the engine.
    calls.length = 0;
    const h = harness();
    await run(["--fake-beta"], h.deps);
    expect(calls[0]?.ctx.flags[SETTING_KEYS.token]).toBe("");
    expect(calls[0]?.ctx.env[SETTING_KEYS.token]).toBe("");
  });

  it("leaves the rest of the ambient environment intact for the command", async () => {
    calls.length = 0;
    const h = harness({ readEnv: () => ({ HOME: "/home/somebody" }) });
    await run(["--fake-beta"], h.deps);
    expect(calls[0]?.ctx.env["HOME"]).toBe("/home/somebody");
  });

  it("gives the command the injected streams, not the process's", async () => {
    calls.length = 0;
    const h = harness();
    await run(["--fake-beta"], h.deps);
    calls[0]?.ctx.stdout("written by the command\n");
    expect(h.out()).toContain("written by the command");
  });
});

describe("a command that throws", () => {
  it("reports one localized line, no stack, and a non-zero exit", async () => {
    const h = harness();
    expect(await run(["--fake-explode"], h.deps)).toBe(EXIT_FAILURE);
    // Core's own text passes through untranslated — core owns its error strings.
    expect(h.err()).toContain("engine said no");
    expect(h.err()).toContain("--debug");
    expect(h.err()).not.toContain("at ");
  });

  it("--debug, and only --debug, produces the stack", async () => {
    const h = harness();
    expect(await run(["--fake-explode", "--debug"], h.deps)).toBe(EXIT_FAILURE);
    expect(h.err()).toContain("engine said no");
    expect(h.err()).toContain("at ");
  });

  it("reports in en when asked", async () => {
    const h = harness();
    await run(["--fake-explode", "--lang", "en"], h.deps);
    expect(h.err()).toContain("error: engine said no");
  });
});

describe("a broken ./.env stops the run with a localized message", () => {
  it("exits 2 and prints no stack trace", async () => {
    const h = harness({
      loadEnv: () => ({
        loaded: false,
        error: { ru: "не удалось загрузить .env", en: "could not load .env" },
      }),
    });
    expect(await run(["--fake-beta"], h.deps)).toBe(EXIT_USAGE);
    expect(h.err()).toContain("не удалось загрузить .env");
  });

  it("is reported in the language argv asked for", async () => {
    const h = harness({
      loadEnv: () => ({
        loaded: false,
        error: { ru: "не удалось загрузить .env", en: "could not load .env" },
      }),
    });
    await run(["--lang", "en", "--fake-beta"], h.deps);
    expect(h.err()).toContain("could not load .env");
  });
});

/**
 * THE ONE-VOICE RULE (V2 audit MINOR-1).
 *
 * The completion and failure sentences used to reach stderr TWICE — once inside the `╔═╗` card
 * and once again as a bare trailing line — because a command's refusal path hands the message
 * to `ui.fail` and then writes it itself, an idiom from before the card existed. The card
 * carries the sentence in every mode, plain non-TTY lane included, so the bare line was the
 * same words a second time.
 *
 * The fix lives at the seam that owns the streams (`cli/src/main.ts`) rather than in the two
 * feature packages, so it holds for any command added later. These tests pin BOTH halves of it,
 * because getting only the first half right is how the sentence disappears instead: printed
 * once when there is a card, and still printed once when there is not.
 */
describe("the failure sentence is printed exactly once", () => {
  /** A recorder that is BOTH the UI's stream and `deps.stderr`, as `process.stderr` is in life. */
  function sharedStderr(): { chunks: string[]; write: (s: string) => void } {
    const chunks: string[] = [];
    return { chunks, write: (s: string) => void chunks.push(s) };
  }

  const occurrences = (haystack: string, needle: string): number =>
    haystack.split(needle).length - 1;

  it("once, not twice, when the UI draws a card", async () => {
    const sink = sharedStderr();
    // A real UI over a non-TTY stream: the plain lane, no escapes, and a card that still
    // carries the message — which is exactly the shape of a `2>` redirect or a CI log.
    const ui = createUi({ stream: { write: sink.write }, lang: "ru", env: {} });
    const h = harness({
      commands: [loudlyRefusingCommand],
      stderr: sink.write,
      ui: () => ui,
    });
    expect(await run(["--fake-loud-refuse"], h.deps)).toBe(EXIT_USAGE);
    expect(occurrences(sink.chunks.join(""), REFUSAL_TEXT.ru)).toBe(1);
  });

  it("still once, not zero, when the UI draws nothing", async () => {
    // `silentUi` writes no card, so suppressing the command's own line would lose the failure
    // altogether. Every hand-built test context in this repo is wired this way.
    const sink = sharedStderr();
    const h = harness({
      commands: [loudlyRefusingCommand],
      stderr: sink.write,
      ui: () => silentUi,
    });
    expect(await run(["--fake-loud-refuse"], h.deps)).toBe(EXIT_USAGE);
    expect(occurrences(sink.chunks.join(""), REFUSAL_TEXT.ru)).toBe(1);
  });

  it("once for a command that THROWS, and the --debug hint survives", async () => {
    const sink = sharedStderr();
    const ui = createUi({ stream: { write: sink.write }, lang: "ru", env: {} });
    const h = harness({ stderr: sink.write, ui: () => ui });
    expect(await run(["--fake-explode"], h.deps)).toBe(EXIT_FAILURE);
    const err = sink.chunks.join("");
    // The engine's own words, once. The card wraps long messages across box rows, so the
    // sentence is counted by the part that cannot be broken by wrapping.
    expect(occurrences(err, "engine said no")).toBe(1);
    // The hint is NOT the card's sentence and must still be there: it is the only thing telling
    // a user how to see the stack.
    expect(err).toContain("--debug");
  });
});
