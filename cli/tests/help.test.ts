/**
 * TIER 1 — unit. The help page is GENERATED, so the thing to test is the generation: that every
 * registered spelling reaches the page, in BOTH languages, without a hand-kept list anywhere
 * (design 2.1:81-82, brief 3.3 deliverable 5).
 */
import { pick } from "@smart-tools/fe-cli-kit";
import { describe, expect, it } from "vite-plus/test";

import { helpText } from "../src/help.ts";
import { COMMANDS } from "../src/registry.ts";
import { FAKE_COMMANDS } from "./fixtures.ts";

const LANGS = ["ru", "en"] as const;

describe("generated help — every registered command, in both languages", () => {
  for (const lang of LANGS) {
    describe(lang, () => {
      const text = helpText(FAKE_COMMANDS, lang, "1.2.3");

      for (const command of FAKE_COMMANDS) {
        it(`lists ${command.flag}`, () => {
          expect(text).toContain(command.flag);
        });

        if (command.alias !== undefined) {
          const alias = command.alias;
          it(`lists the alias ${alias} beside it`, () => {
            expect(text).toContain(alias);
            // Same line: an alias printed in a distant footnote is one a user will not find.
            const line = text.split("\n").find((l) => l.includes(command.flag));
            expect(line).toBeDefined();
            expect(line).toContain(alias);
          });
        }

        it(`prints ${command.flag}'s summary in ${lang}`, () => {
          expect(text).toContain(pick(command.summary, lang));
        });

        for (const arg of command.args) {
          it(`prints ${command.flag}'s argument ${arg.name} and its ${lang} description`, () => {
            expect(text).toContain(arg.name);
            expect(text).toContain(pick(arg.description, lang));
          });
        }
      }

      it("lists every global except the hidden --debug", () => {
        for (const spelling of [
          "--out",
          "--token",
          "--endpoint",
          "--lang",
          "--help",
          "--version",
        ]) {
          expect(text).toContain(spelling);
        }
        expect(text).toContain("-o");
        expect(text).toContain("-h");
        expect(text).toContain("-v");
        expect(text).not.toContain("--debug");
      });

      it("names the three settings and the precedence order", () => {
        expect(text).toContain("PIXSO_REMOTE_MCP_URL");
        expect(text).toContain("PIXSO_LOCAL_MCP_URL");
        expect(text).toContain("PIXSO_REMOTE_MCP_TOKEN");
      });

      /**
       * V3 MINOR-2: `FE_KITS_DIR` had zero occurrences in the help in either language, in the
       * one block that exists to enumerate the environment variables. It is the override for
       * where `--parse-ui-kit` writes and `--project-report` reads
       * (`packages/fe-eds-adapter/src/corpus.ts:67-76`), so its absence was the block being
       * incomplete rather than the variable being internal.
       */
      it("names FE_KITS_DIR and its default, among the environment variables", () => {
        expect(text).toContain("FE_KITS_DIR");
        expect(text).toContain("~/.fe/kits");
      });

      it("carries the version it was given", () => {
        expect(text).toContain("1.2.3");
      });
    });
  }

  it("the two languages are genuinely different documents", () => {
    const ru = helpText(FAKE_COMMANDS, "ru", "1.2.3");
    const en = helpText(FAKE_COMMANDS, "en", "1.2.3");
    expect(ru).not.toBe(en);
    // Headings, not just summaries: the page is rendered per language, not wrapped.
    expect(ru).toContain("команды:");
    expect(en).toContain("commands:");
    expect(ru).toContain("использование:");
    expect(en).toContain("usage:");
  });
});

