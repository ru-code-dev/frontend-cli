/**
 * TIER 1 — unit. The help page is GENERATED, so the thing to test is the generation.
 *
 * REWRITTEN FOR THE UX REDESIGN. The old suite asserted that every argument DESCRIPTION appeared
 * on the main page, which is precisely what the owner rejected: four commands × a three-line
 * paragraph, and a 160-column usage line
 * (`WORKFLOW/features/cli-ux/plans/current-output.txt`, diagnosis 3). The contract is now
 * `WORKFLOW/features/cli-ux/plans/ux-design.md` §2.7 and §2.8, and the split it makes is the
 * thing under test: the TABLE carries names, one-line summaries and default outputs; the PROSE
 * lives on `fg --help --<command>`.
 */
import { argName, pick, usageHintOf } from "@smart-tools/fg-cli-kit";
import { describe, expect, it } from "vite-plus/test";

import {
  HELP_WIDTH,
  commandHelpText,
  commandUsageLine,
  displayName,
  helpText,
} from "../src/help.ts";
import { parsableKitNames } from "@smart-tools/fg-project-report";

import { COMMANDS } from "../src/registry.ts";
import { FAKE_COMMANDS, alphaCommand, betaCommand } from "./fixtures.ts";

const LANGS = ["ru", "en"] as const;

/** Every line's width in CODE POINTS — Cyrillic is one column and two bytes. */
const widths = (text: string): number[] => text.split("\n").map((line) => [...line].length);

const takesOut = (c: (typeof COMMANDS)[number]): boolean =>
  c.args.some((a) => argName(a, "en").startsWith("-o "));

describe("the help TABLE — design 2.7", () => {
  for (const lang of LANGS) {
    describe(lang, () => {
      const text = helpText(FAKE_COMMANDS, lang, "1.2.3");

      it("opens with `fg v<version> — <tagline>`", () => {
        expect(text.split("\n")[0]).toBe(
          `fg v1.2.3 — ${lang === "ru" ? "фронтенд-инструменты в командной строке" : "frontend tools on the command line"}`,
        );
      });

      it("shows the SHORT alias as the display name, and NOT the long spelling (U8)", () => {
        const line = text.split("\n").find((l) => l.includes("--falpha"));
        expect(line).toBeDefined();
        // The long spelling belongs to the per-command page; putting both in the table is what
        // made the first column a paragraph.
        expect(text).not.toContain("--fake-alpha");
        expect(line).toContain(pick(alphaCommand.summary, lang));
      });

      it("falls back to the flag for a command with no alias", () => {
        expect(text).toContain("--fake-beta");
      });

      it("groups the commands, in the groups' own order, not the registry's", () => {
        const alpha = text.indexOf(lang === "ru" ? "Альфа-группа" : "Alpha group");
        const beta = text.indexOf(lang === "ru" ? "Бета-группа" : "Beta group");
        expect(alpha).toBeGreaterThan(-1);
        expect(beta).toBeGreaterThan(alpha);
        // `--falpha` is in the first group and `--fake-beta` in the second, so the commands
        // follow their headings rather than the array they were registered in.
        expect(text.indexOf("--falpha")).toBeGreaterThan(alpha);
        expect(text.indexOf("--fake-beta")).toBeGreaterThan(beta);
      });

      it("carries the `без -o →` heading once, over the defaultOut column", () => {
        const heading = lang === "ru" ? "без -o →" : "without -o →";
        expect(text.split(heading)).toHaveLength(2);
        const row = text.split("\n").find((l) => l.includes("--falpha")) ?? "";
        const headingLine = text.split("\n").find((l) => l.includes(heading)) ?? "";
        // The column starts where the heading does.
        expect(row.indexOf("./fg-out/alpha.txt")).toBe(headingLine.indexOf(heading));
      });

      it("prints an argument's one-line HINT, and never its full description", () => {
        expect(text).toContain(pick(alphaCommand.args[1]?.hint ?? { ru: "", en: "" }, lang));
        expect(text).not.toContain(
          pick(alphaCommand.args[1]?.description ?? { ru: "", en: "" }, lang),
        );
        // The positional's description is not on this page either.
        expect(text).not.toContain(
          pick(alphaCommand.args[0]?.description ?? { ru: "", en: "" }, lang),
        );
      });

      it("lists every global except the hidden --debug", () => {
        for (const spelling of ["--out", "--lang", "--verbose", "--token", "--help", "--version"]) {
          expect(text).toContain(spelling);
        }
        expect(text).toContain("-o,");
        expect(text).toContain("-h,");
        expect(text).toContain("-v,");
        expect(text).not.toContain("--debug");
      });

      it("names the four environment variables on one row", () => {
        for (const name of [
          "PIXSO_REMOTE_MCP_URL",
          "PIXSO_LOCAL_MCP_URL",
          "PIXSO_REMOTE_MCP_TOKEN",
          "FG_KITS_DIR",
        ]) {
          expect(text).toContain(name);
        }
        expect(text).toContain(".env");
      });

      it("carries the version it was given", () => {
        expect(text).toContain("1.2.3");
      });

      it("stays inside 100 columns", () => {
        expect(Math.max(...widths(text))).toBeLessThanOrEqual(HELP_WIDTH);
      });
    });
  }

  it("the two languages are genuinely different documents, headings included", () => {
    const ru = helpText(FAKE_COMMANDS, "ru", "1.2.3");
    const en = helpText(FAKE_COMMANDS, "en", "1.2.3");
    expect(ru).not.toBe(en);
    expect(ru).toContain("Использование");
    expect(en).toContain("Usage");
    expect(ru).toContain("Общие опции");
    expect(en).toContain("Common options");
  });

  it("renders an EMPTY registry as an explicit statement, not as blankness", () => {
    expect(helpText([], "ru", "0.0.0")).toContain("ни одной не зарегистрировано");
    expect(helpText([], "en", "0.0.0")).toContain("none registered");
  });
});

