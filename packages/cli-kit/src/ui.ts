/**
 * THE TERMINAL UI — one grammar for every `fg` command: header → progress → summary.
 *
 * The installer look this module used to port (banner, `╔═╗` card, `✓` checklist, gradient
 * wordmark) is HISTORY: the owner rejected it — "unreadable, unformatted, everything
 * inconsistent, the CLI is unusable" — and the replacement is fixed by
 * `WORKFLOW/features/cli-ux/plans/ux-design.md` §2, which this file implements literally.
 *
 * THE LAWS, all four from that document and all four enforced here rather than at call sites:
 *
 *  1. U3 STREAM DISCIPLINE. This module writes to the stream it was handed — `stderr` in the
 *     CLI's wiring — and to nothing else. Every human line goes out EXACTLY ONCE: no banner,
 *     no box, no checklist, no sentence repeated on stdout. What goes on stdout is data, and
 *     `emitPaths` (`./out.ts`) is the only thing in this package that touches it.
 *  2. U6 PATHS ARE NEVER WRAPPED OR TRUNCATED. A summary row of kind `"path"` is written
 *     verbatim, on its own line, however long it is. The old card hard-broke absolute paths at
 *     59 columns; that is the single defect this rewrite exists to remove.
 *  3. U7 COLOURS ONLY ON A TTY WITHOUT `NO_COLOR` — the existing {@link capabilityOf} gate,
 *     unchanged. The plain lane emits the same TEXT with zero escape bytes.
 *  4. U10 ELAPSED TIME. The summary headline carries the run's elapsed; in the non-TTY lane
 *     each phase carries its own.
 *
 * NO DEPENDENCY, NO NODE BUILTIN, NO `process`. The stream, the language, the environment, the
 * version, the interval timer and even the clock arrive as arguments, which is why the whole
 * renderer is driven by a fake stream and a hand-cranked ticker in
 * `packages/cli-kit/tests/ui.test.ts` with zero process access.
 *
 * `pick` is imported from the contract module and used ONLY inside function bodies: the two
 * modules reference each other (the contract needs {@link CommandUi} as a type, this needs
 * `pick` at runtime) and calling it lazily means the cycle can never be observed.
 */
import { type Lang, type Localized, pick } from "./index.ts";

/* ─────────────────────────────────────── the surface ─────────────────────────────────────── */

/** One row of a {@link Summary} block: a dim key, a value, and what kind of value it is. */
export interface SummaryRow {
  readonly key: Localized;
  /**
   * A plain `string` is allowed beside `Localized` for one reason: an absolute path is the same
   * text in both languages, and forcing `{ ru: p, en: p }` at every call site would be a shape
   * whose two halves can drift apart for no benefit.
   */
  readonly value: Localized | string;
  /** `"path"` is written verbatim and never coloured — U6. Defaults to `"text"`. */
  readonly kind?: "text" | "path" | undefined;
}

/** The block that ENDS a run — design §2.3. */
export interface Summary {
  /** `true` → green `✔` headline; `false` → red `✖`. */
  readonly ok: boolean;
  readonly headline: Localized;
  readonly rows: readonly SummaryRow[];
  /** Print the run's elapsed on the headline. Default `true` (U10). */
  readonly elapsed?: boolean | undefined;
}

/**
 * The two pointer lines under a failure — design §2.6.
 *
 * `usage` is the command's own usage line (`fg --preport <путь|repo> …`); an EMPTY string prints
 * no usage row, which is the runtime-failure shape (`подробнее: fg … --debug` alone). Neither
 * string is `Localized`: both are command lines, and a command line a user must retype cannot
 * be translated.
 */
export interface UsageHint {
  readonly usage: string;
  readonly help: string;
}

/**
 * WHAT A COMMAND MAY DO TO THE TERMINAL — design §3, verbatim.
 *
 * Every label is `Localized` rather than `string` for the reason the contract states in its
 * header: `--lang ru|en` has to reach it, and the type is the enforcement.
 */
