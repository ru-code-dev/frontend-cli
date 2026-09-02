/**
 * TIER 1 — the terminal UI, driven by a fake stream, a hand-cranked spinner and a fake clock.
 *
 * Nothing here touches `process`, a terminal or real time: `createUi` takes the stream, the
 * environment, the interval timer and `now` as arguments (`packages/cli-kit/src/ui.ts`), so
 * every case below is the REAL renderer over a recorder. The escapes asserted are the bytes a
 * terminal would receive.
 *
 * THE TWO LANES ARE ASSERTED AGAINST DIFFERENT THINGS ON PURPOSE. The TTY lane is checked for
 * the SEQUENCES (`\r\x1b[K`, the spinner frame, the bar) because that is what makes one line
 * redraw in place. The plain lane is checked for the ABSENCE of any escape at all — a single
 * `\x1b` in a piped run is the bug that gate exists to catch — and for the phase rows, which
 * only that lane prints.
 *
 * The design being implemented is `WORKFLOW/features/cli-ux/plans/ux-design.md` §2; the laws
 * with their own cases here are U3 (one voice, one stream), U6 (paths are never wrapped — the
 * 300-character case), U7 (colour only on a TTY without `NO_COLOR`) and U10 (elapsed).
 */
import { describe, expect, it } from "vite-plus/test";

import {
  capabilityOf,
  createUi,
  formatElapsed,
  phaseRow,
  silentUi,
  visibleWidth,
  type Localized,
  type UiStream,
} from "../src/index.ts";

const ESC = "\u001b";
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, "gu");
/** The same line as a terminal would show it, escapes removed. */
const strip = (text: string): string => text.replace(SGR, "");
/**
 * Any escape sequence at all. The plain lane must not produce one.
 *
 * A substring test rather than a regex: `no-control-regex` is right that a control character
 * inside a pattern is usually a mistake, and there is nothing here a pattern would buy.
 */
const hasEscape = (text: string): boolean => text.includes(ESC);
/**
 * COLOUR ONLY — an SGR sequence, which is what U7 gates.
 *
 * Distinct from {@link hasEscape} since V5 finding #1: `\r` and `${ESC}[K` are CURSOR CONTROLS,
 * and a terminal asked for `NO_COLOR` is still a terminal that redraws one line. A test that
 * measured "any escape" could not tell the two apart, which is how the lane came to be selected
 * by the colour gate.
 */
const hasColour = (text: string): boolean => new RegExp(`${ESC}\\[[0-9;]*m`, "u").test(text);

const SCAN: Localized = { ru: "чтение файлов", en: "reading files" };
const CHECK: Localized = { ru: "проверки", en: "running checks" };
const WRITE: Localized = { ru: "запись", en: "writing" };
const FILES: Localized = { ru: "файлов", en: "files" };
const OK: Localized = { ru: "отчёт готов", en: "report ready" };
const BAD: Localized = { ru: "не указан проект", en: "no project given" };

/** A recorder for the stream, with the spinner and the clock in the test's hands. */
interface Harness {
  readonly stream: UiStream;
  /** Everything written, joined. */
  text(): string;
  /** Advance the spinner by one frame. */
  tick(): void;
  /** Move the fake clock forward. */
  advance(ms: number): void;
}

interface Made {
  readonly ui: ReturnType<typeof createUi>;
  readonly f: Harness;
}

function ui(
  isTTY: boolean,
  options: {
    env?: Record<string, string | undefined>;
    version?: string;
    /** `ru` unless a case is specifically about the OTHER language's wider strings. */
    lang?: "ru" | "en";
  } = {},
): Made {
  const chunks: string[] = [];
  let ticker: (() => void) | null = null;
  let clock = 0;
  const stream: UiStream = { write: (chunk) => void chunks.push(chunk), isTTY };
  const made = createUi({
    stream,
    lang: options.lang ?? "ru",
    env: options.env ?? {},
    version: options.version ?? "1.0.0",
    interval: (tick) => {
      ticker = tick;
      return () => {
        ticker = null;
      };
    },
    now: () => clock,
  });
  return {
    ui: made,
    f: {
      stream,
      text: () => chunks.join(""),
      tick: () => void ticker?.(),
      advance: (ms) => {
        clock += ms;
      },
    },
  };
}