describe("generated help — the REAL registry", () => {
  /**
   * THE OWNER'S LAW, as the help page states it: `-o` is optional for every command that takes
   * one, so every command that takes one renders it in BRACKETS. A sweep over the real registry
   * rather than an assertion per command, so a command added later that declares `-o` required
   * fails here instead of shipping as the one exception nobody notices.
   */
  for (const lang of LANGS) {
    it(`renders \`-o\` as OPTIONAL for every command that takes one, in ${lang}`, () => {
      const text = helpText(COMMANDS, lang, "1.2.3");
      const withOut = COMMANDS.filter((c) => c.args.some((a) => a.name.startsWith("-o ")));
      // All four pixso commands and the report — a registry that stopped offering `-o` at all
      // would otherwise pass this vacuously.
      expect(withOut).toHaveLength(5);
      for (const command of withOut) {
        const out = command.args.find((a) => a.name.startsWith("-o "));
        expect(out?.required).toBe(false);
        const line = text.split("\n").find((l) => l.includes(command.flag));
        expect(line).toContain(`[${out?.name ?? ""}]`);
        // …and the description tells the user where the file goes when they omit it. `fe-out`
        // is the one directory every default lives under (`packages/cli-kit/src/out.ts`'s
        // `FE_OUT_DIR`), so naming it is the minimum that description has to do.
        expect(pick(out?.description ?? { ru: "", en: "" }, lang)).toContain("fe-out");
      }
    });
  }

  for (const lang of LANGS) {
    it(`contains every flag and alias currently registered (${lang})`, () => {
      const text = helpText(COMMANDS, lang, "1.2.3");
      for (const command of COMMANDS) {
        expect(text).toContain(command.flag);
        if (command.alias !== undefined) expect(text).toContain(command.alias);
        expect(text).toContain(pick(command.summary, lang));
      }
    });
  }

  /**
   * THE LITERAL SURFACE. Every case above is fed by the registry, and a help test fed by the
   * registry cannot notice the registry LOSING an entry — it would simply assert less. These
   * two spellings are therefore written out, so `--project-report` disappearing from the
   * product fails here rather than passing quietly (`cli/tests/bundle.integration.test.ts:72-76`
   * states the same reasoning for the pixso four).
   */
  for (const lang of LANGS) {
    it(`lists --project-report and its alias --preport, on one line, in ${lang}`, () => {
      const text = helpText(COMMANDS, lang, "1.2.3");
      const line = text.split("\n").find((l) => l.includes("--project-report"));
      expect(line).toBeDefined();
      expect(line).toContain("--preport");
      // CHANGED IN E2b. `-o` used to be REQUIRED here and therefore printed bare, which made
      // `[--ui-kit <name>]` the only bracketed thing on the line. The owner's law made `-o`
      // optional on every command, so the PROJECT is now the only bare argument and both flags
      // are bracketed — which is precisely how the help page tells a user that omitting `-o` is
      // allowed (`cli/src/help.ts:57` renders `required: false` as brackets).
      expect(line).toContain("<repo-link|local-path>");
      expect(line).toContain("[-o <file.html>]");
      expect(line).toContain("[--ui-kit <name>]");
      // The positional is the one thing NOT in brackets.
      expect(line?.replace("[-o <file.html>]", "").replace("[--ui-kit <name>]", "")).not.toContain(
        "[",
      );
    });

    it(`documents --ui-kit and every design system it accepts, in ${lang}`, () => {
      // X3 deliverable 4: the help documents the flag. It is documented UNDER the command
      // rather than among the globals, because it means nothing to a pixso command and the
      // list of accepted values belongs to the feature package's registry
      // (`cli/src/parse.ts:44-50`).
      const text = helpText(COMMANDS, lang, "1.2.3");
      const uiKit = COMMANDS.find((c) => c.flag === "--project-report")?.args.find(
        (a) => a.name === "--ui-kit <name>",
      );
      expect(uiKit?.required).toBe(false);
      const description = pick(uiKit?.description ?? { ru: "", en: "" }, lang);
      expect(text).toContain(description);
      expect(description).toContain("eds");
      expect(description).toContain("none");
      expect(/[А-Яа-яЁё]/u.test(description)).toBe(lang === "ru");
    });

    it(`prints the --project-report summary and argument help in ${lang}`, () => {
      const text = helpText(COMMANDS, lang, "1.2.3");
      const command = COMMANDS.find((c) => c.flag === "--project-report");
      expect(command).toBeDefined();
      expect(text).toContain(pick(command?.summary ?? { ru: "", en: "" }, lang));
      for (const arg of command?.args ?? []) expect(text).toContain(pick(arg.description, lang));
    });
  }

  it("the --project-report help is genuinely two documents, not one page twice", () => {
    const command = COMMANDS.find((c) => c.flag === "--project-report");
    expect(command?.summary.ru).not.toBe(command?.summary.en);
    expect(command?.summary.en).not.toMatch(/[А-Яа-яЁё]/u);
    expect(command?.summary.ru).toMatch(/[А-Яа-яЁё]/u);
  });

  it("renders an EMPTY registry as an explicit statement, not as blankness", () => {
    // The registry is legitimately empty until brief 3.2 fills `pixsoCommands`
    // (`packages/fe-pixso/src/index.ts:15`), and a help page that just went quiet there would
    // read as a rendering bug.
    const ru = helpText([], "ru", "0.0.0");
    const en = helpText([], "en", "0.0.0");
    expect(ru).toContain("ни одной не зарегистрировано");
    expect(en).toContain("none registered");
  });
});