export interface CommandUi {
  /** The header line, once, first thing a command prints. `fg v<version>` is prefixed here. */
  header(parts: readonly Localized[]): void;
  /**
   * Start a phase, ending the previous one.
   *
   * `detail` is what the NON-TTY row says the phase did (`598 файлов`, `html, sarif`). When it
   * is omitted and {@link CommandUi.progress} was called with a unit, the row's detail is
   * `total unit` instead — so a counted phase documents itself.
   */
  phase(label: Localized, detail?: Localized): void;
  /** Movement inside the current phase. `total <= 0` is ignored rather than divided by. */
  progress(done: number, total: number, unit?: Localized): void;
  /** A non-fatal remark: `  · …`, dim. */
  note(message: Localized): void;
  /** A warning: `  ! …`, yellow. */
  warn(message: Localized): void;
  /**
   * SEAL THE PHASE IN FLIGHT WITHOUT SAYING ANYTHING ELSE — design §2.3's compact-only run.
   *
   * `summary` is the only other thing that retires a phase, and that made two unrelated
   * decisions one: a run whose document IS its summary (`--format compact`, §2.3: "Compact-only
   * runs print NO summary block") still had to print a headline just to get the live line
   * erased and the last ledger row written (V5 finding #10). It is also what a command calls
   * before it writes to STDOUT, so the ledger row lands ahead of the data rather than after it
   * (V5 finding #2).
   *
   * `detail` overrides what the ending row says it did, for a phase whose answer is known only
   * when it ends. Idempotent, and NOT terminal: a `summary` may still follow.
   */
  end(detail?: Localized): void;
  /** The summary block (§2.3). ENDS the run. */
  summary(summary: Summary): void;
  /**
   * The failure block (§2.6). ENDS the run.
   *
   * `detail` is the second, dim line under the headline: §2.6's headline is four words
   * (`✖ не указан проект`) and everything that explains it belongs BELOW, where it does not
   * push the line past 100 columns (V5 finding #21).
   */
  fail(message: Localized, hint?: UsageHint, detail?: Localized): void;
  /** Has the run already ended — i.e. has `summary`/`fail` been drawn? */
  ended(): boolean;
}

/**
 * What {@link createUi} hands back: the contract, plus the one fact only the CLI's wiring needs.
 *
 * `stdoutIsTTY` lives here so the question "is stdout a terminal" has exactly ONE answer per
 * invocation. U3 makes that answer load-bearing — path lines go to stdout only when stdout is
 * NOT a TTY — and a CLI that read `process.stdout.isTTY` in one place and passed a different
 * value to the UI in another would be a CLI whose two halves could disagree.
 */
export interface TerminalUi extends CommandUi {
  readonly stdoutIsTTY: boolean;
}

/**
 * The stream the UI writes to — `process.stderr`'s shape, reduced to what is actually used.
 *
 * `isTTY` is optional because that is how node spells it and because a fake stream in a test may
 * simply omit it, which reads as "not a terminal".
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
  /** The CLI's version, printed in the header as `fg v<version>`. */
  readonly version?: string | undefined;
  /** Whether STDOUT — not this stream — is a terminal. Surfaced as {@link TerminalUi.stdoutIsTTY}. */
  readonly stdoutIsTTY?: boolean | undefined;
  /** The bin's name, ahead of the version in the header. */
  readonly bin?: string | undefined;
  /**
   * The spinner's clock: start a repeating tick, get back the way to stop it. Defaulted from
   * `setInterval`/`clearInterval` (unref'd, so a forgotten spinner can never hold the process
   * open); a test passes a hand-cranked one and keeps the suite free of real time.
   */
  readonly interval?: ((tick: () => void, ms: number) => () => void) | undefined;
  /** Elapsed time's clock. Defaulted from `Date.now`; a test passes a counter. */
  readonly now?: (() => number) | undefined;
}

/** What the terminal in play can actually do — the whole of the TTY gate, in one value. */
export interface UiCapability {
  /** Escapes at all: colours. */
  readonly color: boolean;
  /** 24-bit colour. Nothing in the new grammar needs it; kept because callers ask. */
  readonly truecolor: boolean;
  /** `\r`-redraw of a single line: the live progress line. */
  readonly redraw: boolean;
}

