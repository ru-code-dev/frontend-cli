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
      // Its two arguments, both required, are printed bare rather than in brackets.
      expect(line).toContain("<repo-link|local-path>");
      expect(line).toContain("-o <file.html>");
      expect(line).not.toContain("[");
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