describe("elapsed — the three shapes the design fixes (U10)", () => {
  it("sub-minute is one decimal", () => {
    expect(formatElapsed(800)).toBe("0.8s");
    expect(formatElapsed(4700)).toBe("4.7s");
    expect(formatElapsed(41_200)).toBe("41.2s");
  });

  it("a minute and over is `Nm SSs`, zero-padded", () => {
    expect(formatElapsed(125_000)).toBe("2m 05s");
    expect(formatElapsed(3_600_000)).toBe("60m 00s");
  });

  it("never negative", () => {
    expect(formatElapsed(-5)).toBe("0.0s");
  });
});

describe("the header (§2.1)", () => {
  it("is `fg v<version>` then the command's own parts, joined with ` · `, once", () => {
    const { ui: u, f } = ui(false);
    u.header([
      { ru: "psvg", en: "psvg" },
      { ru: "локальный маршрут", en: "local route" },
    ]);
    expect(f.text()).toBe("fg v1.0.0 · psvg · локальный маршрут\n");
  });

  it("is the same text on a terminal, with the version dimmed and nothing else coloured", () => {
    const { ui: u, f } = ui(true);
    u.header([{ ru: "preport", en: "preport" }]);
    const text = f.text();
    expect(text).toContain(`${ESC}[2mfg v1.0.0${ESC}[0m`);
    expect(strip(text)).toBe("fg v1.0.0 · preport\n");
  });

  it("carries no version when none was given — a UI built without one still speaks", () => {
    const chunks: string[] = [];
    const u = createUi({ stream: { write: (c) => void chunks.push(c) }, lang: "ru" });
    u.header([{ ru: "psvg", en: "psvg" }]);
    expect(chunks.join("")).toBe("fg · psvg\n");
  });
});

describe("progress — the TTY lane (§2.2)", () => {
  it("a phase with no total is the spinner and the label ALONE — no bar, no percent", () => {
    const { ui: u, f } = ui(true);
    u.phase(WRITE);
    const text = f.text();
    expect(text.startsWith(`\r${ESC}[K`)).toBe(true);
    expect(text).toContain("⠋");
    expect(text).toContain("запись");
    expect(text).not.toContain("▕");
    expect(text).not.toContain("%");
  });

  it("the spinner turns in place: one line, redrawn, never a newline", () => {
    const { ui: u, f } = ui(true);
    u.phase(WRITE);
    f.tick();
    f.tick();
    const text = f.text();
    expect(text).toContain("⠙");
    expect(text).toContain("⠹");
    // Every frame is preceded by the erase, and no frame ever ends a line.
    expect(text.split(`\r${ESC}[K`).length - 1).toBe(3);
    expect(text).not.toContain("\n");
  });

  it("a counted phase draws the 16-cell bar, the percent and `done/total unit`", () => {
    const { ui: u, f } = ui(true);
    u.phase(CHECK);
    u.progress(20, 32, { ru: "правил", en: "rules" });
    const plain = strip(f.text());
    const last = plain.split("\r").at(-1) ?? "";
    expect(last).toContain("▕");
    expect(last).toContain("▏");
    // 20/32 is 62.5%, ROUNDED to 63 — the design's own sample — and 63% of sixteen cells is ten.
    expect(last).toContain("█".repeat(10) + "░".repeat(6));
    expect(last).toContain(" 63%");
    expect(last).toContain("20/32 правил");
  });

  it("the label column is fixed, so the bar of a short phase lines up with a long one's", () => {
    const { ui: u, f } = ui(true);
    u.phase(SCAN);
    u.progress(312, 598);
    const scan = (strip(f.text()).split("\r").at(-1) ?? "").indexOf("▕");
    const second = ui(true);
    second.ui.phase(CHECK);
    second.ui.progress(20, 32);
    const check = (strip(second.f.text()).split("\r").at(-1) ?? "").indexOf("▕");
    expect(scan).toBe(check);
    expect(scan).toBeGreaterThan(0);
  });

  it("`total <= 0` is ignored rather than divided by", () => {
    const { ui: u, f } = ui(true);
    u.phase(SCAN);
    u.progress(3, 0);
    expect(f.text()).not.toContain("%");
    expect(f.text()).not.toContain("NaN");
  });

  it("prints NO phase rows — the live line is the whole of it", () => {
    const { ui: u, f } = ui(true);
    u.phase(SCAN);
    u.phase(CHECK);
    expect(f.text()).not.toContain("\n");
  });
});

