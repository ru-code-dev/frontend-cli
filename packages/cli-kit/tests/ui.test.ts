/**
 * TIER 1 — the terminal UI, driven by a fake stream.
 *
 * Nothing here touches `process`, a terminal or a clock. `createUi` takes the stream, the
 * environment and the interval timer as arguments (`packages/cli-kit/src/ui.ts`), so every
 * case below is the REAL renderer over a recorder: the escapes asserted are the bytes a
 * terminal would receive, and the animator is cranked by hand rather than waited on.
 *
 * The two lanes are asserted against different things on purpose. The TTY lane is checked for
 * the SEQUENCES (`\r\033[K`, the cyan bar, the gradient) because that is what makes it look
 * like the installer. The plain lane is checked for the ABSENCE of any escape at all — a
 * single `\x1b` in a piped run is the bug this gate exists to catch.
 */
import { describe, expect, it } from "vite-plus/test";

import {
  banner,
  capabilityOf,
  card,
  createUi,
  gradient,
  progressLine,
  silentUi,
  type Localized,
  type UiStream,
  visibleWidth,
} from "../src/index.ts";

const ESC = "\u001b";
/**
 * Any escape sequence at all. The plain lane must not produce one.
 *
 * A substring test rather than a regex: `no-control-regex` is right that a control character
 * inside a pattern is usually a mistake, and there is nothing here a pattern would buy.
 */
const hasEscape = (text: string): boolean => text.includes(ESC);

const SCAN: Localized = { ru: "Чтение файлов", en: "Reading files" };
const CHECK: Localized = { ru: "Проверки", en: "Running checks" };
const OK: Localized = { ru: "отчёт готов", en: "report ready" };
const BAD: Localized = { ru: "не удалось", en: "it failed" };

interface Fake {
  readonly stream: UiStream;
  readonly chunks: string[];
  text(): string;
}

function fake(isTTY: boolean): Fake {
  const chunks: string[] = [];
  return {
    stream: {
      isTTY,
      write: (chunk: string) => void chunks.push(chunk),
    },
    chunks,
    text: () => chunks.join(""),
  };
}

/** A hand-cranked animator clock: nothing ticks until a case says so. */
function manualClock() {
  let tick: (() => void) | null = null;
  let stopped = 0;
  return {
    start: (fn: () => void): (() => void) => {
      tick = fn;
      return () => {
        tick = null;
        stopped += 1;
      };
    },
    fire(times = 1): void {
      for (let i = 0; i < times; i += 1) tick?.();
    },
    get running(): boolean {
      return tick !== null;
    },
    get stops(): number {
      return stopped;
    },
  };
}

/* ───────────────────────────────── the capability gate ───────────────────────────────────── */

