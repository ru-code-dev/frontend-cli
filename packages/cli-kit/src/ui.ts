/**
 * THE TERMINAL UI — colors, a progress line and a final card, for every `fe` command.
 *
 * The look is not invented here: it is the `ru-code` installer's, ported glyph for glyph and
 * escape for escape from the generated script the owner pointed at as the reference
 * (`/mnt/mac/Users/user/WORKSPACE/Projects/experements/ru-code/install`, READ-ONLY). Every
 * constant below carries the line it came from:
 *
 *  - the palette — `install:180-181` (`RED`/`GREEN`/`YELLOW`/`AMBER`/`CYAN`/`DIM`/`BOLD`/`NC`);
 *  - the cyan→violet gradient endpoints — `install:104-105`;
 *  - `▸ <wordmark>` green arrow + gradient wordmark, plain bold without truecolor, `> <wordmark>`
 *    with no terminal at all — `install:240-256`;
 *  - the one-line progress bar, 24 cells of `▓`/`░`, a 22-column label and a dim `%3d%%`,
 *    redrawn with `\r\033[K` so a shorter frame never leaves stale glyphs — `install:260-268`;
 *  - the animator that eases a bar with no known total, one point every 80 ms, stopping short
 *    of full so only a real completion snaps it — `install:288-289`;
 *  - the double-rule box (`╔═╗`, 63 inner columns) and its ANSI-stripped padding —
 *    `install:106`, `install:307-325`;
 *  - the final card: the phase ledger with a green `✓` or a red `✗` on the phase that failed,
 *    then the status box, border cyan on success and red on failure with the status TEXT left
 *    readable rather than tinted to match the alarm — `install:585-660`.
 *
 * THREE RULES THIS MODULE IS BUILT AROUND.
 *
 * 1. **It writes to the stream it is handed and to nothing else.** The CLI hands it `stderr`,
 *    so `stdout` stays exactly what it was: an SVG redirected into a file is still byte-for-byte
 *    the SVG (`packages/fe-pixso/src/commands.ts:113-116`), `--help` is still the help.
 * 2. **No terminal, no escapes.** `stream.isTTY !== true`, `NO_COLOR`, or `FORCE_COLOR=0` and
 *    the whole thing degrades to plain sequential lines — no color, no `\r` redraw, no
 *    animator. That is the installer's own gate (`install:173-186`), and it is what makes
 *    `2>` logs and CI output readable.
 * 3. **No dependency, no node builtin, no import of `process`.** The stream, the language, the
 *    environment and even the interval timer arrive as arguments, which is why the whole
 *    renderer can be driven by a fake stream in a tier-1 test with zero process access — the
 *    same reason `CommandContext` injects its streams (`packages/cli-kit/src/index.ts:44-46`).
 *
 * `pick` is imported from the contract module and used ONLY inside function bodies. The two
 * modules reference each other (the contract needs {@link CommandUi} as a type, this needs
 * `pick` at runtime), and calling it lazily means the cycle can never be observed: by the time
 * any UI method runs, both modules are long since evaluated.
 */
import { type Lang, type Localized, pick } from "./index.ts";

/* ─────────────────────────────────────── the surface ─────────────────────────────────────── */

/**
 * What a command may do to the terminal. A command announces a phase, optionally reports
 * movement inside it, may remark on something non-fatal along the way, and ends exactly once.
 *
 * Labels are `Localized` rather than `string` for the reason the contract states in its header:
 * a phase name is a user-facing string, and `--lang ru|en` has to reach it
 * (`packages/cli-kit/src/index.ts:11-16`). The type is the enforcement — a phase that ships
 * only English cannot be constructed.
 */
export interface CommandUi {
  /** Announce a phase. Ends the previous one; the first call also draws the banner. */
  phase(label: Localized): void;
  /** Movement inside the current phase. `total <= 0` is ignored rather than divided by. */
  progress(done: number, total: number): void;
  /**
   * A NON-FATAL REMARK, drawn in the gutter beside the phase lines — V3 MINOR-5.
   *
   * It exists because `--project-report`'s corpus warnings ("the eds corpus is incomplete …")
   * were written with a raw `ctx.stderr`, which lands an unindented line in the middle of the
   * UI's own two-space-indented output and, with a live progress bar in flight, on the bar's
   * row. A warning is the UI's business: it is neither the run's data (that is `stdout`) nor
   * its verdict (that is the card).
   *
   * OPTIONAL, uniquely among the verbs, and the reason is narrow enough to state exactly:
   * `CommandUi` is what a test recorder implements by hand, and recorders that predate this
   * verb are not all in this fix's blast radius. The two REAL implementations cannot forget it
   * — {@link TerminalUi} redeclares it as REQUIRED, so both `createUi` and `silentUi` are
   * compiler-checked. A caller therefore writes `ctx.ui.note?.(message)`, and the worst a
   * recorder without it can do is not record a remark.
   */
  note?(message: Localized): void;
  /** Finish successfully: every reached phase gets a `✓`, and the card carries `summary`. */
  done(summary: Localized): void;
  /** Finish with a failure: the phase in flight gets a `✗`, and the card carries `message`. */
  fail(message: Localized): void;
}