describe("the help TABLE — the REAL registry", () => {
  for (const lang of LANGS) {
    it(`fits in 100 columns with every shipped command, in ${lang}`, () => {
      expect(Math.max(...widths(helpText(COMMANDS, lang, "1.0.0")))).toBeLessThanOrEqual(
        HELP_WIDTH,
      );
    });

    it(`shows every command ONCE, by its short alias, in ${lang}`, () => {
      const text = helpText(COMMANDS, lang, "1.0.0");
      for (const command of COMMANDS) {
        const name = displayName(command);
        expect(text).toContain(name);
        // Once as a row, and never a second time as a long spelling beside it.
        const rows = text.split("\n").filter((line) => line.trimStart().startsWith(`${name} `));
        expect(rows).toHaveLength(1);
      }
    });

    /** THE LITERAL SURFACE. Every case above is fed by the registry and so cannot notice the
     *  registry LOSING an entry — it would simply assert less. These are written out. */
    it(`lists --preport, --pkit, --iconf and the four pixso aliases, in ${lang}`, () => {
      const text = helpText(COMMANDS, lang, "1.0.0");
      for (const name of [
        "--psvg",
        "--phtml",
        "--pprompt",
        "--passets",
        "--preport",
        "--pkit",
        "--iconf",
      ]) {
        expect(text).toContain(name);
      }
    });

    /**
     * V5 FINDING #13 — §2.7 orders «Анализ проекта» `--preport`, `--iconf`, `--pkit`; the page
     * shipped `--preport`, `--pkit`, `--iconf`. The order inside a group is the registry array's
     * (`cli/src/registry.ts`), so this is the assertion that pins it.
     */
    it(`orders the analysis group --preport → --iconf → --pkit, in ${lang}`, () => {
      const text = helpText(COMMANDS, lang, "1.0.0");
      const at = (name: string): number =>
        text.split("\n").findIndex((line) => line.trimStart().startsWith(`${name} `));
      expect(at("--preport")).toBeGreaterThan(-1);
      expect(at("--iconf")).toBe(at("--preport") + 4);
      expect(at("--pkit")).toBe(at("--iconf") + 1);
    });

    /**
     * V5 FINDING #14 — §2.5/§2.7 spell `--pkit eds` → `~/.fg/kits/eds/`. The generalised
     * `<имя>`/`<name>` was a placeholder standing for a set of one.
     *
     * Now a set of TWO, which is the case the finding was really about: the row NAMES both kits
     * and both corpus directories rather than collapsing them into a placeholder again. Written
     * as "each registered kit appears" rather than as a literal string, so a third one widens
     * the row instead of failing this test for the wrong reason.
     */
    it(`spells --pkit's row with the kits themselves, not a placeholder, in ${lang}`, () => {
      const row =
        helpText(COMMANDS, lang, "1.0.0")
          .split("\n")
          .find((line) => line.trimStart().startsWith("--pkit ")) ?? "";
      for (const kit of parsableKitNames()) {
        expect(row).toContain(kit);
      }
      expect(row).toContain("~/.fg/kits/");
      expect(row).not.toContain("<имя>");
      expect(row).not.toContain("<name>");
    });

    it(`names each command's default output in the \`без -o →\` column, in ${lang}`, () => {
      const text = helpText(COMMANDS, lang, "1.0.0");
      for (const command of COMMANDS) {
        if (command.defaultOut === null) continue;
        const row = text.split("\n").find((l) => l.trimStart().startsWith(displayName(command)));
        expect(row).toContain(pick(command.defaultOut, lang));
      }
    });

    it(`documents --ui-kit, --config and --format under --preport as ONE line each, in ${lang}`, () => {
      const text = helpText(COMMANDS, lang, "1.0.0");
      for (const flag of ["--ui-kit", "--config", "--format"]) {
        const row = text.split("\n").find((l) => l.trimStart().startsWith(flag));
        expect(row).toBeDefined();
        expect([...(row ?? "")].length).toBeLessThanOrEqual(HELP_WIDTH);
      }
    });

    /**
     * U1's four values, on the page, in the `--format` row — `html` included.
     *
     * It is the DEFAULT and it used to be the one value the row did not name (the row read
     * `--format <compact|json|sarif>`), which made the page disagree with the flag it was
     * documenting. `--lint` is asserted absent for the same reason: a deleted flag that still
     * appears on the help page is a flag users will keep typing.
     */
    it(`names every --format value, and no --lint, in ${lang}`, () => {
      const text = helpText(COMMANDS, lang, "1.0.0");
      const row = text.split("\n").find((l) => l.trimStart().startsWith("--format")) ?? "";
      for (const value of ["html", "compact", "json", "sarif"]) expect(row).toContain(value);
      expect(text).not.toContain("--lint");
    });
  }

  it("every command carries the metadata the page needs", () => {
    for (const command of COMMANDS) {
      expect(command.group.id).not.toBe("");
      expect(command.summary.ru).not.toBe("");
      expect(command.summary.en).not.toBe("");
      // `--passets`'s summary is `svg + html + md + json` in both languages, and rightly so —
      // it is a list of file extensions. The PROSE is what must be two documents.
      expect(command.details?.ru).not.toBe(command.details?.en);
      // The design budgets the summary column 40 columns; a longer one is a paragraph again.
      expect([...command.summary.ru].length).toBeLessThanOrEqual(40);
      expect([...command.summary.en].length).toBeLessThanOrEqual(40);
      expect(command.details?.ru.length ?? 0).toBeGreaterThan(0);
    }
  });

  /**
   * THE OWNER'S LAW, as the help page states it: `-o` is optional for every command that takes
   * one. A sweep over the real registry rather than an assertion per command, so a command added
   * later that declares `-o` required fails here instead of shipping as the one exception.
   */
  it("`-o` is OPTIONAL on every command that takes one", () => {
    const withOut = COMMANDS.filter(takesOut);
    expect(withOut).toHaveLength(6);
    for (const command of withOut) {
      expect(command.args.find((a) => argName(a, "en").startsWith("-o "))?.required).toBe(false);
    }
  });

  /**
   * THE OWNER'S REMOTE-FIRST LAW, at the page level and over the SHIPPED registry.
   *
   * The remote route — a design link plus a token — is the main story of the pixso commands, so
   * the first example on each of their pages is the link, spelled with the `<pixso-link>`
   * placeholder (`packages/fg-pixso/src/strings.ts`'s `PIXSO_LINK`). And no page, in either
   * language, prints a URL: a literal address in a help page is a string a reader tries to copy,
   * and it is never their file. Swept over the whole registry rather than asserted per command,
   * so a command added later that pastes an address into an example fails here.
   *
   * `http(s)://…` in `--preport`'s own prose is NOT a URL and is deliberately not caught: it is
   * the shape of an accepted argument, spelled the way the parenthesis makes unmistakable.
   */
  it("no help page prints a URL, and every pixso page leads with <pixso-link>", () => {
    for (const lang of LANGS) {
      const pages = [
        helpText(COMMANDS, lang, "1.0.0"),
        ...COMMANDS.map((command) => commandHelpText(command, lang)),
      ];
      for (const page of pages) expect(page).not.toMatch(/https?:\/\//u);
    }
    const pixso = COMMANDS.filter((command) => command.group.id === "pixso");
    expect(pixso).toHaveLength(4);
    for (const command of pixso) {
      expect(command.examples?.[0]).toBe(`fg ${displayName(command)} <pixso-link>`);
      for (const lang of LANGS) {
        expect(commandHelpText(command, lang)).toContain(`fg ${displayName(command)} <pixso-link>`);
      }
    }
  });

  /**
   * V5 FINDING #12 — ONE CONVENTION PER PAGE.
   *
   * The ru page mixed `-o, --out <путь>` under «Общие опции» with `<path|repo>` and
   * `--config <file>` in the table above it. §2.7 spells both in Russian, so every placeholder
   * a shipped command declares must differ between the languages or be language-neutral: an
   * `<...>` placeholder that reads the same in ru and en is the defect, and a bare flag or a
   * value list (`--format html|compact|json|sarif`) is not a placeholder at all.
   */
  it("every ru placeholder is Russian — no `<path>`/`<file>`/`<dir>`/`<name>` anywhere in ru", () => {
    const pages = [
      helpText(COMMANDS, "ru", "1.0.0"),
      ...COMMANDS.map((command) => commandHelpText(command, "ru")),
    ];
    for (const page of pages) {
      for (const forbidden of ["<path>", "<path|", "<file", "<dir", "<name"]) {
        expect(page).not.toContain(forbidden);
      }
    }
    // `<url|guid>` and `eds|none` are NOT placeholders to translate: a URL is a URL and a value
    // list is the value list the parser reads back. What must be Russian is the WORDS.
    expect(helpText(COMMANDS, "ru", "1.0.0")).toContain("<путь|repo>");
    expect(helpText(COMMANDS, "ru", "1.0.0")).toContain("<файл>");
  });
});

describe("the PER-COMMAND page — design 2.8", () => {
  for (const lang of LANGS) {
    it(`opens with ONE elided usage line, the long spelling on the line below, in ${lang}`, () => {
      const page = commandHelpText(alphaCommand, lang);
      const [usage, also] = page.split("\n");
      // §2.8's elision: a long flag that takes a value is `--config …`, not its value list. The
      // 127-column line V5 finding #5 measured was the value lists, expanded, plus both
      // spellings of the command in the first column.
      expect(usage).toBe("fg --falpha <url|guid> [--config …]");
      expect(usage).toBe(commandUsageLine(alphaCommand, lang));
      expect(usage).not.toContain("--fake-alpha");
      // The long spelling is still taught — on its own line, where it costs no width (#5).
      expect(also).toBe(`  ${lang === "ru" ? "также:" : "also:"} --fake-alpha`);
    });

    it(`prints the details paragraph and EVERY argument's full description, in ${lang}`, () => {
      const page = commandHelpText(alphaCommand, lang);
      expect(page).toContain(pick(alphaCommand.details ?? { ru: "", en: "" }, lang));
      for (const arg of alphaCommand.args) {
        expect(page).toContain(argName(arg, lang));
        // Wrapped, so a long description is matched by its first words rather than whole.
        expect(page).toContain(pick(arg.description, lang).split(" ")[0] ?? "");
      }
    });

    it(`prints the examples under their heading, in ${lang}`, () => {
      const page = commandHelpText(alphaCommand, lang);
      expect(page).toContain(lang === "ru" ? "Примеры" : "Examples");
      expect(page).toContain("fg --falpha 11:10");
    });

    it(`omits the blocks a command does not ship, in ${lang}`, () => {
      const page = commandHelpText(betaCommand, lang);
      expect(page).not.toContain(lang === "ru" ? "Примеры" : "Examples");
      // No alias, so no `также:` line either: the page states what the command has.
      expect(page.trim()).toBe("fg --fake-beta");
    });
  }

  /**
   * THE WIDTH GUARD, EXTENDED TO THE USAGE LINE — V5 finding #5.
   *
   * `rows.slice(1)` is why a 127-column `--preport` usage line shipped: the guard measured
   * everything on the page EXCEPT its first line, on the reasoning that a command line is never
   * broken. True, and beside the point — §2.7 caps the page at 100 columns and §0.3 lists "the
   * `--preport` usage line is 160 chars" as a headline defect of the OLD output. A line that
   * cannot be wrapped must be short enough not to need it, which is what the elision buys.
   */
  it("no line of a shipped per-command page exceeds the width — INCLUDING the usage line", () => {
    for (const command of COMMANDS) {
      for (const lang of LANGS) {
        for (const row of commandHelpText(command, lang).split("\n")) {
          expect([...row].length).toBeLessThanOrEqual(HELP_WIDTH);
        }
        expect([...commandUsageLine(command, lang)].length).toBeLessThanOrEqual(HELP_WIDTH);
      }
    }
  });

  /**
   * ONE BUILDER — V5 finding #8. `usageHintOf` (what a refusal quotes) and `commandUsageLine`
   * (what the page prints) used to be two functions, and they disagreed in the same session:
   * `fg --preport <path|repo> …` from one, `fg --preport, --project-report <path|repo> …` from
   * the other. There is one now, and this is the assertion that keeps it that way.
   */
  it("a refusal and the help page quote the SAME usage line, in both languages", () => {
    for (const command of COMMANDS) {
      for (const lang of LANGS) {
        expect(usageHintOf(command, lang).usage).toBe(commandUsageLine(command, lang));
      }
    }
  });

  it("the two languages are two documents", () => {
    expect(commandHelpText(alphaCommand, "ru")).not.toBe(commandHelpText(alphaCommand, "en"));
  });

  /** §2.8's own spelling of the `--preport` page's first line, in full. */
  it("the --preport usage line is §2.8's, elided and under 100 columns", () => {
    const preport = COMMANDS.find((c) => c.alias === "--preport");
    expect(preport).toBeDefined();
    expect(commandUsageLine(preport as (typeof COMMANDS)[number], "ru")).toBe(
      "fg --preport <путь|repo> [-o <путь>] [--format …] [--ui-kit …] [--config …]",
    );
  });
});
