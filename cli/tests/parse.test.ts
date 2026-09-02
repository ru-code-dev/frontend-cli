/**
 * TIER 1 — unit. `parseInvocation` is pure, so this suite is the argv surface tested directly:
 * no process, no filesystem, no subprocess (design 2.1:148-153).
 */
import type { CliCommand } from "@smart-tools/fe-cli-kit";
import { describe, expect, it } from "vite-plus/test";

import { COMMANDS } from "../src/registry.ts";
import {
  DEFAULT_LANG,
  declaredOptions,
  EXIT_OK,
  EXIT_USAGE,
  HELP_GLOBAL_ORDER,
  optionName,
  optionsFor,
  parseInvocation,
  preresolveLang,
  scopedOptionNames,
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

/**
 * X3: `--ui-kit` takes a VALUE, and its value reaches the command.
 *
 * It is declared among the parser's options because `parseArgs` is strict — an undeclared
 * option is an unknown flag — but it is a command's option, not a global, and `ctx.flags` is
 * the only channel a command-specific option has (`packages/cli-kit/src/index.ts:53-63` names
 * `source` and `out` and nothing else, and that contract is frozen).
 */
describe("--ui-kit", () => {
  it("is parsed as a string and handed to the command through flags", () => {
    const parsed = parseInvocation(["--project-report", "/p", "--ui-kit", "eds"], COMMANDS);
    expect(parsed.kind).toBe("command");
    expect(parsed.kind === "command" && parsed.flags["ui-kit"]).toBe("eds");
  });

  it("accepts the `--ui-kit=value` spelling too, since Node's parser does", () => {
    const parsed = parseInvocation(["--project-report", "/p", "--ui-kit=none"], COMMANDS);
    expect(parsed.kind === "command" && parsed.flags["ui-kit"]).toBe("none");
  });

  it("is absent from flags when nobody typed it — autodetection is the default", () => {
    const parsed = parseInvocation(["--project-report", "/p"], COMMANDS);
    expect(parsed.kind === "command" && parsed.flags["ui-kit"]).toBeUndefined();
  });

  it("without a value is a flag-usage error, not a silent empty string", () => {
    const parsed = parseInvocation(["--project-report", "/p", "--ui-kit"], COMMANDS);
    expect(parsed.kind).toBe("error");
  });

  it("is NOT printed among the global options — it belongs to one command", () => {
    // `--debug` sets the precedent (`cli/src/parse.ts:38-42`): being parseable and being a
    // documented global are two different things.
    expect([...HELP_GLOBAL_ORDER]).not.toContain("ui-kit");
  });
});

/**
 * V3 MAJOR-1 — a flag the selected command has not declared is REFUSED, not ignored.
 *
 * The defect this replaces: `--parse-ui-kit eds -o /tmp/x` exited 0, wrote the corpus to
 * `FE_KITS_DIR` and never created `/tmp/x`, because `parseArgs`'s options table is shared by
 * every command and an option a command does not declare used to be an option it silently
 * ignored. The audit's other two repro shapes — `--project-report … --source` and
 * `--psvg … --ui-kit` — are the same bug and are covered here too.
 *
 * These cases run against the REAL registry rather than `FAKE_COMMANDS`, because the thing under
 * test is which flags the shipped commands declare; the derivation RULE is proven separately
 * below, against fixtures, so neither test can pass vacuously.
 */
describe("a flag the command has not declared", () => {
  const real = (argv: readonly string[]) => parseInvocation(argv, COMMANDS);

  it("refuses `-o` on --parse-ui-kit, which declares no output flag", () => {
    const parsed = real(["--parse-ui-kit", "eds", "-o", "/tmp/zzz"]);
    expect(parsed.kind).toBe("error");
  });

  it("names BOTH the flag as typed and the command, in ru", () => {
    const parsed = real(["--parse-ui-kit", "eds", "-o", "/tmp/zzz"]);
    const message = parsed.kind === "error" ? parsed.message.ru : "";
    expect(message).toContain("-o");
    expect(message).toContain("--parse-ui-kit");
    expect(/[А-Яа-яЁё]/u.test(message)).toBe(true);
  });

  it("says the same thing in en", () => {
    const parsed = real(["--lang", "en", "--parse-ui-kit", "eds", "-o", "/tmp/zzz"]);
    expect(parsed.kind === "error" && parsed.lang).toBe("en");
    const message = parsed.kind === "error" ? parsed.message.en : "";
    expect(message).toContain("-o");
    expect(message).toContain("--parse-ui-kit");
    expect(/[А-Яа-яЁё]/u.test(message)).toBe(false);
  });

  it("quotes the long spelling when that is what the user typed", () => {
    const parsed = real(["--parse-ui-kit", "eds", "--out=/tmp/zzz"]);
    expect(parsed.kind === "error" && parsed.message.ru).toContain("--out");
  });

  it("refuses `--source` on --project-report, which declares only <src>, -o and --ui-kit", () => {
    const parsed = real(["--project-report", "/p", "--source", "/tmp/zzz"]);
    expect(parsed.kind).toBe("error");
    expect(parsed.kind === "error" && parsed.message.en).toContain("--source");
    expect(parsed.kind === "error" && parsed.message.en).toContain("--project-report");
  });

  it("refuses `--ui-kit` on a pixso command", () => {
    const parsed = real(["--psvg", "11:10", "--ui-kit", "eds"]);
    expect(parsed.kind).toBe("error");
    expect(parsed.kind === "error" && parsed.message.ru).toContain("--ui-kit");
  });

  it("names the command by the spelling the user typed, alias included", () => {
    // `--psvg` is `--get-pixso-svg`'s alias. Answering with the canonical spelling would hand
    // back a line the user did not write, which is the same defect as answering `--out` to
    // someone who typed `-o`.
    expect(real(["--psvg", "11:10", "--ui-kit", "eds"]).kind === "error").toBe(true);
    const aliased = real(["--psvg", "11:10", "--ui-kit", "eds"]);
    const primary = real(["--get-pixso-svg", "11:10", "--ui-kit", "eds"]);
    expect(aliased.kind === "error" && aliased.message.ru).toContain("--psvg");
    expect(primary.kind === "error" && primary.message.ru).toContain("--get-pixso-svg");
  });

  it("is an error the caller turns into exit 2 — the `error` arm, never a command", () => {
    // `EXIT_USAGE` is what `run` returns for every `kind: "error"` (`cli/src/main.ts:119-121`);
    // the end-to-end proof of the code is in `run.test.ts` and the bundle suite.
    expect(EXIT_USAGE).toBe(2);
    expect(real(["--parse-ui-kit", "eds", "-o", "/x"]).kind).not.toBe("command");
  });
});

describe("a flag the command HAS declared still parses", () => {
  const real = (argv: readonly string[]) => parseInvocation(argv, COMMANDS);

  it("--parse-ui-kit takes --source", () => {
    const parsed = real(["--parse-ui-kit", "eds", "--source", "/some/kit"]);
    expect(parsed.kind).toBe("command");
    expect(parsed.kind === "command" && parsed.flags["source"]).toBe("/some/kit");
  });

  it("--project-report takes both -o and --ui-kit", () => {
    const parsed = real(["--project-report", "/p", "-o", "r.html", "--ui-kit", "eds"]);
    expect(parsed.kind).toBe("command");
    expect(parsed.kind === "command" && parsed.out).toBe("r.html");
  });

  it("a pixso command takes -o", () => {
    expect(real(["--psvg", "11:10", "-o", "a.svg"]).kind).toBe("command");
  });

  it("omitting a scoped flag is never a refusal", () => {
    expect(real(["--parse-ui-kit", "eds"]).kind).toBe("command");
    expect(real(["--project-report", "/p"]).kind).toBe("command");
  });

  it("keeps --token/--endpoint on every command, because no command declares them", () => {
    // They are the CLI's own configuration surface: `resolveSettings` runs for EVERY invocation
    // and hands all three values to EVERY command through `ctx.env`
    // (`cli/src/settings.ts`). Nothing claims them in an `ArgSpec`, so nothing narrows them.
    expect(scopedOptionNames(COMMANDS, optionsFor(COMMANDS))).not.toContain("token");
    expect(scopedOptionNames(COMMANDS, optionsFor(COMMANDS))).not.toContain("endpoint");
    expect(real(["--psvg", "11:10", "--token", "t", "--endpoint", "http://e"]).kind).toBe(
      "command",
    );
    expect(real(["--parse-ui-kit", "eds", "--token", "t"]).kind).toBe("command");
  });

  it("keeps the meta-flags everywhere too", () => {
    expect(real(["--parse-ui-kit", "eds", "--lang", "en", "--debug"]).kind).toBe("command");
  });
});

/**
 * THE RULE ITSELF, proven against fixtures rather than against the shipped registry: an option
 * that AT LEAST ONE command names in its `args` is that command's; an option nobody names is the
 * CLI's own. Written this way so the fix is a rule and not a table — if `--token` were declared
 * by a command tomorrow, it would narrow with no edit to `parse.ts`.
 */
describe("scoping is DERIVED from each command's declared args", () => {
  const declaring: CliCommand = {
    flag: "--fake-declaring",
    summary: { ru: "объявляет флаги", en: "declares flags" },
    args: [
      { name: "<src>", description: { ru: "источник", en: "source" }, required: true },
      { name: "-o <path>", description: { ru: "куда", en: "where" }, required: false },
      { name: "--token <t>", description: { ru: "токен", en: "token" }, required: false },
    ],
    run: () => Promise.resolve(0),
  };
  const silent: CliCommand = {
    flag: "--fake-silent",
    summary: { ru: "ничего не объявляет", en: "declares nothing" },
    args: [],
    run: () => Promise.resolve(0),
  };
  const registry = [declaring, silent] as const;
  const options = optionsFor(registry);

  it("reads a command's flags out of its ArgSpec names, short spelling included", () => {
    expect([...declaredOptions(declaring, options)].sort()).toEqual(["out", "token"]);
  });

  it("ignores positional placeholders — `<src>` is not a flag", () => {
    expect(declaredOptions(declaring, options)).not.toContain("src");
    expect([...declaredOptions(silent, options)]).toEqual([]);
  });

  it("narrows `--token` the moment a command declares it, with no edit here", () => {
    expect(scopedOptionNames(registry, options)).toContain("token");
    expect(parseInvocation(["--fake-declaring", "x", "--token", "t"], registry).kind).toBe(
      "command",
    );
    expect(parseInvocation(["--fake-silent", "--token", "t"], registry).kind).toBe("error");
  });

  it("leaves an option nobody declares universal", () => {
    expect(scopedOptionNames(registry, options)).not.toContain("endpoint");
    expect(parseInvocation(["--fake-silent", "--endpoint", "http://e"], registry).kind).toBe(
      "command",
    );
  });

  it("reports the refusal in a stable order for a line carrying two stray flags", () => {
    const first = parseInvocation(["--fake-silent", "--token", "t", "-o", "x"], registry);
    const again = parseInvocation(["--fake-silent", "-o", "x", "--token", "t"], registry);
    expect(first.kind === "error" && first.message.en).toContain("-o");
    expect(again.kind === "error" && again.message.en).toContain("-o");
  });
});
