/**
 * TIER 1 — unit. `parseInvocation` is pure, so this suite is the argv surface tested directly:
 * no process, no filesystem, no subprocess (design 2.1:148-153).
 */
import { describe, expect, it } from "vite-plus/test";

import { COMMANDS } from "../src/registry.ts";
import {
  DEFAULT_LANG,
  EXIT_OK,
  EXIT_USAGE,
  optionName,
  optionsFor,
  parseInvocation,
  preresolveLang,
} from "../src/parse.ts";
import { FAKE_COMMANDS, alphaCommand, betaCommand } from "./fixtures.ts";

const parse = (argv: readonly string[]) => parseInvocation(argv, FAKE_COMMANDS);

describe("the parser table is GENERATED from the registry", () => {
  it("gives every command flag AND every alias its own entry", () => {
    const options = optionsFor(FAKE_COMMANDS) ?? {};
    for (const command of FAKE_COMMANDS) {
      expect(options[optionName(command.flag)]).toBeDefined();
      if (command.alias !== undefined) {
        expect(options[optionName(command.alias)]).toBeDefined();
      }
    }
  });

  it("carries the globals, including the hidden --debug", () => {
    const options = optionsFor([]) ?? {};
    for (const name of ["out", "token", "endpoint", "lang", "help", "version", "debug"]) {
      expect(options[name]).toBeDefined();
    }
  });

  it("registers command flags as `multiple` so repeats stay countable", () => {
    // The one-command rule depends on this: verified against node v24.14.1, a plain boolean
    // collapses `--falpha --falpha` to `true` and the repetition becomes invisible.
    const options = optionsFor(FAKE_COMMANDS) ?? {};
    expect(options["fake-alpha"]).toMatchObject({ type: "boolean", multiple: true });
  });

  it("does the same for the REAL registry — whatever it holds today", () => {
    const options = optionsFor(COMMANDS) ?? {};
    for (const command of COMMANDS) {
      expect(options[optionName(command.flag)]).toBeDefined();
      if (command.alias !== undefined) {
        expect(options[optionName(command.alias)]).toBeDefined();
      }
    }
  });
});

describe("every spelling of every command resolves to that command", () => {
  for (const command of FAKE_COMMANDS) {
    const spellings = [command.flag, ...(command.alias === undefined ? [] : [command.alias])];
    for (const spelling of spellings) {
      it(`${spelling} -> ${command.flag}`, () => {
        const result = parse([spelling, "src"]);
        expect(result.kind).toBe("command");
        if (result.kind !== "command") return;
        expect(result.command.flag).toBe(command.flag);
        expect(result.source).toBe("src");
      });
    }
  }
});

describe("globals map onto the invocation", () => {
  it("reads -o, --out, --token and --endpoint", () => {
    const result = parse([
      "--fake-alpha",
      "https://example/design",
      "-o",
      "card.svg",
      "--token",
      "t0k",
      "--endpoint",
      "http://host/mcp",
    ]);
    expect(result.kind).toBe("command");
    if (result.kind !== "command") return;
    expect(result.out).toBe("card.svg");
    expect(result.token).toBe("t0k");
    expect(result.endpoint).toBe("http://host/mcp");
    expect(result.source).toBe("https://example/design");
  });

  it("--out and -o are the same option", () => {
    const viaLong = parse(["--fake-beta", "--out", "d"]);
    const viaShort = parse(["--fake-beta", "-o", "d"]);
    expect(viaLong.kind === "command" ? viaLong.out : null).toBe("d");
    expect(viaShort.kind === "command" ? viaShort.out : null).toBe("d");
  });

  it("--debug is parsed but never advertised", () => {
    const result = parse(["--fake-beta", "--debug"]);
    expect(result.kind === "command" ? result.debug : null).toBe(true);
    expect(parse(["--fake-beta"]).kind === "command" ? parse(["--fake-beta"]) : null).toBeTruthy();
  });

  it("passes the globals on to the command through ctx.flags", () => {
    const result = parse(["--fake-beta", "-o", "x", "--token", "y"]);
    if (result.kind !== "command") throw new Error("expected a command");
    expect(result.flags["out"]).toBe("x");
    expect(result.flags["token"]).toBe("y");
    // Command-flag booleans are deliberately absent: `CommandContext.flags` is typed
    // `string | boolean | undefined` and `multiple: true` produces arrays.
    expect(result.flags["fake-beta"]).toBeUndefined();
  });
});