/**
 * What {@link createUi} hands back: the four verbs, plus the one thing only the OWNER of the UI
 * needs.
 *
 * `suspend` exists because two streams share one terminal. The progress bar lives on a line
 * with no newline on the end of it, so anything written to `stdout` while a phase is in flight
 * lands ON that line and the next animator frame draws over the result. A caller that is about
 * to write to the other stream calls `suspend` first, the live line is erased, and the next
 * frame redraws the bar below whatever was printed — which is how `cli/src/main.ts` can wrap
 * `ctx.stdout` once and make every command's stdout line come out clean.
 *
 * It is deliberately NOT on {@link CommandUi}: a command has no business erasing rows, and the
 * contract stays the four verbs the brief fixes.
 */
export interface TerminalUi extends CommandUi {
  /** REQUIRED here, optional on {@link CommandUi} — see the note there for why the split. */
  note(message: Localized): void;
  /** Erase the live progress line, if there is one, so another stream may write a full line. */
  suspend(): void;
  /**
   * Has the card been drawn? — i.e. has `done`/`fail` already put the run's final sentence on
   * the stream?
   *
   * The owner asks this to keep that sentence from being printed TWICE. A command's refusal
   * path calls `ui.fail(message)` and then writes the same `message` bare
   * (`packages/fe-pixso/src/commands.ts:79-83`,
   * `packages/fe-project-report/src/command.ts:144-146`) — a habit from before the card
   * existed, when the bare line was the only output there was. Now the card carries the
   * sentence in EVERY mode, plain lane included, so the bare line is the same words a second
   * time. The owner's `ctx.stderr` wrapper drops writes that arrive once this returns true,
   * which makes the card the last thing on the stream.
   *
   * {@link silentUi} answers `false` forever, and must: it draws no card, so nothing it was
   * told has been said yet and a caller's bare line is the only output there is.
   */
  ended(): boolean;
}

/**
 * The stream the UI writes to — `process.stderr`'s shape, reduced to what is actually used.
 *
 * `isTTY` is optional because that is how node spells it (`WriteStream.isTTY?: boolean`) and
 * because a fake stream in a test may simply omit it, which reads as "not a terminal".
 */
export interface UiStream {
  write(chunk: string): void;
  readonly isTTY?: boolean | undefined;
}

/** Everything {@link createUi} would otherwise reach for globally. */
export interface UiOptions {
  /** Where the UI goes. The CLI passes `stderr`; a test passes a recorder. */
  readonly stream: UiStream;
  /** The language every label is rendered in. */
  readonly lang: Lang;
  /** Read for `NO_COLOR`, `FORCE_COLOR` and `COLORTERM`. Omitted reads as an empty environment. */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  /** The word after the arrow in the banner. Defaults to the bin's name. */
  readonly wordmark?: string | undefined;
  /**
   * The animator's clock: start a repeating tick, get back the way to stop it. Defaulted from
   * `setInterval`/`clearInterval` (unref'd, so a forgotten animator can never hold the process
   * open); a test passes a hand-cranked one and keeps the suite free of real time.
   */
  readonly interval?: ((tick: () => void, ms: number) => () => void) | undefined;
}

/** What the terminal in play can actually do — the whole of the TTY gate, in one value. */
export interface UiCapability {
  /** Escapes at all: colors, and the styling inside the banner and the card. */
  readonly color: boolean;
  /** 24-bit color, which is what the gradient wordmark needs. */
  readonly truecolor: boolean;
  /** `\r`-redraw of a single line: the progress bar and the animator. */
  readonly redraw: boolean;
}

/* ──────────────────────────────── palette + layout constants ─────────────────────────────── */

const ESC = "\u001b";

/** `install:180-181`, verbatim. `AMBER` and `YELLOW` are unused by this module's own drawing
 *  but are part of the palette the brief names, and a caller composing a line needs them. */