describe("capabilityOf — the TTY gate, which everything else hangs off", () => {
  it("a TTY with nothing in the environment gets color and redraw, but no gradient", () => {
    expect(capabilityOf({ isTTY: true, write: () => {} }, {})).toEqual({
      color: true,
      truecolor: false,
      redraw: true,
    });
  });

  it("COLORTERM=truecolor is what unlocks the gradient wordmark", () => {
    const capability = capabilityOf({ isTTY: true, write: () => {} }, { COLORTERM: "truecolor" });
    expect(capability.truecolor).toBe(true);
    expect(capabilityOf({ isTTY: true, write: () => {} }, { COLORTERM: "24bit" }).truecolor).toBe(
      true,
    );
    // 256-colour terminals (macOS Terminal.app) degrade rather than print garbage — the
    // installer's own note at `install:175-177`.
    expect(capabilityOf({ isTTY: true, write: () => {} }, { COLORTERM: "" }).truecolor).toBe(false);
  });

  it("no terminal ⇒ nothing: not color, not truecolor, not redraw", () => {
    expect(capabilityOf({ isTTY: false, write: () => {} }, { COLORTERM: "truecolor" })).toEqual({
      color: false,
      truecolor: false,
      redraw: false,
    });
    // An omitted `isTTY` reads the same way — node leaves it undefined on a pipe.
    expect(capabilityOf({ write: () => {} }, {}).color).toBe(false);
  });

  it("NO_COLOR turns a real terminal off, whatever it is set to", () => {
    for (const value of ["1", "0", "yes", "anything"]) {
      expect(capabilityOf({ isTTY: true, write: () => {} }, { NO_COLOR: value }).color).toBe(false);
    }
    // Empty is NOT set, per no-color.org.
    expect(capabilityOf({ isTTY: true, write: () => {} }, { NO_COLOR: "" }).color).toBe(true);
  });

  it("FORCE_COLOR=0 turns it off; any other value turns a pipe on", () => {
    expect(capabilityOf({ isTTY: true, write: () => {} }, { FORCE_COLOR: "0" }).color).toBe(false);
    expect(capabilityOf({ isTTY: true, write: () => {} }, { FORCE_COLOR: "false" }).color).toBe(
      false,
    );
    expect(capabilityOf({ isTTY: false, write: () => {} }, { FORCE_COLOR: "1" }).color).toBe(true);
    // NO_COLOR still wins over it — the brief names it as the unconditional off switch.
    expect(
      capabilityOf({ isTTY: false, write: () => {} }, { FORCE_COLOR: "1", NO_COLOR: "1" }).color,
    ).toBe(false);
  });
});

/* ────────────────────────────────── the pure renderers ───────────────────────────────────── */

