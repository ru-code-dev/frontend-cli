/**
 * ANSI CAPTURE → COLOURED HTML, and the pseudo-terminal that produces the capture.
 *
 * PORTED, DELIBERATELY, FROM THE HOUSE APP. The mechanism is
 * `/mnt/mac/Users/user/WORKSPACE/Projects/experements/t3-ru-code/ru-code/apps/server/src/ru-code/tests/install/galleryHtml.ts`
 * and the port is line-for-line faithful in BEHAVIOUR, not in spelling:
 *
 *   `ansiToHtml`        that file's `:66-140`  — SGR reset/bold/dim (`:105-108`), 3/4-bit fg+bg
 *                       (`:109-113`), 256 and truecolor under `38;5`/`38;2` (`:114-123`), the
 *                       CR collapse that turns a progress-bar redraw into its last frame
 *                       (`:68-73`), and `<span style=…>` emission (`:84-89`).
 *   `BASE16`/`xterm256` that file's `:14-31` and `:33-42` — the xterm cube, the grey ramp and
 *                       the 16 base colours, verbatim numbers.
 *   `spawnPtyCommand`   that file's `:209-232` — an ARBITRARY command under `script -qec`, which
 *                       is what keeps truecolor in the capture: the child sees a terminal, so
 *                       `capabilityOf` (`packages/cli-kit/src/ui.ts:258-285`) turns colour and
 *                       the `\r`-redrawn live line ON.
 *   `buildGalleryPage`  that file's `:234-259` — a dark page of `<pre class="term">` cards with a
 *                       PASS/FAIL badge per card.
 *   `pool`              that file's `:186-203` — bounded-concurrency map.
 *
 * WHAT THIS PORT ADDS, and why each addition is ours rather than theirs:
 *
 *  1. `stripAnsi`/`has`/`hasNot` live here instead of in the test file. In ru-code they sit in
 *     `matrix.gallery.test.ts:41-47`; there is one gallery test there and several here would
 *     otherwise each carry a copy.
 *  2. `cardPage` — a ONE-CARD page at a FIXED width, for the per-card PNG. ru-code screenshots
 *     nothing; brief s1 deliverable 2(d) wants every card as its own image, and cropping one
 *     out of a responsive `auto-fill` grid would make the image width depend on how many cards
 *     happened to be in the run. It also renders a DIFFERENT card: `cardMarkup` has a `review`
 *     variant for the gallery (number + PASS/FAIL + matrix label) and a `readme` variant for the
 *     PNG (a dim `$` prompt and the real command line, and nothing else).
 *  3. `shq` is ours because ru-code imports it from its own harness (`galleryHtml.ts:10`).
 *
 * NO DEPENDENCY beyond node builtins, which is this package's standing rule
 * (`packages/testkit/src/index.ts:8-15`). This file is under `tests/`, so it is not part of the
 * package's `dist` either — see `packages/testkit/tsdown.config.ts`, whose only entry is
 * `src/index.ts`.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

/** An RGB triple, as the xterm palette hands it out. */
type RGB = readonly [number, number, number];

/** The 16 base colours, verbatim from the source file's `:14-31`. */
const BASE16: readonly RGB[] = [
  [0, 0, 0],
  [205, 0, 0],
  [0, 205, 0],
  [205, 205, 0],
  [0, 0, 238],
  [205, 0, 205],
  [0, 205, 205],
  [229, 229, 229],
  [127, 127, 127],
  [255, 85, 85],
  [80, 250, 123],
  [241, 250, 140],
  [92, 92, 255],
  [255, 121, 198],
  [139, 233, 253],
  [255, 255, 255],
];

/** One 6-cube coordinate (0-5) to its 0-255 channel value. */
const cubeStep = (x: number): number => (x === 0 ? 0 : 55 + x * 40);

/** xterm-256 index → RGB: 16 base, a 6×6×6 cube, then a 24-step grey ramp (source `:33-42`). */
function xterm256(n: number): RGB {
  if (n < 16) return BASE16[n] ?? [0, 0, 0];
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return [v, v, v];
  }
  const c = n - 16;
  return [cubeStep(Math.floor(c / 36)), cubeStep(Math.floor((c % 36) / 6)), cubeStep(c % 6)];
}