export const ANSI = {
  RED: `${ESC}[0;31m`,
  GREEN: `${ESC}[0;32m`,
  YELLOW: `${ESC}[0;33m`,
  AMBER: `${ESC}[38;5;214m`,
  MAGENTA: `${ESC}[0;35m`,
  CYAN: `${ESC}[0;36m`,
  DIM: `${ESC}[2m`,
  BOLD: `${ESC}[1m`,
  NC: `${ESC}[0m`,
} as const;

/** `\r` + clear-to-end-of-line — the installer's artifact fix (`install:266-267`). */
const CLEAR_LINE = `\r${ESC}[K`;

/** The gradient's ends, `install:104-105`. */
const GRADIENT_FROM: readonly [number, number, number] = [56, 217, 238];
const GRADIENT_TO: readonly [number, number, number] = [167, 139, 250];

/** `install:262` — 24 cells. */
const BAR_WIDTH = 24;
/** `install:267` — `%-22s`. */
const LABEL_WIDTH = 22;
/** `install:106` — the box's inner width. */
const BOX_INNER = 63;
/** `install:288` — `sleep 0.08` between animator frames. */
const ANIMATOR_MS = 80;
/** `install:288` eases toward `to - 1`; only a real completion snaps a bar to full. */
const ANIMATOR_CEILING = 95;

/** Matches an SGR sequence, so a padded box line measures what the eye sees (`install:321`). */
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, "gu");

/* ────────────────────────────────────── pure renderers ───────────────────────────────────── */

/** Visible width of a line that may carry color — code points, escapes removed. */
export function visibleWidth(text: string): number {
  return [...text.replace(SGR, "")].length;
}

/** Read the terminal's capabilities off a stream and an environment. The whole TTY gate. */
export function capabilityOf(
  stream: UiStream,
  env: Readonly<Record<string, string | undefined>> = {},
): UiCapability {
  // `NO_COLOR` wins over everything, whatever it is set to, as long as it is set to something
  // (https://no-color.org). The brief names it as an unconditional off switch.
  const noColor = (env["NO_COLOR"] ?? "") !== "";
  const force = env["FORCE_COLOR"] ?? "";
  // `FORCE_COLOR=0` is an off switch too; any other non-empty value turns the UI ON where a
  // pipe would otherwise have turned it off. That second half is not the installer's (a shell
  // script has no such convention) but it is every node CLI's, and it is the only way to look
  // at the full-color form without a pseudo-terminal.
  const forcedOff = force === "0" || force === "false";
  const forcedOn = !forcedOff && force !== "";
  const tty = stream.isTTY === true;
  const color = !noColor && !forcedOff && (tty || forcedOn);
  const colorterm = env["COLORTERM"] ?? "";
  return {
    color,
    truecolor: color && (colorterm === "truecolor" || colorterm === "24bit"),
    redraw: color,
  };
}

/** One cyan→violet sweep across `text`, `install:225-243`. Spaces pass through uncolored. */
export function gradient(text: string): string {
  const chars = [...text];
  const span = chars.length > 1 ? chars.length - 1 : 1;
  return chars
    .map((ch, index) => {
      if (ch === " ") return ch;
      const channel = (from: number, to: number): number =>
        // Truncating division, which is what the shell's `$(( ))` does (`install:236-238`).
        from + Math.trunc(((to - from) * index) / span);
      const r = channel(GRADIENT_FROM[0], GRADIENT_TO[0]);
      const g = channel(GRADIENT_FROM[1], GRADIENT_TO[1]);
      const b = channel(GRADIENT_FROM[2], GRADIENT_TO[2]);
      return `${ESC}[1;38;2;${String(r)};${String(g)};${String(b)}m${ch}${ANSI.NC}`;
    })
    .join("");
}

/** `▸ fe`, in the best form the terminal supports (`install:245-256`). */
export function banner(wordmark: string, capability: UiCapability): string {
  if (capability.truecolor) return `\n  ${ANSI.GREEN}▸${ANSI.NC} ${gradient(wordmark)}\n\n`;
  if (capability.color) {
    return `\n  ${ANSI.GREEN}▸${ANSI.NC} ${ANSI.BOLD}${wordmark}${ANSI.NC}\n\n`;
  }
  return `\n  > ${wordmark}\n\n`;
}

/** The single progress line, ready to write. `install:260-268`, including the leading `\r\033[K`. */
export function progressLine(percent: number, label: string): string {
  const pct = Math.max(0, Math.min(100, Math.trunc(percent)));
  const filled = Math.trunc((pct * BAR_WIDTH) / 100);
  const bar = "▓".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
  const shown =
    label.length > LABEL_WIDTH ? label.slice(0, LABEL_WIDTH) : label.padEnd(LABEL_WIDTH);
  return `${CLEAR_LINE}  ${ANSI.CYAN}${bar}${ANSI.NC}  ${shown} ${ANSI.DIM}${String(pct).padStart(3)}%${ANSI.NC}`;
}