describe("progress — the plain lane (§2.2)", () => {
  it("prints one row per phase, when the phase ENDS, with its own elapsed (U10)", () => {
    const { ui: u, f } = ui(false);
    u.phase(SCAN);
    f.advance(1900);
    u.phase(CHECK);
    // The first phase's row is out; the second's is not, because it has not ended.
    expect(f.text()).toBe("  чтение файлов          1.9s\n");
    f.advance(2400);
    u.summary({ ok: true, headline: OK, rows: [] });
    expect(f.text()).toContain("  проверки               2.4s\n");
  });

  it("the row's detail is `total unit` when the phase counted, and the explicit one when given", () => {
    const { ui: u, f } = ui(false);
    u.phase(SCAN);
    u.progress(598, 598, FILES);
    f.advance(1900);
    u.phase(WRITE, { ru: "html, sarif", en: "html, sarif" });
    f.advance(300);
    u.summary({ ok: true, headline: OK, rows: [] });
    expect(f.text()).toContain("  чтение файлов          598 файлов   1.9s\n");
    expect(f.text()).toContain("  запись                 html, sarif  0.3s\n");
  });

  it("emits not one escape byte", () => {
    const { ui: u, f } = ui(false);
    u.header([{ ru: "preport", en: "preport" }]);
    u.phase(SCAN);
    u.progress(1, 2, FILES);
    u.note({ ru: "конфиг: по умолчанию", en: "config: default" });
    u.warn({ ru: "дизайн-система не определена", en: "no design system detected" });
    u.summary({ ok: true, headline: OK, rows: [{ key: FILES, value: "/abs/report.html" }] });
    expect(hasEscape(f.text())).toBe(false);
  });
});

describe("notes and warnings (§2.5)", () => {
  it("`  · …` for a note and `  ! …` for a warning, each on its own row", () => {
    const { ui: u, f } = ui(false);
    u.note({ ru: "конфиг: /abs/fg.config.json", en: "config: /abs/fg.config.json" });
    u.warn({ ru: "дизайн-система не определена", en: "no design system detected" });
    expect(f.text()).toBe("  · конфиг: /abs/fg.config.json\n  ! дизайн-система не определена\n");
  });

  it("on a terminal the live line is ERASED first and REDRAWN under the row", () => {
    const { ui: u, f } = ui(true);
    u.phase(SCAN);
    const before = f.text();
    u.note({ ru: "заметка", en: "note" });
    const after = f.text().slice(before.length);
    // erase, the row, then the bar again — in that order.
    expect(after.startsWith(`\r${ESC}[K`)).toBe(true);
    expect(strip(after)).toContain("· заметка");
    expect(strip(after).split("\n").at(-1)).toContain("чтение файлов");
  });

  it("the warning is yellow on a terminal and bare text without one", () => {
    const tty = ui(true);
    tty.ui.warn({ ru: "внимание", en: "careful" });
    expect(tty.f.text()).toContain(`${ESC}[0;33m!${ESC}[0m`);
    const plain = ui(false);
    plain.ui.warn({ ru: "внимание", en: "careful" });
    expect(plain.f.text()).toBe("  ! внимание\n");
  });
});