/* ──────────────────────────────── palette + layout constants ─────────────────────────────── */

const ESC = "\u001b";

/** The palette. Only what the grammar actually uses is drawn with; the rest is for callers. */
export const ANSI = {
  RED: `${ESC}[0;31m`,
  GREEN: `${ESC}[0;32m`,
  YELLOW: `${ESC}[0;33m`,
  AMBER: `${ESC}[38;5;214m`,
  MAGENTA: `${ESC}[0;35m`,
  CYAN: `${ESC}[0;36m`,
  BLUE: `${ESC}[0;34m`,
  DIM: `${ESC}[2m`,
  BOLD: `${ESC}[1m`,
  NC: `${ESC}[0m`,
} as const;

/** `\r` + clear-to-end-of-line: how the live line is erased before anything else is written. */
const ERASE = `\r${ESC}[K`;

/** Design §2.2 — the spinner, ten frames. */
const SPINNER = [..."⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"];
/** Design §2.2 — `▕████████░░░░░░░░▏`, sixteen cells. */
const BAR_CELLS = 16;
const BAR_OPEN = "▕";
const BAR_CLOSE = "▏";
const BAR_FULL = "█";
const BAR_EMPTY = "░";
/** One spinner frame every 80 ms — fast enough to read as motion, slow enough not to smear. */
const SPINNER_MS = 80;

/** The live line's label column (§2.2: the bar starts at column 18, after `⠋ `). */
const LIVE_LABEL = 16;
/** The non-TTY phase row's label column (§2.2: the detail starts at column 25, after two). */
const ROW_LABEL = 23;
/** The non-TTY phase row's detail column (§2.2: elapsed at column 38 when a detail is present). */
const ROW_DETAIL = 13;
/** The column the summary headline's elapsed starts at (§2.3, §2.5 — the samples agree on 51). */
const HEADLINE_WIDTH = 51;
/**
 * …and the LEAST space between a headline and its elapsed when the headline is wider than that.
 *
 * `--iconf`'s headline carries its counts (§2.5: `✔ конфигурация создана    32 правила · 30
 * подправил`) and reaches the column exactly, so padding to a fixed 51 would have run the
 * elapsed straight into «подправил». A column is a minimum here, not a promise.
 */
const ELAPSED_GAP = 2;
/**
 * The summary key column. The design's rule is "the longest key + 2"; every sample in it pads to
 * 12, which is that rule with a floor. Both are honoured: `max(longest + 2, 12)`.
 */
const KEY_MIN = 12;
/** The failure hint's label column (§2.6 pads `использование:` and `подробнее:` to 16). */
const HINT_LABEL_MIN = 16;

/** Matches an SGR sequence, so a padded line measures what the eye sees. */
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, "gu");

/** The two labels §2.6 puts in front of a failure's pointer lines. */
const USAGE_LABEL: Localized = { ru: "использование:", en: "usage:" };
const MORE_LABEL: Localized = { ru: "подробнее:", en: "more:" };

/* ────────────────────────────────────── pure renderers ───────────────────────────────────── */

/** Visible width of a line that may carry colour — code points, escapes removed. */
export function visibleWidth(text: string): number {
  return [...text.replace(SGR, "")].length;
}

/** Pad to `width` code points, measuring what the eye sees. Never truncates — U6's rule
 *  generalised: this module widens columns, it does not cut text to fit them. */
function pad(text: string, width: number): string {
  const gap = width - visibleWidth(text);
  return gap > 0 ? text + " ".repeat(gap) : text;
}