describe("exactly one command per invocation", () => {
  it("0 commands -> help, exit 2", () => {
    const result = parse([]);
    expect(result.kind).toBe("help");
    expect(result.kind === "help" ? result.exitCode : null).toBe(EXIT_USAGE);
  });

  it("0 commands but a source -> still help, exit 2", () => {
    const result = parse(["some-guid"]);
    expect(result.kind).toBe("help");
    expect(result.kind === "help" ? result.exitCode : null).toBe(EXIT_USAGE);
  });

  it("2 different commands -> localized error", () => {
    const result = parse(["--fake-alpha", "--fake-beta", "g"]);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message.ru).not.toBe("");
    expect(result.message.en).not.toBe("");
    expect(result.message.ru).not.toBe(result.message.en);
  });

  it("the SAME command twice under two spellings is still two flags", () => {
    const result = parse(["--fake-alpha", "--falpha", "g"]);
    expect(result.kind).toBe("error");
  });

  it("the same flag repeated is two flags", () => {
    expect(parse(["--falpha", "--falpha", "g"]).kind).toBe("error");
  });

  it("exactly 1 dispatches", () => {
    expect(parse(["--fake-alpha", "g"]).kind).toBe("command");
  });
});

describe("--help and --version outrank everything", () => {
  it("--help alone -> help, exit 0", () => {
    const result = parse(["--help"]);
    expect(result.kind).toBe("help");
    expect(result.kind === "help" ? result.exitCode : null).toBe(EXIT_OK);
  });

  it("-h is --help", () => {
    expect(parse(["-h"]).kind).toBe("help");
  });

  it("--help beside a command still shows help", () => {
    const result = parse(["--fake-alpha", "g", "--help"]);
    expect(result.kind).toBe("help");
    expect(result.kind === "help" ? result.exitCode : null).toBe(EXIT_OK);
  });

  it("--version and -v", () => {
    expect(parse(["--version"]).kind).toBe("version");
    expect(parse(["-v"]).kind).toBe("version");
  });

  it("--help outranks --version", () => {
    expect(parse(["--version", "--help"]).kind).toBe("help");
  });
});

describe("bad input is an error, not a crash", () => {
  it("an unknown long flag is named back to the user, localized", () => {
    const result = parse(["--nope"]);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message.ru).toContain("--nope");
    expect(result.message.en).toContain("--nope");
    // The English word is in the English message only — the frame is translated, not the token.
    expect(result.message.en).toContain("unknown flag");
    expect(result.message.ru).not.toContain("unknown flag");
  });

  it("an unknown short flag is named too", () => {
    const result = parse(["-z"]);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message.en).toContain("-z");
  });

  it("an unknown flag in en stays en", () => {
    const result = parse(["--lang", "en", "--nope"]);
    expect(result.lang).toBe("en");
  });

  it("a known flag missing its value is an error, not a throw", () => {
    const result = parse(["--fake-beta", "--out"]);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message.ru).not.toBe("");
    expect(result.message.en).not.toBe("");
  });

  it("a boolean flag given a value is an error", () => {
    expect(parse(["--fake-beta=x"]).kind).toBe("error");
  });

  it("an unknown --lang value is reported, naming the value", () => {
    const result = parse(["--lang", "de", "--fake-beta"]);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message.ru).toContain("de");
    expect(result.message.en).toContain("de");
  });

  it("never throws, whatever it is handed", () => {
    for (const argv of [["--"], ["-"], ["--=x"], ["-abc"], ["--fake-alpha", "--", "-o"]]) {
      expect(() => parse(argv)).not.toThrow();
    }
  });
});

describe("language resolution", () => {
  it("defaults to ru", () => {
    expect(DEFAULT_LANG).toBe("ru");
    expect(preresolveLang([])).toBe("ru");
    expect(parse(["--fake-beta"]).lang).toBe("ru");
  });

  it("--lang en switches", () => {
    expect(preresolveLang(["--lang", "en"])).toBe("en");
    expect(parse(["--lang", "en", "--fake-beta"]).lang).toBe("en");
  });

  it("--lang=en switches too", () => {
    expect(preresolveLang(["--lang=en"])).toBe("en");
  });

  it("--lang ru is explicit ru", () => {
    expect(preresolveLang(["--lang", "ru"])).toBe("ru");
  });

  it("an unrecognized value falls back to ru — validation belongs to the real parse", () => {
    expect(preresolveLang(["--lang", "de"])).toBe("ru");
  });

  it("stops at the `--` terminator", () => {
    expect(preresolveLang(["--", "--lang", "en"])).toBe("ru");
  });
});

describe("the positional is the source", () => {
  it("is undefined when absent", () => {
    const result = parse(["--fake-beta"]);
    expect(result.kind === "command" ? result.source : "x").toBeUndefined();
  });

  it("survives flags on either side of it", () => {
    const result = parse(["-o", "d", "--fake-alpha", "the-guid", "--token", "t"]);
    expect(result.kind === "command" ? result.source : null).toBe("the-guid");
  });

  it("does not confuse a command with its neighbour", () => {
    expect(alphaCommand.flag).not.toBe(betaCommand.flag);
  });
});