describe("the summary block (§2.3)", () => {
  it("green ✔, the headline, the elapsed, then dim padded keys and their values", () => {
    const { ui: u, f } = ui(false);
    f.advance(4700);
    u.summary({
      ok: true,
      headline: OK,
      rows: [
        { key: { ru: "файлов", en: "files" }, value: { ru: "598 просмотрено", en: "598 scanned" } },
        { key: { ru: "html", en: "html" }, value: "/abs/path/fg-out/report.html", kind: "path" },
      ],
    });
    expect(f.text()).toBe(
      [
        "✔ отчёт готов                                      4.7s",
        "  файлов      598 просмотрено",
        "  html        /abs/path/fg-out/report.html",
        "",
      ].join("\n"),
    );
  });

  it("red ✖ with the headline when the run is not ok", () => {
    const { ui: u, f } = ui(true);
    u.summary({ ok: false, headline: { ru: "есть ошибки", en: "errors found" }, rows: [] });
    expect(f.text()).toContain(`${ESC}[0;31m✖${ESC}[0m есть ошибки`);
  });

  it("`elapsed: false` prints the headline alone — no time, no padding", () => {
    const { ui: u, f } = ui(false);
    f.advance(4700);
    u.summary({ ok: true, headline: OK, rows: [], elapsed: false });
    expect(f.text()).toBe("✔ отчёт готов\n");
  });

  it("keys widen to the longest key + 2 when that is wider than the floor", () => {
    const { ui: u, f } = ui(false);
    u.summary({
      ok: true,
      headline: OK,
      rows: [
        { key: { ru: "очень-длинный-ключ", en: "a-very-long-key-x" }, value: "1" },
        { key: { ru: "х", en: "x" }, value: "2" },
      ],
      elapsed: false,
    });
    const lines = f.text().split("\n");
    expect(lines[1]).toBe("  очень-длинный-ключ  1");
    // Both values start in the same column — that is what "padded" means.
    expect(lines[2]?.indexOf("2")).toBe(lines[1]?.indexOf("1"));
  });

  /** U6, THE CASE THIS REWRITE EXISTS FOR. The old card hard-broke a path at 59 columns. */
  it("a 300-character path is ONE row, verbatim, unwrapped and untruncated", () => {
    const long = `/${"segment/".repeat(40)}report.html`;
    expect(long.length).toBeGreaterThan(300);
    const { ui: u, f } = ui(false);
    u.summary({
      ok: true,
      headline: OK,
      rows: [{ key: { ru: "html", en: "html" }, value: long, kind: "path" }],
      elapsed: false,
    });
    const rows = f
      .text()
      .split("\n")
      .filter((l) => l !== "");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe(`  html        ${long}`);
  });

  it("a path row carries no colour even on a terminal", () => {
    const { ui: u, f } = ui(true);
    u.summary({
      ok: true,
      headline: OK,
      rows: [{ key: { ru: "html", en: "html" }, value: "/abs/report.html", kind: "path" }],
      elapsed: false,
    });
    const line = f.text().split("\n")[1] ?? "";
    // The key is dim; everything after it is bare.
    const afterKey = line.slice(line.indexOf(`${ESC}[0m`) + 4);
    expect(hasEscape(afterKey)).toBe(false);
  });

  it("ends the run: `ended()` flips and a second block is refused", () => {
    const { ui: u, f } = ui(false);
    expect(u.ended()).toBe(false);
    u.summary({ ok: true, headline: OK, rows: [], elapsed: false });
    expect(u.ended()).toBe(true);
    u.summary({ ok: true, headline: OK, rows: [], elapsed: false });
    u.fail(BAD);
    expect(f.text()).toBe("✔ отчёт готов\n");
  });

  it("no rows at all is legal — a run that wrote nothing still ends with its headline", () => {
    const { ui: u, f } = ui(false);
    u.summary({ ok: true, headline: OK, rows: [], elapsed: false });
    expect(f.text()).toBe("✔ отчёт готов\n");
  });

  it("on a terminal the live line is erased before the block, and the spinner stops", () => {
    const { ui: u, f } = ui(true);
    u.phase(SCAN);
    u.summary({ ok: true, headline: OK, rows: [], elapsed: false });
    const tail = f.text().split(`\r${ESC}[K`).at(-1) ?? "";
    expect(tail).toContain("✔");
    expect(tail).not.toContain("чтение файлов");
    // The ticker was cleared, so a stray frame cannot draw over the block.
    f.tick();
    expect(f.text().endsWith("отчёт готов\n")).toBe(true);
  });
});

describe("failure (§2.6)", () => {
  it("a usage error is `✖ message` plus the two pointer rows, padded to one column", () => {
    const { ui: u, f } = ui(false);
    u.fail(BAD, {
      usage: "fg --preport <путь|repo> [--format …]",
      help: "fg --help --preport",
    });
    expect(f.text()).toBe(
      [
        "✖ не указан проект",
        "  использование:  fg --preport <путь|repo> [--format …]",
        "  подробнее:      fg --help --preport",
        "",
      ].join("\n"),
    );
  });

  it("a runtime failure has NO usage row — an empty `usage` prints only `подробнее:`", () => {
    const { ui: u, f } = ui(false);
    u.fail(
      { ru: "клонирование не удалось", en: "clone failed" },
      { usage: "", help: "fg --preport … --debug" },
    );
    expect(f.text()).toBe(
      ["✖ клонирование не удалось", "  подробнее:      fg --preport … --debug", ""].join("\n"),
    );
  });

  it("no hint at all is just the one line", () => {
    const { ui: u, f } = ui(false);
    u.fail(BAD);
    expect(f.text()).toBe("✖ не указан проект\n");
  });

  it("the glyph is red on a terminal and bare without one", () => {
    const tty = ui(true);
    tty.ui.fail(BAD);
    expect(tty.f.text()).toContain(`${ESC}[0;31m✖${ESC}[0m`);
    const plain = ui(false);
    plain.ui.fail(BAD);
    expect(hasEscape(plain.f.text())).toBe(false);
  });

  it("ends the run, and the phase in flight leaves no live line behind", () => {
    const { ui: u, f } = ui(true);
    u.phase(SCAN);
    u.fail(BAD);
    expect(u.ended()).toBe(true);
    const tail = f.text().split(`\r${ESC}[K`).at(-1) ?? "";
    expect(tail).toBe(`${ESC}[0;31m✖${ESC}[0m не указан проект\n`);
  });
});