/** Read the terminal's capabilities off a stream and an environment. The whole TTY gate (U7). */
export function capabilityOf(
  stream: UiStream,
  env: Readonly<Record<string, string | undefined>> = {},
): UiCapability {
  // `NO_COLOR` wins over everything, whatever it is set to, as long as it is set to something
  // (https://no-color.org). The design names it as an unconditional off switch.
  const noColor = (env["NO_COLOR"] ?? "") !== "";
  const force = env["FORCE_COLOR"] ?? "";
  // `FORCE_COLOR=0` is an off switch too; any other non-empty value turns the UI ON where a pipe
  // would otherwise have turned it off — every node CLI's convention, and the only way to look
  // at the full-colour form without a pseudo-terminal.
  const forcedOff = force === "0" || force === "false";
  const forcedOn = !forcedOff && force !== "";
  const tty = stream.isTTY === true;
  const color = !noColor && !forcedOff && (tty || forcedOn);
  const colorterm = env["COLORTERM"] ?? "";
  return {
    color,
    truecolor: color && (colorterm === "truecolor" || colorterm === "24bit"),
    // THE LANE IS THE TERMINAL, NOT THE COLOUR — design §2.2 selects it by TTY-ness and U7
    // governs colour alone. Welding the two (`redraw: color`) made `NO_COLOR=1` on a real
    // terminal print the non-TTY phase ledger INTO the middle of the compact document on
    // stdout, and `FORCE_COLOR=1` into a pipe write a whole spinner animation into a log file
    // (V5 finding #1). `\r` and `\x1b[K` are CURSOR CONTROLS, not SGR: a terminal that was
    // asked for no colour is still a terminal that can redraw one line, so they stay.
    redraw: tty,
  };
}

/**
 * ELAPSED, design §2.5/§2.10's three shapes: `0.8s`, `41.2s`, `2m 05s`.
 *
 * One decimal below a minute, because sub-second precision is the whole information a fast
 * command carries; whole seconds above it, zero-padded, because `2m 5s` and `2m 05s` in a
 * column read very differently.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, ms);
  if (total < 60_000) return `${(total / 1000).toFixed(1)}s`;
  const seconds = Math.round(total / 1000);
  const minutes = Math.trunc(seconds / 60);
  return `${String(minutes)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * The live progress line — design §2.2, WITHOUT the leading erase (the caller owns that).
 *
 * `total <= 0` is the "unknown work" case and renders the label alone (`⠹ запись`): a bar with
 * no denominator is a lie, and the design draws none.
 */
export function liveLine(input: {
  readonly frame: string;
  readonly label: string;
  readonly done?: number | undefined;
  readonly total?: number | undefined;
  readonly unit?: string | undefined;
  readonly capability: UiCapability;
}): string {
  const c = input.capability.color;
  const dim = c ? ANSI.DIM : "";
  const cyan = c ? ANSI.CYAN : "";
  const nc = c ? ANSI.NC : "";
  const spinner = `${cyan}${input.frame}${nc}`;
  const total = input.total ?? 0;
  if (total <= 0) return `${spinner} ${input.label}`;
  const done = Math.max(0, Math.min(total, input.done ?? 0));
  // ROUNDED, not truncated: the design's own sample shows 20/32 as `63%` (§2.2), and a bar
  // that says 99% at 999/1000 is a bar that never finishes.
  const percent = Math.round((done * 100) / total);
  const filled = Math.trunc((percent * BAR_CELLS) / 100);
  const bar =
    `${dim}${BAR_OPEN}${nc}${cyan}${BAR_FULL.repeat(filled)}${nc}` +
    `${dim}${BAR_EMPTY.repeat(BAR_CELLS - filled)}${BAR_CLOSE}${nc}`;
  const counts = `${String(done)}/${String(total)}${input.unit === undefined ? "" : ` ${input.unit}`}`;
  return (
    `${spinner} ${pad(input.label, LIVE_LABEL)} ${bar} ` +
    `${dim}${String(percent).padStart(3)}%${nc}   ${counts}`
  );
}

/**
 * One non-TTY phase row — design §2.2's second block.
 *
 * THE COLUMNS ARE MINIMA, NOT PROMISES — the same rule {@link ELAPSED_GAP} already states for the
 * summary headline, applied here because the row had the identical defect and no guard.
 *
 * `pad` never truncates (U6 generalised), so a label wider than {@link ROW_LABEL} used to hand
 * its own text straight to the next column with NOTHING between them: `--iconf`'s English detect
 * phase is «selecting the design system», 27 characters, and a piped `fg --lang en --iconf`
 * printed `  selecting the design system0.0s` — the elapsed welded onto the label. The Russian
 * spelling is 20 characters, so the whole class of defect was invisible in the default language.
 *
 * Both columns get the floor, because both can be overrun: a long LABEL would otherwise collide
 * with the detail, and a long DETAIL with the elapsed.
 */