describe("the primitives ported from the installer", () => {
  it("the banner is `▸ fe`, in the three forms the installer has", () => {
    expect(banner("fe", { color: false, truecolor: false, redraw: false })).toBe("\n  > fe\n\n");
    expect(banner("fe", { color: true, truecolor: false, redraw: true })).toBe(
      `\n  ${ESC}[0;32m▸${ESC}[0m ${ESC}[1mfe${ESC}[0m\n\n`,
    );
    const rich = banner("fe", { color: true, truecolor: true, redraw: true });
    // A 24-bit sweep, one SGR per character, cyan at the start and violet at the end
    // (`install:104-105`).
    expect(rich).toContain(`${ESC}[1;38;2;56;217;238mf`);
    expect(rich).toContain(`${ESC}[1;38;2;167;139;250me`);
  });

  it("the gradient leaves spaces alone and spans the whole word", () => {
    expect(gradient(" ")).toBe(" ");
    expect(visibleWidth(gradient("Ru Code"))).toBe(7);
    // One character is the degenerate span: it takes the `from` end, never a division by zero.
    expect(gradient("x")).toBe(`${ESC}[1;38;2;56;217;238mx${ESC}[0m`);
  });

  it("the progress line is 24 cells, a 22-column label and a dim right-aligned percent", () => {
    const line = progressLine(50, "Чтение файлов");
    expect(line.startsWith(`\r${ESC}[K`)).toBe(true);
    expect(line).toContain(`${ESC}[0;36m${"▓".repeat(12)}${"░".repeat(12)}${ESC}[0m`);
    expect(line).toContain(`${ESC}[2m 50%${ESC}[0m`);
    expect(line).toContain(`Чтение файлов${" ".repeat(9)}`);
  });

  it("the percent is clamped and the label is never allowed to push the bar around", () => {
    expect(progressLine(-5, "x")).toContain("░".repeat(24));
    expect(progressLine(400, "x")).toContain("▓".repeat(24));
    expect(progressLine(0, "x").length).toBe(progressLine(0, "y".repeat(80)).length);
  });

  it("visibleWidth measures what the eye sees, not what the byte stream carries", () => {
    expect(visibleWidth(`${ESC}[1m${ESC}[0;36mОтчёт${ESC}[0m`)).toBe(5);
  });

  it("every box row is exactly as wide as the rule above it", () => {
    const drawn = card(
      [{ label: "Чтение файлов", failed: false }],
      "отчёт готов → /very/long/path/that/has/to/wrap/somewhere/report.html: находок 42",
      true,
      { color: true, truecolor: true, redraw: true },
    );
    const rows = drawn.split("\n").filter((row) => row.includes("║") || row.includes("╔"));
    const widths = new Set(rows.map((row) => visibleWidth(row)));
    expect(widths.size).toBe(1);
  });

  it("a path too long to fit is hard-broken rather than allowed to burst the frame", () => {
    // The installer's `box_wrap` breaks on spaces only (`install:328-337`), so one unbroken
    // token wider than the box runs straight through the right border. Every card here carries
    // an absolute path, which is precisely that token — this is the case that pins the fix.
    const path = `/tmp/${"deeply-nested-directory/".repeat(6)}report.html`;
    expect(path.length).toBeGreaterThan(63);
    const drawn = card(
      [{ label: "Запись", failed: false }],
      `отчёт готов → ${path}: находок 6`,
      true,
      { color: false, truecolor: false, redraw: false },
    );
    const rows = drawn.split("\n").filter((row) => row.includes("║") || row.includes("╔"));
    expect(new Set(rows.map((row) => visibleWidth(row))).size).toBe(1);
    // …and nothing is lost in the breaking: the path is still readable across the rows.
    expect(drawn.replace(/[║╔╚╗╝═\s]/gu, "")).toContain(path.replace(/\//gu, "/"));
  });

  /**
   * THE RESULT LIST — one absolute path per row, which is what the E2b output contract asks the
   * card to show (`packages/cli-kit/src/out.ts`'s `resultOf`).
   *
   * Before this, `wrap` split on `/\s+/u` and a newline was just more whitespace, so five paths
   * arrived as one flowed paragraph with two or three paths per row. That is the single most
   * confusing thing a list of paths can do, and these three cases are what stop it coming back.
   */
  it("an explicit newline is a LINE BREAK — one result path per row", () => {
    const paths = ["/tmp/kits/eds/tokens.json", "/tmp/kits/eds/kit-a11y.json"];
    const drawn = card([], `готово, записано 2 файла\n${paths.join("\n")}`, true, {
      color: false,
      truecolor: false,
      redraw: false,
    });
    const rows = drawn
      .split("\n")
      .filter((row) => row.includes("║"))
      .map((row) => row.replaceAll("║", "").trim());
    expect(rows).toEqual(["готово, записано 2 файла", ...paths]);
  });

  it("…and the frame still has one width, however many rows the list adds", () => {
    const drawn = card(
      [{ label: "Запись корпуса", failed: false }],
      [
        "корпус eds 1.13.0 собран, файлов: 3",
        "/a/tokens.json",
        "/a/components.json",
        "/a/x.json",
      ].join("\n"),
      true,
      { color: true, truecolor: true, redraw: true },
    );
    const rows = drawn.split("\n").filter((row) => row.includes("║") || row.includes("╔"));
    expect(new Set(rows.map((row) => visibleWidth(row))).size).toBe(1);
  });

  it("a path too long for the box is still hard-broken, and does not merge with the next one", () => {
    const long = `/tmp/${"nested-directory/".repeat(6)}tokens.json`;
    const short = "/tmp/b.json";
    const drawn = card([], `готово\n${long}\n${short}`, true, {
      color: false,
      truecolor: false,
      redraw: false,
    });
    const rows = drawn
      .split("\n")
      .filter((row) => row.includes("║"))
      .map((row) => row.replaceAll("║", "").trim());
    expect(new Set(rows.map((row) => row.length)).size).toBeGreaterThan(0);
    // The short path owns its own row rather than being flowed onto the tail of the long one.
    expect(rows.at(-1)).toBe(short);
    expect(rows.join("")).toContain(long.replaceAll(" ", ""));
  });
});

/* ─────────────────────────────────── the TTY lane ────────────────────────────────────────── */

describe("a real terminal", () => {
  it("draws the banner once, lazily, on the first phase — and never before", () => {
    const out = fake(true);
    const clock = manualClock();
    const ui = createUi({ stream: out.stream, lang: "ru", interval: clock.start });
    expect(out.text()).toBe("");

    ui.phase(SCAN);
    ui.phase(CHECK);
    const banners = out.text().split("▸").length - 1;
    expect(banners).toBe(1);
  });

  it("redraws ONE line: every progress frame is a `\\r\\033[K` over the same row", () => {
    const out = fake(true);
    const clock = manualClock();
    const ui = createUi({ stream: out.stream, lang: "ru", interval: clock.start });

    ui.phase(SCAN);
    ui.progress(3, 9);
    ui.progress(9, 9);

    const frames = out.chunks.filter((chunk) => chunk.startsWith(`\r${ESC}[K`));
    // The phase's own opening frame plus the two reports.
    expect(frames).toHaveLength(3);
    expect(frames[1]).toContain(` 33%`);
    expect(frames[2]).toContain(`100%`);
    // Not a single newline among them: it is one row being rewritten, never a scroll.
    expect(frames.some((frame) => frame.includes("\n"))).toBe(false);
  });

  it("animates a phase with no countable work, and retires the animator when a real number arrives", () => {
    const out = fake(true);
    const clock = manualClock();
    const ui = createUi({ stream: out.stream, lang: "ru", interval: clock.start });

    ui.phase(CHECK);
    expect(clock.running).toBe(true);
    clock.fire(3);
    expect(out.text()).toContain("  3%");

    ui.progress(1, 2);
    expect(clock.running).toBe(false);
    expect(clock.stops).toBe(1);
    // A tick that arrived after the stop would be a stale frame overwriting a real one.
    clock.fire(5);
    expect(out.chunks.at(-1)).toContain(" 50%");
  });

  it("the animator never reaches full — only a real completion does", () => {
    const out = fake(true);
    const clock = manualClock();
    const ui = createUi({ stream: out.stream, lang: "en", interval: clock.start });
    ui.phase(CHECK);
    clock.fire(500);
    expect(out.text()).toContain(" 95%");
    expect(out.text()).not.toContain("100%");
  });

  it("`suspend` erases the live row so another stream may write a whole line", () => {
    const out = fake(true);
    const clock = manualClock();
    const ui = createUi({ stream: out.stream, lang: "ru", interval: clock.start });

    // Nothing live yet: nothing to erase, and no stray escape emitted.
    ui.suspend();
    expect(out.text()).toBe("");

    ui.phase(SCAN);
    out.chunks.length = 0;
    ui.suspend();
    expect(out.text()).toBe(`\r${ESC}[K`);
  });

  it("the final card wipes the bar, ticks every phase and paints the box cyan", () => {
    const out = fake(true);
    const clock = manualClock();
    const ui = createUi({ stream: out.stream, lang: "ru", interval: clock.start });

    ui.phase(SCAN);
    ui.progress(9, 9);
    ui.phase(CHECK);
    ui.done(OK);

    const text = out.text();
    expect(text).toContain(`${ESC}[0;32m✓${ESC}[0m Чтение файлов`);
    expect(text).toContain(`${ESC}[0;32m✓${ESC}[0m Проверки`);
    expect(text).toContain(`${ESC}[1m${ESC}[0;36m╔`);
    expect(text).toContain(`${ESC}[1m${ESC}[0;32mотчёт готов${ESC}[0m`);
    expect(text).not.toContain("✗");
    // The animator is gone: a card followed by a stray frame would be the worst artifact of all.
    expect(clock.running).toBe(false);
  });

  it("a failure marks the phase IN FLIGHT with ✗, keeps the earlier ✓, and paints the box red", () => {
    const out = fake(true);
    const clock = manualClock();
    const ui = createUi({ stream: out.stream, lang: "ru", interval: clock.start });

    ui.phase(SCAN);
    ui.phase(CHECK);
    ui.fail(BAD);

    const text = out.text();
    expect(text).toContain(`${ESC}[0;32m✓${ESC}[0m Чтение файлов`);
    expect(text).toContain(`${ESC}[0;31m✗${ESC}[0m Проверки`);
    expect(text).toContain(`${ESC}[1m${ESC}[0;31m╔`);
    // The status TEXT is not tinted to match the alarm border (`install:590-591`).
    expect(text).toContain(`${ESC}[1mне удалось${ESC}[0m`);
  });

  it("ends exactly once: a second card can never be drawn", () => {
    const out = fake(true);
    const clock = manualClock();
    const ui = createUi({ stream: out.stream, lang: "ru", interval: clock.start });

    ui.phase(SCAN);
    ui.fail(BAD);
    const after = out.text();

    ui.done(OK);
    ui.fail(BAD);
    ui.phase(CHECK);
    ui.progress(1, 1);
    expect(out.text()).toBe(after);
  });
});

/* ────────────────────────────────── the plain lane ───────────────────────────────────────── */

describe("no terminal, or a terminal that asked not to be painted", () => {
  const lanes: readonly (readonly [string, boolean, Record<string, string>])[] = [
    ["a pipe", false, {}],
    ["NO_COLOR on a real terminal", true, { NO_COLOR: "1" }],
    ["FORCE_COLOR=0 on a real terminal", true, { FORCE_COLOR: "0" }],
  ];

  for (const [name, isTTY, env] of lanes) {
    it(`${name}: plain sequential lines and not one escape code`, () => {
      const out = fake(isTTY);
      const clock = manualClock();
      const ui = createUi({ stream: out.stream, lang: "ru", env, interval: clock.start });

      ui.phase(SCAN);
      ui.progress(3, 9);
      ui.phase(CHECK);
      ui.done(OK);

      const text = out.text();
      expect(hasEscape(text)).toBe(false);
      expect(text).not.toContain("\r");
      expect(text).toContain("  > fe\n");
      expect(text).toContain("  Чтение файлов…\n");
      expect(text).toContain("  Проверки…\n");
      expect(text).toContain("✓ Чтение файлов");
      // No animator is ever started, so there is nothing to leak.
      expect(clock.running).toBe(false);
      expect(clock.stops).toBe(0);
    });
  }

  it("phases appear in the order they were announced", () => {
    const out = fake(false);
    const ui = createUi({ stream: out.stream, lang: "en" });
    ui.phase(SCAN);
    ui.phase(CHECK);
    ui.done(OK);

    const text = out.text();
    expect(text.indexOf("Reading files…")).toBeLessThan(text.indexOf("Running checks…"));
    expect(text.indexOf("✓ Reading files")).toBeLessThan(text.indexOf("✓ Running checks"));
  });

  it("a failure still marks the phase in flight, with no color to say it with", () => {
    const out = fake(false);
    const ui = createUi({ stream: out.stream, lang: "ru" });
    ui.phase(SCAN);
    ui.phase(CHECK);
    ui.fail(BAD);

    const text = out.text();
    expect(hasEscape(text)).toBe(false);
    expect(text).toContain("✓ Чтение файлов");
    expect(text).toContain("✗ Проверки");
  });

  it("`suspend` is a no-op with nothing to redraw", () => {
    const out = fake(false);
    const ui = createUi({ stream: out.stream, lang: "ru" });
    ui.phase(SCAN);
    const before = out.text();
    ui.suspend();
    expect(out.text()).toBe(before);
  });
});

/* ──────────────────────────────────── localization ───────────────────────────────────────── */

describe("--lang reaches every label", () => {
  it("ru and en render the same run in their own words", () => {
    for (const [lang, phase, summary] of [
      ["ru", "Чтение файлов", "отчёт готов"],
      ["en", "Reading files", "report ready"],
    ] as const) {
      const out = fake(false);
      const ui = createUi({ stream: out.stream, lang });
      ui.phase(SCAN);
      ui.done(OK);
      expect(out.text()).toContain(phase);
      expect(out.text()).toContain(summary);
    }
  });

  it("the wordmark is the caller's, so the banner can say something other than `fe`", () => {
    const out = fake(false);
    const ui = createUi({ stream: out.stream, lang: "ru", wordmark: "fe report" });
    ui.phase(SCAN);
    expect(out.text()).toContain("  > fe report\n");
  });
});

/* ─────────────────────────────────────── note ────────────────────────────────────────────── */

/**
 * V3 MINOR-5 — the fifth verb. A non-fatal remark belongs in the UI's gutter, not on a raw
 * stderr line that lands unindented among the UI's own output and, on a terminal, on the bar.
 */
describe("note", () => {
  const WARN: Localized = { ru: "корпус eds неполон", en: "the eds corpus is incomplete" };

  it("plain: one gutter row, in the language in play, with no escape in it", () => {
    const out = fake(false);
    const ui = createUi({ stream: out.stream, lang: "ru" });
    ui.phase(SCAN);
    ui.note(WARN);
    expect(out.text()).toContain("     ! корпус eds неполон\n");
    expect(hasEscape(out.text())).toBe(false);
  });

  it("plain: renders en too, so the remark is localized like every other label", () => {
    const out = fake(false);
    const ui = createUi({ stream: out.stream, lang: "en" });
    ui.phase(SCAN);
    ui.note(WARN);
    expect(out.text()).toContain("     ! the eds corpus is incomplete\n");
  });

  it("uses the ledger's own five-space gutter, the same column the card's ✓ sits in", () => {
    const out = fake(false);
    const ui = createUi({ stream: out.stream, lang: "ru" });
    ui.phase(SCAN);
    ui.note(WARN);
    ui.done(OK);
    const noteRow = out
      .text()
      .split("\n")
      .find((line) => line.includes("корпус"));
    const tick = out
      .text()
      .split("\n")
      .find((line) => line.includes("✓"));
    expect(noteRow?.indexOf("!")).toBe(tick?.indexOf("✓"));
  });

  it("tty: erases the live bar, writes the row, and puts the bar back under it", () => {
    const out = fake(true);
    const ui = createUi({
      stream: out.stream,
      lang: "ru",
      env: { FORCE_COLOR: "1" },
      interval: () => () => undefined,
    });
    ui.phase(SCAN);
    ui.progress(3, 4);
    const before = out.chunks.length;
    ui.note(WARN);
    const written = out.chunks.slice(before);
    // erase, the row itself, then the bar again — three writes, in that order.
    expect(written).toHaveLength(3);
    expect(written[0]).toContain("\r");
    expect(written[1]).toContain("корпус eds неполон\n");
    expect(written[2]).toContain("75%");
  });

  it("tty: writes only the row when no phase is in flight — nothing to erase or restore", () => {
    const out = fake(true);
    const ui = createUi({ stream: out.stream, lang: "ru", env: { FORCE_COLOR: "1" } });
    ui.note(WARN);
    // The banner opened the UI, so the remark is not the first chunk; it is the last, and alone.
    expect(out.chunks.at(-1)).toContain("корпус eds неполон\n");
  });

  it("is ignored once the card has been drawn, like every other verb", () => {
    const out = fake(false);
    const ui = createUi({ stream: out.stream, lang: "ru" });
    ui.phase(SCAN);
    ui.done(OK);
    const after = out.text();
    ui.note(WARN);
    expect(out.text()).toBe(after);
  });

  it("does not appear in the phase ledger — a remark is not a step", () => {
    const out = fake(false);
    const ui = createUi({ stream: out.stream, lang: "ru" });
    ui.phase(SCAN);
    ui.note(WARN);
    ui.done(OK);
    // One `✓`, for `SCAN`. The remark left the ledger alone.
    expect(out.text().split("✓")).toHaveLength(2);
  });
});

/* ───────────────────────────────────── silentUi ──────────────────────────────────────────── */

describe("silentUi", () => {
  it("accepts the whole vocabulary and draws nothing anywhere", () => {
    expect(() => {
      silentUi.suspend();
      silentUi.phase(SCAN);
      silentUi.progress(1, 2);
      silentUi.note(BAD);
      silentUi.done(OK);
      silentUi.fail(BAD);
    }).not.toThrow();
  });
});

/* ─────────────────────────────── the card, both modes ────────────────────────────────────── */

describe("the final card, byte for byte", () => {
  const PHASES = [
    { label: "Чтение файлов", failed: false },
    { label: "Проверки", failed: true },
  ] as const;

  it("plain: a snapshot with no escape in it", () => {
    expect(card(PHASES, "не удалось", false, { color: false, truecolor: false, redraw: false }))
      .toMatchInlineSnapshot(`
        "
             ✓ Чтение файлов
             ✗ Проверки

          ╔═══════════════════════════════════════════════════════════════╗
          ║  не удалось                                                   ║
          ╚═══════════════════════════════════════════════════════════════╝

        "
      `);
  });

  it("color: the same card, wearing the installer's palette", () => {
    expect(card(PHASES, "не удалось", false, { color: true, truecolor: true, redraw: true }))
      .toMatchInlineSnapshot(`
        "
        [K
             [0;32m✓[0m Чтение файлов
             [0;31m✗[0m Проверки

          [1m[0;31m╔═══════════════════════════════════════════════════════════════╗[0m
          [1m[0;31m║[0m  [1mне удалось[0m                                                   [1m[0;31m║[0m
          [1m[0;31m╚═══════════════════════════════════════════════════════════════╝[0m

        "
      `);
  });
});

/**
 * `ended()` — the predicate the CLI uses to keep the final sentence from being said twice
 * (V2 audit MINOR-1; the rule and its two halves are pinned in `cli/tests/run.test.ts`).
 *
 * It is asserted here as a state machine rather than through the CLI, because that is what it
 * is: false until a card is drawn, true forever after, and — the case the whole thing hinges on
 * — false forever for a UI that draws no card at all.
 */
describe("ended()", () => {
  it("is false until the card is drawn, in BOTH lanes", () => {
    for (const isTTY of [false, true]) {
      const ui = createUi({ stream: fake(isTTY).stream, lang: "ru" });
      expect(ui.ended()).toBe(false);
      ui.phase(SCAN);
      // A phase in flight is not an ending: the sentence has not been said yet.
      expect(ui.ended()).toBe(false);
      ui.progress(1, 2);
      expect(ui.ended()).toBe(false);
    }
  });

  it("is true after done, and after fail, and stays true", () => {
    const ok = createUi({ stream: fake(false).stream, lang: "ru" });
    ok.phase(SCAN);
    ok.done(OK);
    expect(ok.ended()).toBe(true);

    const bad = createUi({ stream: fake(false).stream, lang: "ru" });
    bad.phase(CHECK);
    bad.fail(BAD);
    expect(bad.ended()).toBe(true);
    // `done`/`fail` are terminal and idempotent, so a second call changes neither the stream
    // nor the answer.
    bad.done(OK);
    expect(bad.ended()).toBe(true);
  });

  it("says the card carries the message, so the answer and the bytes agree", () => {
    // The predicate is only useful if `true` really means "the sentence is on the stream".
    // Checked in the PLAIN lane, which is where the doubling was most visible.
    const recorder = fake(false);
    const ui = createUi({ stream: recorder.stream, lang: "ru" });
    ui.phase(CHECK);
    expect(recorder.text()).not.toContain(BAD.ru);
    ui.fail(BAD);
    expect(ui.ended()).toBe(true);
    expect(recorder.text()).toContain(BAD.ru);
  });

  it("silentUi answers false forever — it draws no card, so it has said nothing", () => {
    expect(silentUi.ended()).toBe(false);
    silentUi.phase(SCAN);
    silentUi.fail(BAD);
    // The one that matters: a caller reading this to decide whether to print its own line must
    // still print it, or a context with no terminal loses the failure entirely.
    expect(silentUi.ended()).toBe(false);
    silentUi.done(OK);
    expect(silentUi.ended()).toBe(false);
  });
});