/**
 * TWO GATES, NOT ONE — design §2.2 (the lane) and U7 (the colour), and V5 finding #1.
 *
 * The lane is chosen by TTY-NESS ALONE: a terminal gets one live line redrawn with `\r` and
 * `${ESC}[K`, a pipe gets one row per phase when it ends. The COLOUR is chosen by
 * `NO_COLOR`/`FORCE_COLOR`/TTY. Welding them (`redraw: color`) meant `NO_COLOR=1` on a real
 * terminal printed the pipe's phase ledger into the middle of the compact document on stdout,
 * and `FORCE_COLOR=1` into a log file wrote a whole spinner animation. This block is the
 * enshrinement of that bug, rewritten as the enshrinement of the rule.
 */
describe("the summary headline's elapsed column", () => {
  it("sits at column 51, and never closer than two spaces to a long headline", () => {
    const short = ui(false);
    short.f.advance(4700);
    short.ui.summary({ ok: true, headline: OK, rows: [] });
    expect(short.f.text().split("\n")[0]).toBe(`${"✔ отчёт готов".padEnd(51)}4.7s`);

    // §2.5's `--iconf` headline carries its counts and reaches the column exactly; padding to a
    // fixed 51 would have run `0.0s` straight into the last word.
    const long = ui(false);
    const headline: Localized = {
      ru: "конфигурация создана    32 правила · 30 подправил",
      en: "configuration written    32 rules · 30 sub-rules",
    };
    long.ui.summary({ ok: true, headline, rows: [] });
    const line = long.f.text().split("\n")[0] ?? "";
    expect(line).toBe(`✔ ${headline.ru}  0.0s`);
    expect(line.endsWith("подправил  0.0s")).toBe(true);
  });
});

describe("the plain lane's phase row — its columns are minima, not promises", () => {
  /**
   * THE 27-CHARACTER LABEL, pinned.
   *
   * `--iconf`'s detect phase is «выбор дизайн-системы» in Russian (20 code points, inside the
   * 23-column label field) and "selecting the design system" in English — 27, past it. Because
   * `pad` never truncates, the English row used to print
   *
   *     «  selecting the design system0.0s»
   *
   * with the elapsed welded onto the last word, while the Russian row looked perfect. That is the
   * shape of the bug: a defect only the second language can see. The rule is now the summary
   * headline's own (`ELAPSED_GAP`) — a column is a floor, and an overrun still gets two spaces.
   */
  const LONG_LABEL = "selecting the design system";

  it("a label past the 23-column field still gets two spaces before the elapsed", () => {
    expect(LONG_LABEL.length).toBe(27);
    expect(phaseRow(LONG_LABEL, "", "0.0s")).toBe(`  ${LONG_LABEL}  0.0s\n`);
  });

  it("…and two spaces before its DETAIL, when the phase has one", () => {
    expect(phaseRow(LONG_LABEL, "32 rules", "1.2s")).toBe(`  ${LONG_LABEL}  32 rules     1.2s\n`);
  });

  it("an over-long DETAIL keeps its own two spaces before the elapsed", () => {
    const detail = "html, sarif, json, compact";
    expect(visibleWidth(detail)).toBeGreaterThan(13);
    expect(phaseRow("запись", detail, "0.3s")).toBe(`  ${"запись".padEnd(23)}${detail}  0.3s\n`);
  });

  it("short labels and details are UNCHANGED — the fixed columns still line up", () => {
    expect(phaseRow("чтение файлов", "", "1.9s")).toBe("  чтение файлов          1.9s\n");
    expect(phaseRow("чтение файлов", "598 файлов", "1.9s")).toBe(
      "  чтение файлов          598 файлов   1.9s\n",
    );
  });

  it("the whole English --iconf run reads correctly through the real UI", () => {
    const { ui: u, f } = ui(false, { lang: "en" });
    u.header([{ ru: "iconf", en: "iconf" }]);
    u.phase({ ru: "выбор дизайн-системы", en: LONG_LABEL });
    f.advance(100);
    u.phase({ ru: "запись", en: "writing" });
    u.summary({ ok: true, headline: { ru: "готово", en: "done" }, rows: [] });
    // Not one line in the block may end a word straight against its elapsed.
    for (const line of f.text().split("\n")) {
      expect(line).not.toMatch(/[^\s]\d+\.\d+s$/u);
    }
    expect(f.text()).toContain(`  ${LONG_LABEL}  0.1s\n`);
  });
});