/**
 * Break `text` onto box-width lines — `install:328-337`, with two departures.
 *
 * FIRST, the bug. The shell version breaks on spaces and nothing else, so a single token wider
 * than the box simply runs through the right border and takes the frame with it. Every card
 * this module draws carries an absolute path, and absolute paths are exactly that token, so a
 * word too long to fit is HARD-BROKEN at the width here rather than allowed to overflow.
 * Measured in code points, for the same reason the installer hunts down a UTF-8 locale before
 * it counts (`install:189-198`): Cyrillic is one column per character but not one byte.
 *
 * SECOND, an explicit `\n` is a LINE BREAK and not whitespace to be flowed over. The output
 * contract (`./out.ts`'s `resultOf`) builds every command's final message as a headline
 * followed by one absolute path per line, and a card that reflowed that list into a paragraph
 * would run two paths together on one row — the single most confusing thing a list of paths can
 * do. So the message is split on newlines first and each piece is wrapped on its own; every
 * other kind of whitespace still collapses exactly as the installer's version collapses it.
 */
function wrap(text: string, width: number): string[] {
  const lines = text.split("\n").flatMap((part) => wrapParagraph(part, width));
  // A message that is entirely empty still owes the box one row, and so does a deliberate
  // blank line inside one — `wrapParagraph` returns `[""]` for both, and neither is dropped.
  return lines.length === 0 ? [""] : lines;
}

/** One paragraph — no newlines in it — flowed onto `width`-wide rows. */
function wrapParagraph(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/u).filter((part) => part !== "")) {
    const chars = [...word];
    if (chars.length > width) {
      if (line !== "") {
        lines.push(line);
        line = "";
      }
      while (chars.length > width) lines.push(chars.splice(0, width).join(""));
    }
    const rest = chars.join("");
    if (rest === "") continue;
    if (line === "") line = rest;
    else if ([...line].length + 1 + chars.length <= width) line = `${line} ${rest}`;
    else {
      lines.push(line);
      line = rest;
    }
  }
  if (line !== "") lines.push(line);
  return lines.length === 0 ? [""] : lines;
}

/** One phase, as the final card remembers it. */
export interface PhaseRecord {
  readonly label: string;
  readonly failed: boolean;
}

/**
 * THE FINAL CARD — the phase ledger, then the status box (`install:585-660`).
 *
 * The border carries the severity and the status TEXT stays readable: green on success, and
 * left uncolored on a failure rather than tinted to match the red border. That is the
 * installer's own note at `install:590-591`, and it is the difference between a card that
 * reads as a result and one that reads as an alarm.
 */
export function card(
  phases: readonly PhaseRecord[],
  message: string,
  ok: boolean,
  capability: UiCapability,
): string {
  const c = capability.color;
  const border = c ? (ok ? ANSI.CYAN : ANSI.RED) : "";
  const tint = c && ok ? ANSI.GREEN : "";
  const bold = c ? ANSI.BOLD : "";
  const nc = c ? ANSI.NC : "";
  const rule = "═".repeat(BOX_INNER);

  const boxLine = (content: string): string => {
    const pad = Math.max(0, BOX_INNER - visibleWidth(content));
    return `  ${bold}${border}║${nc}${content}${" ".repeat(pad)}${bold}${border}║${nc}\n`;
  };

  let out = capability.redraw ? CLEAR_LINE : "";
  out += "\n";
  for (const phase of phases) {
    const mark = phase.failed ? `${c ? ANSI.RED : ""}✗${nc}` : `${c ? ANSI.GREEN : ""}✓${nc}`;
    out += `     ${mark} ${phase.label}\n`;
  }
  out += "\n";
  out += `  ${bold}${border}╔${rule}╗${nc}\n`;
  for (const line of wrap(message, BOX_INNER - 4)) {
    out += boxLine(`  ${bold}${tint}${line}${nc}`);
  }
  out += `  ${bold}${border}╚${rule}╝${nc}\n`;
  out += "\n";
  return out;
}

/* ─────────────────────────────────────── the machine ─────────────────────────────────────── */

/** The `interval` default: a real timer that can never hold the process open. */
function timerInterval(tick: () => void, ms: number): () => void {
  const handle: unknown = setInterval(tick, ms);
  if (typeof handle === "object" && handle !== null && "unref" in handle) {
    (handle as { unref: () => void }).unref();
  }
  return () => {
    clearInterval(handle as ReturnType<typeof setInterval>);
  };
}