export function phaseRow(label: string, detail: string, elapsed: string): string {
  const head = pad(label, Math.max(ROW_LABEL, visibleWidth(label) + ELAPSED_GAP));
  if (detail === "") return `  ${head}${elapsed}\n`;
  const body = pad(detail, Math.max(ROW_DETAIL, visibleWidth(detail) + ELAPSED_GAP));
  return `  ${head}${body}${elapsed}\n`;
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

/** The phase in flight, and everything its row will need when it ends. */
interface LivePhase {
  readonly label: string;
  readonly startedAt: number;
  detail: string;
  done: number;
  total: number;
  unit: string | undefined;
  drawn: boolean;
}

/**
 * Build the UI a command runs against — design §2.1–§2.6.
 *
 * TWO LANES, one grammar. On a terminal there is ONE live line, redrawn in place, erased before
 * any other write reaches the stream; off a terminal each phase prints a row when it ENDS,
 * carrying what it did and how long it took. Both lanes print the same header, the same notes
 * and warnings and the same summary block, so a `2>` log and a live run read alike.
 *
 * `summary`/`fail` are TERMINAL and idempotent: a command that reports a failure and then
 * returns cannot draw two blocks, and `ended()` lets the CLI's wiring drop a duplicate line.
 */
export function createUi(options: UiOptions): TerminalUi {
  const stream = options.stream;
  const capability = capabilityOf(stream, options.env ?? {});
  const startInterval = options.interval ?? timerInterval;
  const now = options.now ?? Date.now;
  const bin = options.bin ?? "fg";
  const version = options.version;
  const startedAt = now();

  let current: LivePhase | null = null;
  let stopSpinner: (() => void) | null = null;
  let frame = 0;
  let closed = false;

  const say = (message: Localized): string => pick(message, options.lang);
  const colour = (code: string, text: string): string =>
    capability.color ? `${code}${text}${ANSI.NC}` : text;

  /** Erase the live line if one is on screen. Called before EVERY other write (§2.2). */
  const erase = (): void => {
    if (current?.drawn === true && capability.redraw) {
      stream.write(ERASE);
      current.drawn = false;
    }
  };

  const draw = (): void => {
    if (current === null || !capability.redraw || closed) return;
    stream.write(
      ERASE +
        liveLine({
          frame: SPINNER[frame % SPINNER.length] ?? SPINNER[0] ?? "",
          label: current.label,
          done: current.done,
          total: current.total,
          ...(current.unit === undefined ? {} : { unit: current.unit }),
          capability,
        }),
    );
    current.drawn = true;
  };

  const stop = (): void => {
    if (stopSpinner === null) return;
    stopSpinner();
    stopSpinner = null;
  };

  /** Retire the phase in flight: erase its live line, or print its row in the plain lane. */
  const seal = (): void => {
    stop();
    if (current === null) return;
    if (capability.redraw) erase();
    else {
      const detail =
        current.detail !== ""
          ? current.detail
          : current.total > 0
            ? `${String(current.total)}${current.unit === undefined ? "" : ` ${current.unit}`}`
            : "";
      stream.write(phaseRow(current.label, detail, formatElapsed(now() - current.startedAt)));
    }
    current = null;
  };

  /** A gutter line — `  · note` / `  ! warning` (§2.5). Erases the live line, then redraws it. */
  const gutter = (mark: string, text: string): void => {
    erase();
    stream.write(`  ${mark} ${text}\n`);
    draw();
  };

  return {
    stdoutIsTTY: options.stdoutIsTTY === true,

    ended(): boolean {
      return closed;
    },

    header(parts: readonly Localized[]): void {
      if (closed) return;
      erase();
      const name = version === undefined ? bin : `${bin} v${version}`;
      const all = [colour(ANSI.DIM, name), ...parts.map((part) => say(part))];
      stream.write(`${all.join(" · ")}\n`);
      draw();
    },

    phase(label: Localized, detail?: Localized): void {
      if (closed) return;
      seal();
      current = {
        label: say(label),
        startedAt: now(),
        detail: detail === undefined ? "" : say(detail),
        done: 0,
        total: 0,
        unit: undefined,
        drawn: false,
      };
      if (!capability.redraw) return;
      draw();
      // The spinner turns even while nothing countable is happening — that is the whole signal a
      // phase with no total can give. It is stopped by `seal`, and by `summary`/`fail`.
      stopSpinner = startInterval(() => {
        frame += 1;
        draw();
      }, SPINNER_MS);
    },

    progress(done: number, total: number, unit?: Localized): void {
      if (closed || current === null || total <= 0) return;
      current.done = done;
      current.total = total;
      if (unit !== undefined) current.unit = say(unit);
      draw();
    },

    note(message: Localized): void {
      if (closed) return;
      gutter(colour(ANSI.DIM, "·"), colour(ANSI.DIM, say(message)));
    },

    warn(message: Localized): void {
      if (closed) return;
      gutter(colour(ANSI.YELLOW, "!"), say(message));
    },

    end(detail?: Localized): void {
      if (closed || current === null) return;
      if (detail !== undefined) current.detail = say(detail);
      seal();
    },

    summary(summary: Summary): void {
      if (closed) return;
      seal();
      closed = true;
      const glyph = summary.ok ? colour(ANSI.GREEN, "✔") : colour(ANSI.RED, "✖");
      const headline = `${glyph} ${say(summary.headline)}`;
      const withElapsed =
        summary.elapsed === false
          ? headline
          : `${pad(headline, Math.max(HEADLINE_WIDTH, visibleWidth(headline) + ELAPSED_GAP))}` +
            formatElapsed(now() - startedAt);
      let out = `${withElapsed}\n`;
      const width = Math.max(KEY_MIN, ...summary.rows.map((row) => visibleWidth(say(row.key)) + 2));
      for (const row of summary.rows) {
        // U6: a path is written verbatim — no wrap, no truncation, no colour on the value.
        const value = typeof row.value === "string" ? row.value : say(row.value);
        out += `  ${pad(colour(ANSI.DIM, say(row.key)), width)}${value}\n`;
      }
      stream.write(out);
    },

    fail(message: Localized, hint?: UsageHint, detail?: Localized): void {
      if (closed) return;
      seal();
      closed = true;
      let out = `${colour(ANSI.RED, "✖")} ${say(message)}\n`;
      // §2.6's explanation line, dim and indented to the hint rows' gutter so the block reads as
      // one thing: headline, why, then what to type.
      if (detail !== undefined) out += `  ${colour(ANSI.DIM, say(detail))}\n`;
      if (hint !== undefined) {
        const labels = [say(USAGE_LABEL), say(MORE_LABEL)];
        const width = Math.max(HINT_LABEL_MIN, ...labels.map((l) => l.length + 2));
        if (hint.usage !== "") {
          out += `  ${pad(colour(ANSI.DIM, labels[0] ?? ""), width)}${hint.usage}\n`;
        }
        out += `  ${pad(colour(ANSI.DIM, labels[1] ?? ""), width)}${hint.help}\n`;
      }
      stream.write(out);
    },
  };
}

/**
 * A UI that draws nothing.
 *
 * This is what a context gets when there is no terminal to draw on and no test asserting on one.
 * It is a value rather than a factory because it holds no state: calls that return. `ended()`
 * answers `false` forever, and must — it drew no block, so nothing it was told has been said.
 */
export const silentUi: TerminalUi = {
  stdoutIsTTY: false,
  ended(): boolean {
    return false;
  },
  header(): void {
    /* nothing to draw */
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
  warn(): void {
    /* nothing to draw */
  },
  end(): void {
    /* nothing to draw */
  },
  summary(): void {
    /* nothing to draw */
  },
  fail(): void {
    /* nothing to draw */
  },
};