/** HTML-escape. The captures carry `<`, `>` and `&` (paths, `→`, kit selectors). */
function esc(text: string): string {
  return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

interface SgrState {
  fg: RGB | null;
  bg: RGB | null;
  bold: boolean;
  dim: boolean;
}

function styleOf(state: SgrState): string {
  const css: string[] = [];
  if (state.fg !== null) css.push(`color:rgb(${state.fg.join(",")})`);
  if (state.bg !== null) css.push(`background:rgb(${state.bg.join(",")})`);
  if (state.bold) css.push("font-weight:700");
  if (state.dim) css.push("opacity:.6");
  return css.join(";");
}

/** The ESC byte, spelled as an escape so no source file here carries a control character. */
const ESC = "\u001b";

/**
 * Every CSI sequence, sticky so the scanner can resume at an exact index.
 *
 * Built with `new RegExp` rather than written as a literal for the reason
 * `packages/cli-kit/src/ui.ts:237` builds its own the same way: a literal ESC byte inside a
 * regex is what `no-control-regex` exists to flag, and a lint suppression is a worse answer than
 * not writing the byte.
 */
const CSI = new RegExp(`${ESC}\\[([0-9;?]*)([A-Za-z])`, "y");

/** `script`'s own header/footer lines — never part of what the CLI printed. */
function isScriptChrome(line: string): boolean {
  return line.startsWith("Script started on ") || line.startsWith("Script done on ");
}

/**
 * A raw PTY capture → the TERMINAL'S FINAL STATE as coloured HTML.
 *
 * The CR collapse is the whole reason the output reads like a screen rather than like a log: the
 * UI redraws its live line with `\r\x1b[K` eighty times a second
 * (`packages/cli-kit/src/ui.ts:199,407-421`), so a physical line holds every frame the spinner
 * ever drew. Keeping only what follows the LAST `\r` keeps only what the eye would have seen
 * there when the run ended — which is exactly the "terminal STATE" the matrix asserts on.
 */
export function ansiToHtml(rawIn: string): string {
  const raw = rawIn
    .replace(/\r\n/gu, "\n")
    .split("\n")
    .map((line) => (line.includes("\r") ? line.slice(line.lastIndexOf("\r") + 1) : line))
    .filter((line) => !isScriptChrome(line))
    .join("\n");

  const out: string[] = [];
  const state: SgrState = { fg: null, bg: null, bold: false, dim: false };
  let open = false;
  const close = (): void => {
    if (open) {
      out.push("</span>");
      open = false;
    }
  };
  const openSpan = (): void => {
    close();
    const style = styleOf(state);
    out.push(style === "" ? "<span>" : `<span style="${style}">`);
    open = true;
  };

  let i = 0;
  while (i < raw.length) {
    if (raw[i] === ESC && raw[i + 1] === "[") {
      CSI.lastIndex = i;
      const match = CSI.exec(raw);
      if (match !== null) {
        if (match[2] === "m") {
          const nums = (match[1] ?? "")
            .split(";")
            .filter((part) => part !== "")
            .map(Number);
          const list = nums.length > 0 ? nums : [0];
          for (let j = 0; j < list.length; j += 1) {
            const n = list[j] ?? 0;
            if (n === 0) Object.assign(state, { fg: null, bg: null, bold: false, dim: false });
            else if (n === 1) state.bold = true;
            else if (n === 2) state.dim = true;
            else if (n === 22) state.bold = state.dim = false;
            else if (n >= 30 && n <= 37) state.fg = xterm256(n - 30);
            else if (n >= 90 && n <= 97) state.fg = xterm256(n - 90 + 8);
            else if (n >= 40 && n <= 47) state.bg = xterm256(n - 40);
            else if (n === 39) state.fg = null;
            else if (n === 49) state.bg = null;
            else if (n === 38 || n === 48) {
              const target = n === 38 ? "fg" : "bg";
              if (list[j + 1] === 5) {
                state[target] = xterm256(list[j + 2] ?? 0);
                j += 2;
              } else if (list[j + 1] === 2) {
                state[target] = [list[j + 2] ?? 0, list[j + 3] ?? 0, list[j + 4] ?? 0];
                j += 4;
              }
            }
          }
          openSpan();
        }
        i = CSI.lastIndex;
        continue;
      }
    }
    if (raw[i] === ESC) {
      i += 1;
      continue;
    }
    out.push(esc(raw[i] ?? ""));
    i += 1;
  }
  close();
  return out
    .join("")
    .replace(/^\n+/u, "")
    .replace(/\n+$/u, "");
}

/** Every SGR/CSI escape, for the assertion lane. Same construction reason as {@link CSI}. */
const ANY_CSI = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, "gu");