describe("the colour gate (U7) and the lane gate (§2.2) are separate", () => {
  it("`NO_COLOR` on a TERMINAL keeps the live line and drops only the colour", () => {
    const { ui: u, f } = ui(true, { env: { NO_COLOR: "1" } });
    u.header([{ ru: "preport", en: "preport" }]);
    u.phase(SCAN);
    u.progress(1, 2, FILES);
    f.advance(100);
    u.summary({
      ok: true,
      headline: OK,
      rows: [{ key: { ru: "html", en: "html" }, value: "/abs/report.html", kind: "path" }],
    });
    const text = f.text();
    // ZERO colour…
    expect(hasColour(text)).toBe(false);
    // …and STILL the live line: the erase sequence is there, and the bar was drawn.
    expect(text).toContain(`\r${ESC}[K`);
    expect(text).toContain("▕");
    expect(text).toContain("⠋ чтение файлов");
    // …so the pipe's ledger row is NOT what it printed.
    expect(text).not.toContain("  чтение файлов          2 файлов     0.1s\n");
    // The summary still lands, in plain text, with the path verbatim (U6).
    expect(strip(text)).toContain("/abs/report.html");
  });

  it("`FORCE_COLOR` colours a PIPE without turning it into a terminal", () => {
    const { ui: u, f } = ui(false, { env: { FORCE_COLOR: "1" } });
    u.phase(SCAN);
    f.advance(200);
    u.summary({ ok: true, headline: OK, rows: [] });
    const text = f.text();
    // Colour, yes — that is what the flag asks for.
    expect(hasColour(text)).toBe(true);
    // A spinner animation in a log file, no: no erase sequence, and the phase's ledger row.
    expect(text).not.toContain(`\r${ESC}[K`);
    expect(strip(text)).toContain("  чтение файлов");
  });

  it("`FORCE_COLOR=0` drops the colour on a terminal and keeps the live line", () => {
    const { ui: u, f } = ui(true, { env: { FORCE_COLOR: "0" } });
    u.phase(SCAN);
    const text = f.text();
    expect(hasColour(text)).toBe(false);
    expect(text).toContain(`\r${ESC}[K`);
  });

  it("capabilityOf answers both gates directly", () => {
    const tty = { write: () => {}, isTTY: true };
    const pipe = { write: () => {} };
    expect(capabilityOf(tty, {}).color).toBe(true);
    expect(capabilityOf(pipe, {}).color).toBe(false);
    expect(capabilityOf(tty, { NO_COLOR: "1" }).color).toBe(false);
    // The lane: the terminal decides it, and nothing in the environment does.
    expect(capabilityOf(tty, {}).redraw).toBe(true);
    expect(capabilityOf(tty, { NO_COLOR: "1" }).redraw).toBe(true);
    expect(capabilityOf(tty, { FORCE_COLOR: "0" }).redraw).toBe(true);
    expect(capabilityOf(pipe, {}).redraw).toBe(false);
    expect(capabilityOf(pipe, { FORCE_COLOR: "1" }).redraw).toBe(false);
  });
});

describe("visibleWidth", () => {
  it("measures what the eye sees, escapes removed, in code points", () => {
    expect(visibleWidth(`${ESC}[2mключ${ESC}[0m`)).toBe(4);
    expect(visibleWidth("файлов")).toBe(6);
  });
});

describe("silentUi", () => {
  it("implements the whole contract and draws nothing", () => {
    silentUi.header([OK]);
    silentUi.phase(SCAN);
    silentUi.progress(1, 2);
    silentUi.note(OK);
    silentUi.warn(OK);
    silentUi.summary({ ok: true, headline: OK, rows: [] });
    silentUi.fail(BAD);
    // Never "ended": it drew no block, so a caller's own line is still the only output there is.
    expect(silentUi.ended()).toBe(false);
    expect(silentUi.stdoutIsTTY).toBe(false);
  });
});