/**
 * Build the UI a command runs against.
 *
 * The state machine is the installer's `run_phase` (`install:271-303`) with the fork replaced
 * by a timer: one line morphs across the phases, an animator eases it while a phase has no
 * countable work, a real `progress` call takes the animator's place, and the card at the end
 * owns the `✓`/`✗` per phase. `done`/`fail` are terminal — a second call is ignored, so a
 * command that reports a failure and then returns cannot draw two cards.
 */
export function createUi(options: UiOptions): TerminalUi {
  const stream = options.stream;
  const capability = capabilityOf(stream, options.env ?? {});
  const wordmark = options.wordmark ?? "fe";
  const startInterval = options.interval ?? timerInterval;

  const phases: PhaseRecord[] = [];
  let current: { label: string; failed: boolean } | null = null;
  let stopAnimator: (() => void) | null = null;
  let percent = 0;
  let opened = false;
  let closed = false;

  const say = (message: Localized): string => pick(message, options.lang);

  const open = (): void => {
    if (opened) return;
    opened = true;
    stream.write(banner(wordmark, capability));
  };

  const stop = (): void => {
    if (stopAnimator === null) return;
    stopAnimator();
    stopAnimator = null;
  };

  /** Retire the phase in flight into the ledger. */
  const seal = (): void => {
    stop();
    if (current === null) return;
    phases.push({ label: current.label, failed: current.failed });
    current = null;
  };

  return {
    suspend(): void {
      if (!capability.redraw || current === null || closed) return;
      stream.write(CLEAR_LINE);
    },

    ended(): boolean {
      return closed;
    },

    phase(label: Localized): void {
      if (closed) return;
      open();
      seal();
      const text = say(label);
      current = { label: text, failed: false };
      percent = 0;
      if (!capability.redraw) {
        // The plain lane: one sequential line per phase, no escapes and nothing to redraw.
        stream.write(`  ${text}…\n`);
        return;
      }
      stream.write(progressLine(0, text));
      stopAnimator = startInterval(() => {
        if (current === null) return;
        if (percent < ANIMATOR_CEILING) percent += 1;
        stream.write(progressLine(percent, current.label));
      }, ANIMATOR_MS);
    },

    note(message: Localized): void {
      if (closed) return;
      open();
      // The live bar owns a line with no newline on it, so the remark would otherwise be drawn
      // ON the bar and then painted over by the next animator frame. Erase, write the remark as
      // its own row, redraw the bar under it — the same suspend/resume dance `cli/src/main.ts`
      // performs around a command's `stdout`.
      if (capability.redraw && current !== null) stream.write(CLEAR_LINE);
      const mark = capability.color ? `${ANSI.YELLOW}!${ANSI.NC}` : "!";
      // Five spaces, which is the phase ledger's own gutter (`card`: `     ✓ label`), so a
      // remark reads as belonging to the run rather than as something that escaped it.
      stream.write(`     ${mark} ${say(message)}\n`);
      if (capability.redraw && current !== null) {
        stream.write(progressLine(percent, current.label));
      }
    },

    progress(done: number, total: number): void {
      if (closed || current === null || total <= 0) return;
      // A phase that can count its own work has no use for a guess: the animator retires the
      // moment a real number arrives, and never restarts inside this phase.
      stop();
      percent = Math.max(0, Math.min(100, Math.trunc((done * 100) / total)));
      if (!capability.redraw) return;
      stream.write(progressLine(percent, current.label));
    },

    done(summary: Localized): void {
      if (closed) return;
      closed = true;
      open();
      seal();
      stream.write(card(phases, say(summary), true, capability));
    },

    fail(message: Localized): void {
      if (closed) return;
      closed = true;
      open();
      if (current !== null) current.failed = true;
      seal();
      stream.write(card(phases, say(message), false, capability));
    },
  };
}

/**
 * A UI that draws nothing.
 *
 * This is what a context gets when there is no terminal to draw on and no test asserting on
 * one — every existing suite that builds a `CommandContext` by hand, for instance. It is a
 * value rather than a factory because it holds no state: calls that return.
 */
export const silentUi: TerminalUi = {
  suspend(): void {
    /* nothing to erase */
  },
  /** Never — a UI that drew no card has said nothing, so a caller's own line must still go out. */
  ended(): boolean {
    return false;
  },
  phase(): void {
    /* nothing to draw */
  },
  progress(): void {
    /* nothing to draw */
  },
  note(): void {
    /* nothing to draw */
  },
  done(): void {
    /* nothing to draw */
  },
  fail(): void {
    /* nothing to draw */
  },
};