/**
 * A capture → the plain text the assertions run against — ru-code's `matrix.gallery.test.ts:41`.
 *
 * `\r` becomes `\n` rather than being dropped: a redrawn live line and the summary that follows
 * it share ONE physical line in the capture, and deleting the carriage returns would weld
 * `…100% 26/26 правил` onto `✖ отчёт готов`, hiding the boundary a `toContain` should see.
 */
export function stripAnsi(raw: string): string {
  return raw
    .replace(ANY_CSI, "")
    .split(/\r?\n/u)
    .filter((line) => !isScriptChrome(line))
    .join("\n")
    .replace(/\r/gu, "\n");
}

/**
 * SGR — i.e. COLOUR — as opposed to any other CSI.
 *
 * The distinction is load-bearing and it is `packages/cli-kit/src/ui.ts:277-284`'s own: `NO_COLOR`
 * turns colour off but leaves the terminal a terminal, so a `NO_COLOR=1` run on a pty still emits
 * `\r` and `\x1b[K` to redraw its live line — those are CURSOR CONTROLS, not colour. A matrix row
 * that asserted "no escapes at all" there would be asserting the opposite of the design.
 */
export function hasSgr(text: string): boolean {
  return new RegExp(`${ESC}\\[[0-9;]*m`, "u").test(text);
}

/** `null` when every needle is present, else the first one that is not — ru-code's `:42-45`. */
export function has(clean: string, ...needles: readonly string[]): string | null {
  for (const needle of needles) if (!clean.includes(needle)) return `missing «${needle}»`;
  return null;
}

/** The mirror of {@link has} — ru-code's `:46-47`. */
export function hasNot(clean: string, ...needles: readonly string[]): string | null {
  for (const needle of needles) if (clean.includes(needle)) return `unexpected «${needle}»`;
  return null;
}

/** POSIX single-quoting, so a path or an argument reaches `sh -c` exactly as written. */
export function shq(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

/**
 * THE TERMINAL'S SIZE — ONE pair of numbers for the pty and for the card.
 *
 * {@link spawnPtyCommand} sizes the pseudo-terminal to them and the card's `<pre>` is exactly
 * {@link TERM_COLUMNS} `ch` wide, so the picture wraps where the terminal wrapped. That identity
 * is the whole point of these being single exported constants, and it was arrived at twice:
 *
 *  1. The first cards were a fixed 860 px and CLIPPED what a terminal soft-wraps — `--preport`'s
 *     «дизайн-система не найдена» note is 130 characters with NO newline in the capture, because
 *     a terminal wraps on screen without putting one in the stream. A card narrower than the
 *     terminal is a card that lies about what the user saw. Fixed by tying the two together.
 *  2. At 100 columns the tie was honest but the TERMINAL was too narrow: `--format compact`'s
 *     rows carry `line:col`, a glyph, a severity word, the `actual` value, the rule's label and
 *     a right-flushed rule id (design §2.4), and a note is a whole sentence. Both ran past 100
 *     and soft-wrapped mid-word — a faithful picture of a badly-sized terminal.
 *
 * 140×50 is a normal wide developer terminal, which is the window this output was designed to be
 * read in. Help stays ≤ 100 columns by its own rule (design §2.7) and simply gains margin.
 */
export const TERM_COLUMNS = 140;

/** …and its height. Only tall enough to matter for a pty that scrolls; nothing here depends on
 *  it, because the capture is a stream rather than a screen buffer. */
export const TERM_ROWS = 50;

/**
 * The gallery grid's minimum column, in CSS pixels.
 *
 * Only the grid needs a pixel number; the CARDS size themselves to {@link TERM_COLUMNS}. 140
 * columns of the 12.5 px monospace below measure ~1052 px, plus the `<pre>`'s 32 px of side
 * padding and the panel's border — so 1120 is that with a little air.
 */
export const CARD_WIDTH = 1120;

export interface PtyRun {
  readonly status: number;
  readonly raw: string;
}

/**
 * Run an arbitrary command under a PTY and return its capture — ru-code's `spawnPtyCommand`
 * (`galleryHtml.ts:209-232`), with two additions the matrix needs.
 *
 *  1. `stty cols <columns> rows 50` runs FIRST, inside the pseudo-terminal. `script` sizes its
 *     pty from the parent, and a vitest worker has no terminal to size it from — so without
 *     this the width is whatever the kernel defaults to. It matters because `--format compact`
 *     right-flushes its rule ids to `process.stdout.columns` (`cli/src/main.ts:80-103`,
 *     design §2.4), and node reads that off the pty's winsize, not off `COLUMNS`.
 *  2. `TERM`/`COLORTERM` are set to `xterm-256color`/`truecolor` by default, which is what
 *     `capabilityOf` reads for the truecolor bit (`packages/cli-kit/src/ui.ts:273-276`).
 *
 * NEVER REJECTS: a non-zero exit is the ANSWER for a third of the matrix.
 */
export function spawnPtyCommand(options: {
  readonly workDir: string;
  /**
   * Where the capture is written — OUTSIDE `workDir`, deliberately.
   *
   * ru-code drops `pty.raw` into the sandbox (`galleryHtml.ts:151,215`) because its sandbox is
   * scaffolding either way. Ours is a PROJECT DIRECTORY whose absolute path is printed into the
   * screenshots, and a stray `pty.raw` sitting next to `src/` and `package.json` is exactly the
   * test-harness smell the cards must not have.
   */
  readonly rawFile: string;
  readonly command: string;
  readonly env: Readonly<Record<string, string>>;
  readonly columns: number;
  readonly timeoutMs: number;
}): Promise<PtyRun> {
  const rawFile = options.rawFile;
  const inner =
    `stty cols ${String(options.columns)} rows ${String(TERM_ROWS)}; ` +
    `cd ${shq(options.workDir)} && ${options.command}`;
  return new Promise((resolve) => {
    const child = spawn("script", ["-qec", inner, rawFile], {
      env: {
        PATH: process.env["PATH"] ?? "/usr/bin:/bin",
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        ...options.env,
      },
      timeout: options.timeoutMs,
    });
    child.on("close", (code) => {
      let raw = "";
      try {
        raw = readFileSync(rawFile, "utf8");
      } catch {
        raw = "";
      }
      resolve({ status: code ?? -1, raw });
    });
    child.on("error", () => {
      resolve({ status: -1, raw: "" });
    });
  });
}

/** Bounded-concurrency map — ru-code's `:186-203`, unchanged. */
export async function pool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = Array.from({ length: items.length }) as R[];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * THE PROMPT LINE'S ONE DISPLAY RULE — a design link is SHOWN as `<pixso-link>`.
 *
 * WHAT IT TOUCHES, exactly: the caption in a card's title bar, which is derived from the row's
 * `argv` ({@link Panel.command}). NOTHING ELSE. The capture below it — every byte the CLI wrote
 * to the pseudo-terminal — is rendered verbatim by {@link ansiToHtml} and is never rewritten,
 * masked or post-processed; that is the property that makes these images evidence rather than
 * illustration, and this rule is deliberately on the other side of that line.
 *
 * WHY THE CAPTION NEEDS A RULE AT ALL. The e2e rows drive the REMOTE route, so their argv
 * carries a real design link — a synthetic one pointed at the in-process fake MCP. Printing it
 * onto a README card would publish a `pixso.test` address that is nobody's file and cannot be
 * pasted anywhere, which is the same reason the product's own help page stopped printing a URL
 * (`packages/fg-pixso/src/strings.ts`'s `PIXSO_LINK`). A reader who sees
 * `$ fg --passets <pixso-link>` on the card and `fg --passets <pixso-link>` in
 * `docs/manual/pixso.md` is reading ONE instruction in two places.
 *
 * WHY IT CANNOT QUIETLY EAT A REAL ARGUMENT. It applies per-argument, and only to arguments
 * that ARE design links by the product's own test — the two-scheme prefix check at
 * `packages/fg-pixso/src/routing.ts:49-51`, which is what decides the route the row actually
 * takes. A guid, a path, a flag and a `-o` target all pass through untouched: `11:10` stays
 * `11:10` on the one local-route card, because that card's whole subject is the guid.
 *
 * The predicate and the placeholder are RESTATED here rather than imported. This package takes
 * no dependency edge on `@smart-tools/fg-pixso` (`packages/testkit/package.json` — pixso-core is
 * its only product devDependency), and reaching into that package's `src/` would drag
 * `@smart-tools/fg-cli-kit` in behind it. The restatement is pinned from both ends instead: the
 * matrix asserts that the help page prints this exact token (row 3's `must`), and that no card's
 * prompt line carries a URL.
 */
export const PIXSO_LINK = "<pixso-link>";

/** One argv element as the prompt line shows it. Total, pure, and the identity on everything
 *  that is not a design link. */
export function promptArgument(argument: string): string {
  return argument.startsWith("http://") || argument.startsWith("https://")
    ? PIXSO_LINK
    : argument;
}

/** One card. The gallery renders all of its fields; a PNG renders only {@link Panel.command}. */
export interface Panel {
  /** The number the GALLERY shows and the PNG's filename prefix. Never drawn on the PNG. */
  readonly n: number;
  /** The matrix label — the reviewer's text. Gallery only. */
  readonly label: string;
  /** The verdict badge. Gallery only. */
  readonly ok: boolean;
  /**
   * THE COMMAND LINE, exactly as a user would type it — `fg --preport . --format compact`,
   * with any environment they would set in front of it. This is the ONLY thing a PNG's title
   * bar carries, so it has to be the truth rather than a caption: the matrix derives it from
   * the same `argv` it runs, and the bin name is `fg` because that is what
   * `cli/package.json`'s `bin` maps onto the file the test executes.
   *
   * The single exception is {@link promptArgument}'s documented display rule: an argument that
   * IS a design link is shown as `<pixso-link>`, the same placeholder the product's own help
   * page prints. The capture beneath is untouched either way.
   */
  readonly command: string;
  readonly html: string;
}

/** The palette and type the cards are drawn with — ru-code's `buildGalleryPage` CSS (`:247-257`),
 *  with `monospace` appended to the font stack because a headless Linux Chromium has neither
 *  "SF Mono" nor Menlo nor Consolas and would otherwise fall back to a proportional face. */
/**
 * THE CARD'S TEXT BOX — `TERM_COLUMNS` characters wide, PLUS two pixels.
 *
 * The two pixels are not slop, they are the fix for a measured off-by-one-character. A row of
 * `--format compact` is right-flushed to the terminal width (design §2.4), so it is EXACTLY
 * `TERM_COLUMNS` characters — 140, verified on the capture. A terminal shows 140 of 140 and
 * wraps the 141st; CSS lays out 140 glyph advances that sum, in floating point, to a hair more
 * than `140ch` (`ch` is the advance of `0`, and the sum of 140 of them is not bitwise the same
 * number), so the last character wrapped to a line of its own and every compact card looked
 * broken. Two pixels is about a quarter of a character at 12.5 px: far too little to admit a
 * 141st character, far more than the rounding error. The identity "the card is the terminal"
 * survives; only the arithmetic is made safe.
 */
const TERM_BOX = `calc(${String(TERM_COLUMNS)}ch + 2px)`;

const CARD_CSS =
  `body{margin:0;background:#161b22;color:#c9d1d9;font-family:system-ui,sans-serif}` +
  `h1{padding:16px 20px;margin:0;font-size:15px;color:#8b949e;border-bottom:1px solid #30363d}` +
  `.panel{width:max-content;border:1px solid #30363d;border-radius:8px;overflow:hidden;` +
  `background:#0d1117}` +
  `.tt{padding:8px 12px;font:600 12px system-ui;color:#c9d1d9;background:#161b22;` +
  `border-bottom:1px solid #30363d}` +
  `.tt .n{display:inline-block;min-width:22px;color:#8b949e}` +
  `.tt .ok{color:#3fb950}.tt .bad{color:#f85149}` +
  // THE PROMPT BAR — the whole of a PNG card's chrome. Same mono face and size as the capture
  // below it, so the command and its output read as one terminal session rather than as a
  // caption pasted over a screenshot. `$` is dim; the command is the body colour.
  `.cmd{width:${TERM_BOX};padding:10px 16px;background:#161b22;` +
  `border-bottom:1px solid #30363d;font:12.5px/1.4 "SF Mono",Menlo,Consolas,monospace;` +
  `color:#c9d1d9;white-space:pre-wrap;word-break:break-all}` +
  `.cmd .sh{color:#8b949e;user-select:none}` +
  // …and the capture, EXACTLY as wide as the terminal it came from. `pre-wrap` + `break-all`
  // over a `TERM_COLUMNS`-wide box breaks where the pty broke — at the column, not at a word —
  // which is why a 130-character note renders as the two lines the user actually saw instead of
  // one clipped line. `overflow-x:hidden` then has nothing left to hide.
  `pre.term{width:${TERM_BOX};margin:0;padding:14px 16px;background:#0d1117;` +
  `color:#c9d1d9;font:12.5px/1.4 "SF Mono",Menlo,Consolas,monospace;` +
  `white-space:pre-wrap;word-break:break-all;overflow-x:hidden}`;

/** The prompt bar: a dim `$` and the real command line. Both card variants carry it. */
function promptBar(panel: Panel): string {
  return `<div class="cmd"><span class="sh">$</span> ${esc(panel.command)}</div>`;
}

/**
 * TWO CARD VARIANTS, and the difference is who is looking.
 *
 * `"review"` — `gallery.html`, the REVIEWER'S artifact: the row number, the PASS/FAIL badge and
 * the matrix label, exactly as ru-code's `buildGalleryPage` draws them (`galleryHtml.ts:241-243`),
 * with the command line under them so a reviewer can see what produced the capture.
 *
 * `"readme"` — the per-row PNG, which is a PRODUCT ARTIFACT. A reader of the README has no row
 * numbers, no matrix and no notion of a verdict; what they need is the command and what it
 * printed. So the title bar is the prompt and nothing else.
 */
function cardMarkup(panel: Panel, variant: "review" | "readme"): string {
  const header =
    variant === "readme"
      ? ""
      : `<div class="tt"><span class="n">${String(panel.n).padStart(2, "0")}</span> ` +
        `<span class="${panel.ok ? "ok" : "bad"}">${panel.ok ? "PASS" : "FAIL"}</span> ` +
        `${esc(panel.label)}</div>`;
  return (
    `<section class="panel">${header}${promptBar(panel)}` +
    `<pre class="term">${panel.html}</pre></section>`
  );
}

/** The whole gallery — ru-code's `:234-259`, one dark page of review cards. */
export function buildGalleryPage(panels: readonly Panel[], title: string): string {
  const failures = panels.filter((panel) => !panel.ok).length;
  return (
    `<!doctype html><meta charset="utf-8"><title>${esc(title.toLowerCase())}</title>` +
    `<style>${CARD_CSS}` +
    `.wrap{display:grid;grid-template-columns:repeat(auto-fill,minmax(${String(CARD_WIDTH)}px,1fr));` +
    `gap:16px;padding:16px}</style>` +
    `<h1>${esc(title)} — ${String(panels.length)} combinations, ` +
    `${String(panels.length - failures)} PASS / ${String(failures)} FAIL</h1>` +
    `<div class="wrap">${panels.map((panel) => cardMarkup(panel, "review")).join("")}</div>`
  );
}

/**
 * ONE card, alone, at {@link TERM_COLUMNS} columns — the page each PNG is taken from, in README
 * dress.
 *
 * Deliberately not a crop of the gallery: that page's grid is `auto-fill`, so a card's rendered
 * width there depends on the viewport and on how many cards the run produced, and a screenshot
 * whose size moves with the length of the matrix is not a screenshot anyone can diff. It is also
 * not the same MARKUP — see {@link cardMarkup}'s two variants.
 */
export function cardPage(panel: Panel): string {
  return (
    `<!doctype html><meta charset="utf-8"><title>${esc(panel.command)}</title>` +
    `<style>${CARD_CSS}.wrap{padding:16px;width:max-content}</style>` +
    `<div class="wrap">${cardMarkup(panel, "readme")}</div>`
  );
}
