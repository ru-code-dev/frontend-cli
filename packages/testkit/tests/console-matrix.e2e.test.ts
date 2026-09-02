/**
 * THE CONSOLE MATRIX — every terminal state Frontend Guard can produce, run through the REAL
 * bundle, asserted, and photographed.
 *
 * THE PATTERN IS THE HOUSE'S, and it is one test on purpose:
 * `/mnt/mac/Users/user/WORKSPACE/Projects/experements/t3-ru-code/ru-code/apps/server/src/ru-code/tests/install/matrix.gallery.test.ts`
 * — «ONE test file = the matrix; every case asserts terminal STATE and writes the gallery as a
 * side effect» (`:416-459`: one `it`, `pool`ed spawns at `:432`, per-case `expect` collected into
 * `failures` at `:436-441`, the gallery written unconditionally at `:443-455` so the FAIL badges
 * survive a red run, and a single `expect(failures).toEqual([])` at `:458`). Everything below is
 * that shape with our subject substituted; the ANSI→HTML and PTY mechanism is ported in
 * `./consoleGallery.ts`, which cites the source lines function by function.
 *
 * WHAT THIS LANE PROVES THAT NO OTHER TIER CAN.
 *
 *   1. THE TTY LANE ITSELF. Every existing suite runs the CLI under `execFile`, where neither
 *      stream is a terminal — `cli/tests/bundle.integration.test.ts:147-149` says so outright —
 *      so the spinner, the `\r`-redrawn live line, the bar and every colour in
 *      `packages/cli-kit/src/ui.ts` are, in the default run, code that is never executed against
 *      a real terminal. A pseudo-terminal is the only way to reach it.
 *   2. THE WIDTH. `--format compact` right-flushes its rule ids to `process.stdout.columns`
 *      (`cli/src/main.ts:80-103`, design §2.4), which node reads off the pty's winsize. Under a
 *      pipe that number is `undefined` and the branch is dead.
 *   3. THE TWO LANES SIDE BY SIDE. The same row run with and without a pty is the only direct
 *      evidence that U3's stream discipline holds: `emitPaths` writes the paths to stdout ONLY
 *      when stdout is not a terminal (`packages/cli-kit/src/out.ts:90-93`), and a terminal run
 *      must therefore show them once, in the summary block, on stderr.
 *
 * THE MATRIX DOCUMENT is `WORKFLOW/features/release-1.0/plans/console-matrix.md`. Its row
 * numbers are {@link Row.n} here — the table and this array are the same list, and the numbers
 * are what ties a PNG to the row that explains it.
 *
 * WHAT VARIES BETWEEN RUNS, and therefore what a PNG diff will always show: the elapsed times
 * on the summary headline and on the non-TTY phase rows (`0.1s`, `27.2s` — U10), and the
 * dashboard's `generatedAt` stamp (`packages/fg-analyzer-report/dashboard/src/App.tsx:194`).
 * Nothing else does: the work directories are FIXED paths under the OS temp root rather than
 * `mkdtemp` ones, precisely so that the absolute paths the summary block prints are the same
 * bytes on every run. No header prints a clock — the `· 11:10` in design §2.1's pixso sample is
 * the node guid the user typed, not a time.
 */
import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser } from "@playwright/test";
import { afterAll, expect, it } from "vite-plus/test";

import { startFakeMcp, type FakeMcp } from "../src/fakeMcp.ts";
// The REMOTE route's argument, and it is the fixture's own link rather than a string typed
// here: its `item-id` decodes to the guid the fake MCP's DSL carries as its root
// (`packages/fg-pixso/tests/fixtures/fakeDsl.ts:21-27`), so the engine finds the frame it was
// sent for. A link invented in this file would fetch and then fail `requested-root-absent`.
import { DESIGN_URL } from "../src/fixtures.ts";
import {
  ansiToHtml,
  buildGalleryPage,
  CARD_WIDTH,
  cardPage,
  has,
  hasNot,
  hasSgr,
  type Panel,
  PIXSO_LINK,
  pool,
  promptArgument,
  shq,
  spawnPtyCommand,
  stripAnsi,
  TERM_COLUMNS,
} from "./consoleGallery.ts";

/* ──────────────────────────────────── where everything is ─────────────────────────────────── */

const here = dirname(fileURLToPath(import.meta.url));
/** `packages/testkit/tests` → the repo root. */
const repoRoot = resolve(here, "..", "..", "..");
/** THE REAL SHIPPED ARTIFACT. Never `src/`: the matrix is about what a user runs. */
const bundle = join(repoRoot, "cli", "dist", "fg.mjs");
/** The analyser fixtures, READ-ONLY — they belong to `cli/tests` and are COPIED, never written. */
const fixtures = join(repoRoot, "cli", "tests", "fixtures");
/** The sibling EDS checkout — the same override `cli/tests/parse-ui-kit.integration.test.ts:45-46`
 *  uses, so the two suites cannot disagree about where the kit is. */
const kitRepository = process.env["EDS_REFERENCE"] ?? resolve(repoRoot, "..", "ui-kit-eds-ce");
const kitAvailable = existsSync(kitRepository);

/** Where the PNGs and the gallery land. ONLY png + `gallery.html` ever live here (deliverable 3). */
const shots = join(repoRoot, "docs", "screenshots");

/**
 * THE WORKSPACE — `<tmp>/fg-e2e/`, holding one directory per PROJECT, not one per test row.
 *
 * Two decisions, and both are about what ends up INSIDE the pictures.
 *
 *  1. FIXED paths rather than `mkdtemp` ones. Every summary block prints absolute paths (U6), so
 *     the directory's name is in the image; a random suffix would change every PNG on every run
 *     for no reason anyone could act on.
 *  2. The directory is a PROJECT — `my-app`, `checkout-web`, `admin-panel` — and the row's cwd
 *     IS that project, with the fixture copied into it. So a card reads
 *     `/tmp/fg-e2e/my-app/fg-out/report.html`, which is a path a reader recognises, instead of
 *     `/tmp/fg-e2e-console/13-preport-eds2-tty/…`, which is a path that says "test harness". The
 *     captures themselves are NEVER post-processed: the CLI prints what it truly wrote, and the
 *     only thing arranged is where it was run.
 *
 * Rows that write share a project only when nothing they write can collide; rows that write
 * NOTHING (help, version, every usage error, the compact document) share one freely. The PTY
 * capture is written outside the workspace entirely (`captures`), so no project directory ever
 * holds a `pty.raw` next to its `package.json`.
 */
const workRoot = join(tmpdir(), "fg-e2e");
const captures = join(tmpdir(), "fg-e2e-captures");
/** A kits directory that does not exist: the analyser then measures against the EMBEDDED corpus
 *  rather than against whatever `~/.fg/kits/` the machine happens to hold — the reasoning at
 *  `cli/tests/project-report.integration.test.ts:128-135`. */
const noKits = join(workRoot, ".no-kits");
/** Where row 26's `--pkit` writes its corpus — a real one, so it must not be the above. */
const pkitKits = join(captures, "kits");
/**
 * V6 AUDIT FINDING #3 — row 26's captured command must not leak an author-machine path.
 *
 * A symlink inside the (also-machine-local, but never photographed) workspace, to the real
 * {@link kitRepository} wherever THIS machine keeps it. Row 26's `--source` points here instead
 * of at `kitRepository` directly, so the `file://…` the card shows is always
 * `<tmp>/fg-e2e/ui-kit-eds-ce` — the same on every machine — never the real checkout's path.
 */
const kitWorkspaceLink = join(workRoot, "ui-kit-eds-ce");

/** The ESC byte, spelled as an escape: no source file in this package carries a control char. */
const ESC_BYTE = "\u001b";

/**
 * THE PROJECTS the gallery is a tour of. Each is a directory under {@link workRoot}; `from` is
 * the fixture copied into it, `null` for a project the row starts from nothing in.
 *
 * The names are ordinary front-end project names because that is the point of them. What each
 * one actually IS stays exactly the fixture it copies, and the matrix document states the
 * mapping row by row, so nothing here is fiction — only the folder name is chosen.
 */
const PROJECTS: Readonly<Record<string, string | null>> = {
  "my-app": "eds2-app",
  "checkout-web": "eds2-app",
  storefront: "eds2-app",
  "eds-app": "kit-api",
  "legacy-ui": "plain-css",
  "design-audit": "plain-css",
  widgets: "plain-css",
  "new-project": null,
  "admin-panel": null,
  portal: null,
  "docs-site": null,
  landing: null,
  "pricing-page": null,
  "marketing-site": null,
  "mobile-web": null,
  "promo-site": null,
  "nav-demo": null,
  "brand-site": null,
};

/**
 * The environment a CARD shows in front of the command, as opposed to the environment the test
 * sets to stay hermetic.
 *
 * `NO_COLOR` is a user's switch and belongs on the prompt line. `PATH`, `FG_KITS_DIR`,
 * `PIXSO_REMOTE_MCP_URL`, `PIXSO_REMOTE_MCP_TOKEN` and `PIXSO_LOCAL_MCP_URL` are the
 * substitutions that make the run offline and repeatable, and printing a `127.0.0.1:41234`
 * fake endpoint — or a test token — onto a README card would be showing the harness rather
 * than the product. The one thing a reader DOES need to know about the token is that a link
 * needs one, and that is `docs/manual/pixso.md`'s job, not a caption's.
 */
const SHOWN_ENV = ["NO_COLOR"] as const;

/** The pty's width IS the card's width — one constant, in `./consoleGallery.ts`. */
const COLUMNS = TERM_COLUMNS;
/** One row's wall-clock ceiling. `--pkit` clones and npm-installs; everything else is ~1 s. */
const ROW_TIMEOUT_MS = 300_000;

/* ─────────────────────────────────────── the row shape ────────────────────────────────────── */

type Mode = "tty" | "pipe";
type Outcome = "ok" | "fail" | "usage";

interface Row {
  /** The matrix document's row number, the GALLERY's badge and the PNG's prefix. */
  readonly n: number;
  /** The `<command>` slug in the PNG's name — a command's short alias, or what the row is about. */
  readonly command: string;
  readonly mode: Mode;
  readonly lang: "ru" | "en";
  readonly outcome: Outcome;
  /** The matrix label. GALLERY ONLY — a PNG's title bar carries the command line and nothing else. */
  readonly label: string;
  /** The project directory under {@link workRoot} this row runs in. A key of {@link PROJECTS}. */
  readonly project: keyof typeof PROJECTS;
  /** ARGV, verbatim, and also what the card's prompt line is built from. `./`-relative wherever
   *  the CLI accepts it, because that is what a person types. */
  readonly argv: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Which pixso route this row drives, and therefore which owner-fixed keys {@link baseEnv}
   * points at the in-process fake MCP.
   *
   *  `"remote"`          — `PIXSO_REMOTE_MCP_URL` + `PIXSO_REMOTE_MCP_TOKEN`. THE DEFAULT STORY:
   *                        the argv carries a design link and the run needs a token. Never
   *                        `--endpoint`/`--token` flags, because a visible argv full of harness
   *                        wiring is not the command a user types.
   *  `"remote-no-token"` — the endpoint, and NO token: the refusal row. The endpoint is still
   *                        pointed at the fake ON PURPOSE, so a refusal that leaked into a fetch
   *                        would be a recorded call rather than an invisible connection error —
   *                        the same construction `cli/tests/bundle.integration.test.ts:336-339`
   *                        uses.
   *  `"local"`           — `PIXSO_LOCAL_MCP_URL`, the editor-plugin route, a bare guid, no token.
   */
  readonly mcp?: "remote" | "remote-no-token" | "local";
  readonly exit: number;
  /** Required on the STRIPPED capture (both streams for a pty row, both for a piped one). */
  readonly must: readonly string[];
  /** Forbidden on the same text. */
  readonly mustNot?: readonly string[];
  /** `pipe` rows only — asserted on RAW stdout, which is the whole of U3's data channel. */
  readonly stdoutMust?: readonly string[];
  readonly stdoutMustNot?: readonly string[];
  /**
   * This row's output is NOT drawn by the terminal UI, so a terminal run of it carries no colour.
   *
   * `--help` and `--version` go to STDOUT through `deps.stdout` (`cli/src/main.ts:131-146`) as
   * plain text: `help.ts` renders a page, not a UI block, and `createUi` is not even built on
   * that path (`cli/src/main.ts:172-176`). Without this flag the "a terminal run must show
   * colour" invariant below would be asserting something the design never promised.
   */
  readonly plain?: boolean;
}

/** `<nn>-<command>-<mode>-<lang>-<outcome>.png` — deliverable 2(d)'s naming, exactly. */
function pngName(row: Row): string {
  return `${String(row.n).padStart(2, "0")}-${row.command}-${row.mode}-${row.lang}-${row.outcome}.png`;
}

/** Where the row runs: the project directory, which is also the path its output paths start with. */
function workDirOf(row: Row): string {
  return join(workRoot, row.project);
}

/**
 * THE PROMPT LINE — derived from the same `argv` the row runs, never written out beside it.
 *
 * A caption that can disagree with the command is worse than no caption, so there is no field to
 * disagree with: the card shows `fg` plus this row's argv, and the test executes
 * `node <bundle> <argv>` — the same argv, and `fg` IS that file (`cli/package.json`'s `bin`).
 * Only {@link SHOWN_ENV} rides in front.
 */
function commandLine(row: Row): string {
  const env = SHOWN_ENV.filter((key) => row.env?.[key] !== undefined).map(
    (key) => `${key}=${String(row.env?.[key])}`,
  );
  // `promptArgument` is the ONE display rule — a design link is shown as `<pixso-link>`, the
  // placeholder the product's own help page prints. Everything else, including the guid on the
  // local-route row, is the argv verbatim, and the capture below the caption is never touched.
  return [...env, "fg", ...row.argv.map(promptArgument)].join(" ");
}

/* ────────────────────────────────────────── THE MATRIX ────────────────────────────────────── */

/**
 * Derived from the CODE, not from memory. The command list is `cli/src/registry.ts:50-55`
 * (`pixsoCommands`, then `projectReportCommands`, `initConfigCommands`, `parseUiKitCommands`);
 * the aliases are `packages/fg-pixso/src/commands.ts:297-298,377-400`,
 * `packages/fg-project-report/src/command.ts:489-490`, `.../init-config.ts:127-128` and
 * `.../parse-ui-kit.ts:228-229`; the refusals are `cli/src/messages.ts` and the arms of
 * `cli/src/parse.ts:494-631`.
 *
 * Every row's cwd is its `project`, and every project argument is `.` — the row IS standing in
 * the project it analyses, which is how the tool is actually used and what makes the printed
 * paths readable.
 */
const ROWS: readonly Row[] = [
  /* ── help and version ─────────────────────────────────────────────────────────────────── */
  {
    n: 1,
    command: "help",
    mode: "tty",
    lang: "ru",
    outcome: "ok",
    label: "fg --help — the grouped page (design §2.7)",
    project: "my-app",
    argv: ["--help"],
    plain: true,
    exit: 0,
    // The three group titles, the env block, and the `без -o →` column heading — i.e. the page
    // is the registry's own grouping (`cli/src/help.ts`), not a static blob.
    must: [
      "фронтенд-инструменты в командной строке",
      "Pixso: макет → код",
      "Анализ проекта",
      "Общие опции",
      "без -o →",
      "--psvg",
      "--preport",
      "--iconf",
      "--pkit",
      "PIXSO_REMOTE_MCP_URL",
      "FG_KITS_DIR",
    ],
    mustNot: ["--lint", "--debug"],
  },
  {
    n: 2,
    command: "help",
    mode: "tty",
    lang: "en",
    outcome: "ok",
    label: "fg --lang en --help",
    project: "my-app",
    argv: ["--lang", "en", "--help"],
    plain: true,
    exit: 0,
    must: ["frontend tools on the command line", "Common options", "without -o →", "the version"],
  },
  {
    n: 3,
    command: "help-psvg",
    mode: "tty",
    lang: "ru",
    outcome: "ok",
    label: "fg --help --psvg — one command in detail (design §2.8)",
    project: "my-app",
    argv: ["--help", "--psvg"],
    plain: true,
    exit: 0,
    // The EXAMPLE line, and it is the owner's remote-first law made visible: the link comes
    // first and is spelled with the placeholder, never a URL. This is also what pins
    // `consoleGallery.ts`'s restated `PIXSO_LINK` to the product's own
    // (`packages/fg-pixso/src/strings.ts`).
    must: [
      "fg --psvg <pixso-link|guid>",
      "также:",
      "--get-pixso-svg",
      "Примеры",
      `fg --psvg ${PIXSO_LINK}`,
    ],
    // No URL on a help page — the law, asserted where a reader would meet it.
    mustNot: ["https://", "http://"],
  },
  {
    n: 4,
    command: "help-phtml",
    mode: "tty",
    lang: "ru",
    outcome: "ok",
    label: "fg --help --phtml",
    project: "my-app",
    argv: ["--help", "--phtml"],
    plain: true,
    exit: 0,
    must: ["fg --phtml <pixso-link|guid>", "--get-pixso-html", `fg --phtml ${PIXSO_LINK}`],
    mustNot: ["https://", "http://"],
  },
  {
    n: 5,
    command: "help-pprompt",
    mode: "tty",
    lang: "ru",
    outcome: "ok",
    label: "fg --help --pprompt",
    project: "my-app",
    argv: ["--help", "--pprompt"],
    plain: true,
    exit: 0,
    must: ["fg --pprompt <pixso-link|guid>", "--get-pixso-prompt", `fg --pprompt ${PIXSO_LINK}`],
    mustNot: ["https://", "http://"],
  },
  {
    n: 6,
    command: "help-passets",
    mode: "tty",
    lang: "ru",
    outcome: "ok",
    label: "fg --help --passets",
    project: "my-app",
    argv: ["--help", "--passets"],
    plain: true,
    exit: 0,
    must: ["fg --passets <pixso-link|guid>", "--get-pixso-assets", `fg --passets ${PIXSO_LINK}`],
    mustNot: ["https://", "http://"],
  },
  {
    n: 7,
    command: "help-preport",
    mode: "tty",
    lang: "ru",
    outcome: "ok",
    label: "fg --help --preport",
    project: "my-app",
    argv: ["--help", "--preport"],
    plain: true,
    exit: 0,
    must: ["fg --preport <путь|repo>", "--project-report", "--format", "--ui-kit", "--config"],
  },
  {
    n: 8,
    command: "help-preport",
    mode: "tty",
    lang: "en",
    outcome: "ok",
    label: "fg --lang en --help --preport",
    project: "my-app",
    argv: ["--lang", "en", "--help", "--preport"],
    plain: true,
    exit: 0,
    must: ["fg --preport <path|repo>", "--project-report", "Examples"],
  },
  {
    n: 9,
    command: "help-iconf",
    mode: "tty",
    lang: "ru",
    outcome: "ok",
    label: "fg --help --iconf",
    project: "my-app",
    argv: ["--help", "--iconf"],
    plain: true,
    exit: 0,
    must: ["fg --iconf", "--init-config", "fg.config.json"],
  },
  {
    n: 10,
    command: "help-pkit",
    mode: "tty",
    lang: "ru",
    outcome: "ok",
    label: "fg --help --pkit",
    project: "my-app",
    argv: ["--help", "--pkit"],
    plain: true,
    exit: 0,
    must: ["fg --pkit eds|eds2", "--parse-ui-kit", "--source"],
  },
  {
    n: 11,
    command: "version",
    mode: "tty",
    lang: "ru",
    outcome: "ok",
    label: "fg --version",
    project: "my-app",
    argv: ["--version"],
    plain: true,
    exit: 0,
    must: ["1.0.0"],
  },
  {
    n: 12,
    command: "no-command",
    mode: "tty",
    lang: "ru",
    outcome: "usage",
    label: "fg (no command) — the help IS the answer, with exit 2",
    project: "my-app",
    argv: [],
    plain: true,
    exit: 2,
    must: ["фронтенд-инструменты в командной строке", "Использование"],
  },

  /* ── --preport ────────────────────────────────────────────────────────────────────────── */
  {
    n: 13,
    command: "preport-eds2",
    mode: "tty",
    lang: "ru",
    outcome: "fail",
    label: "fg --preport . in an EDS 2.x app — html by default, exit 1 on visible errors (U2)",
    project: "my-app",
    argv: ["--preport", "."],
    exit: 1,
    must: [
      "fg v1.0.0 · preport",
      "дизайн-система: eds2 2.0.0 (встроенная)",
      "✖ отчёт готов, есть ошибки",
      "находок",
      "html",
      "my-app/fg-out/report.html",
    ],
    mustNot: ["✓", "╔"],
  },
  {
    n: 14,
    command: "preport-eds1",
    mode: "tty",
    lang: "ru",
    outcome: "fail",
    label: "fg --preport . in an EDS 1.x app — the other autodetect branch",
    project: "eds-app",
    argv: ["--preport", "."],
    exit: 1,
    must: [
      "дизайн-система: eds 1.13.0 (встроенная)",
      "✖ отчёт готов, есть ошибки",
      "4 просмотрено",
    ],
  },
  {
    n: 15,
    command: "preport-formats",
    mode: "tty",
    lang: "ru",
    outcome: "fail",
    label: "three formats at once — `-o` becomes a DIRECTORY (U9)",
    project: "checkout-web",
    argv: ["--preport", ".", "--format", "html,sarif,json", "-o", "./report"],
    exit: 1,
    must: [
      "report/report.html",
      "report/report.sarif",
      "report/report.json",
      "✖ отчёт готов, есть ошибки",
    ],
  },
  {
    n: 16,
    command: "preport-compact",
    mode: "tty",
    lang: "ru",
    outcome: "fail",
    label: "--format compact — the document, and NO summary block (§2.3)",
    project: "legacy-ui",
    argv: ["--preport", ".", "--format", "compact"],
    exit: 1,
    must: [
      "src/App.tsx",
      "✖ error",
      "▲ warning",
      "a11y.name.missing",
      "✖ 6 проблем",
      "5 ошибок",
    ],
    // A compact-only run's footer IS its summary — the block must not also be drawn.
    mustNot: ["отчёт готов", "файлов      "],
  },
  {
    n: 17,
    command: "preport-compact",
    mode: "tty",
    lang: "en",
    outcome: "fail",
    label: "--format compact, in English",
    project: "legacy-ui",
    argv: ["--lang", "en", "--preport", ".", "--format", "compact"],
    exit: 1,
    must: ["src/App.tsx", "✖ error", "▲ warning", "✖ 6 problems", "5 errors"],
  },
  {
    n: 18,
    command: "preport-config",
    mode: "tty",
    lang: "ru",
    outcome: "ok",
    label: "the project's own fg.config.json demotes everything — exit 0 (U2)",
    project: "design-audit",
    argv: ["--preport", "."],
    exit: 0,
    must: ["✔ отчёт готов", "скрыто", "конфиг:", "fg.config.json", "находок     0"],
    mustNot: ["✖"],
  },
  {
    n: 19,
    command: "preport-uikit-none",
    mode: "tty",
    lang: "ru",
    outcome: "fail",
    label: "--ui-kit none — general rules only",
    project: "widgets",
    argv: ["--preport", ".", "--ui-kit", "none"],
    exit: 1,
    must: ["✖ отчёт готов, есть ошибки", "11 правил"],
    mustNot: ["eds 1.13.0", "eds2 2.0.0"],
  },
  {
    n: 20,
    command: "preport-nocolor",
    mode: "tty",
    lang: "ru",
    outcome: "fail",
    label: "NO_COLOR=1 — same text, zero colour, terminal still a terminal (U7)",
    project: "legacy-ui",
    argv: ["--preport", ".", "--format", "compact"],
    env: { NO_COLOR: "1" },
    exit: 1,
    must: ["src/App.tsx", "✖ error", "✖ 6 проблем"],
  },
  {
    n: 21,
    command: "preport-format",
    mode: "tty",
    lang: "ru",
    outcome: "usage",
    label: "an unknown --format is refused before anything runs",
    project: "my-app",
    argv: ["--preport", ".", "--format", "htlm"],
    exit: 2,
    must: [
      "✖ неизвестный формат: htlm",
      "html, compact, json, sarif",
      "использование:",
      "fg --preport <путь|repo>",
      "подробнее:",
      "fg --help --preport",
    ],
    // §2.6: no header before a usage error — the run never started.
    mustNot: ["fg v1.0.0 ·"],
  },
  {
    n: 22,
    command: "preport-source",
    mode: "tty",
    lang: "ru",
    outcome: "usage",
    label: "fg --preport with no project",
    project: "my-app",
    argv: ["--preport"],
    exit: 2,
    must: ["✖ не указан проект", "использование:", "fg --preport <путь|repo>", "fg --help --preport"],
  },
  {
    n: 23,
    command: "preport-source",
    mode: "tty",
    lang: "en",
    outcome: "usage",
    label: "…in English",
    project: "my-app",
    argv: ["--lang", "en", "--preport"],
    exit: 2,
    must: ["✖ no project given", "usage:", "fg --preport <path|repo>", "more:"],
  },

  /* ── --iconf ──────────────────────────────────────────────────────────────────────────── */
  {
    n: 24,
    command: "iconf",
    mode: "tty",
    lang: "ru",
    outcome: "ok",
    label: "fg --iconf in a project with no design system in its dependencies",
    project: "new-project",
    argv: ["--iconf"],
    exit: 0,
    must: [
      "fg v1.0.0 · iconf",
      "! дизайн-система не определена",
      "✔ конфигурация создана",
      "fg.config.json",
      "fg.config.schema.json",
    ],
  },
  {
    n: 25,
    command: "iconf",
    mode: "tty",
    lang: "en",
    outcome: "ok",
    label: "fg --iconf --ui-kit eds — the kit named explicitly",
    project: "admin-panel",
    argv: ["--lang", "en", "--iconf", "--ui-kit", "eds"],
    exit: 0,
    must: ["fg v1.0.0 · iconf · eds 1.13.0", "✔ configuration written", "32 rules"],
  },

  /* ── --pkit ───────────────────────────────────────────────────────────────────────────── */
  {
    n: 26,
    command: "pkit",
    mode: "tty",
    lang: "ru",
    outcome: "ok",
    label: "fg --pkit eds --source file://… — the corpus, rebuilt from the kit's own sources",
    project: "my-app",
    argv: ["--pkit", "eds", "--source", `file://${kitWorkspaceLink}`],
    env: { FG_KITS_DIR: pkitKits },
    exit: 0,
    must: [
      "fg v1.0.0 · pkit · eds",
      "✔ корпус собран, файлов: 5",
      "tokens",
      "components",
      "kit-a11y",
      "kit-icons",
      "kit-signatures",
    ],
  },

  /* ── pixso, against the testkit's fake MCP ────────────────────────────────────────────── */
  /*
   * THE REMOTE ROUTE IS THE STORY, and these rows run it: a design link in the argv, a token in
   * the environment, `PIXSO_REMOTE_MCP_URL` pointed at the in-process fake. That is the product
   * a user is sold — a link from «Поделиться → Копировать ссылку» plus a token works from any
   * machine — and it is what `README.md` and `docs/manual/pixso.md` photograph.
   *
   * The endpoint and the token arrive as ENVIRONMENT, never as `--endpoint`/`--token` flags,
   * for the same reason `FG_KITS_DIR` does: the argv is the caption on a README card, and a
   * caption carrying the harness's own wiring is a caption of a command nobody types. The
   * card's prompt line then shows the link itself as `<pixso-link>` — `promptArgument`'s one
   * documented display rule — while the capture underneath is the run, untouched.
   *
   * ONE local-route row survives, last (row 34). It is a real mode and it is the only card in
   * the gallery that shows a bare guid; no document references its PNG.
   */
  {
    n: 27,
    command: "psvg",
    mode: "tty",
    lang: "ru",
    outcome: "ok",
    label: "fg --psvg <pixso-link> — the remote route, one file",
    project: "landing",
    argv: ["--psvg", DESIGN_URL],
    mcp: "remote",
    exit: 0,
    // `item 11-10` is the link's `item-id`, sanitized — the same name the file gets, which is
    // the point of `designName` being one function (`packages/fg-pixso/src/out.ts:97-99`).
    must: [
      "fg v1.0.0 · psvg · удалённый маршрут · item 11-10",
      "✔ готово",
      "fg-out/pixso/11-10.svg",
    ],
  },
  {
    n: 28,
    command: "phtml",
    mode: "tty",
    lang: "ru",
    outcome: "ok",
    label: "fg --phtml <pixso-link>",
    project: "pricing-page",
    argv: ["--phtml", DESIGN_URL],
    mcp: "remote",
    exit: 0,
    must: [
      "fg v1.0.0 · phtml · удалённый маршрут · item 11-10",
      "✔ готово",
      "fg-out/pixso/11-10.html",
    ],
  },
  {
    n: 29,
    command: "pprompt",
    mode: "tty",
    lang: "ru",
    outcome: "ok",
    label: "fg --pprompt <pixso-link>",
    project: "marketing-site",
    argv: ["--pprompt", DESIGN_URL],
    mcp: "remote",
    exit: 0,
    must: [
      "fg v1.0.0 · pprompt · удалённый маршрут · item 11-10",
      "✔ готово",
      "fg-out/pixso/11-10.md",
    ],
  },
  {
    n: 30,
    command: "passets",
    mode: "tty",
    lang: "ru",
    outcome: "ok",
    label: "fg --passets <pixso-link> — four files, and the one counted progress phase",
    project: "mobile-web",
    argv: ["--passets", DESIGN_URL],
    mcp: "remote",
    exit: 0,
    // THE CARD THE README SHOWS. Its path rows are the documented default for a link:
    // `fg-out/pixso/<item-id>/card.*`.
    must: [
      "fg v1.0.0 · passets · удалённый маршрут · item 11-10",
      "✔ готово",
      "fg-out/pixso/11-10/card.svg",
      "11-10/card.html",
      "11-10/card.md",
      "11-10/card.json",
    ],
  },
  {
    n: 31,
    command: "passets",
    mode: "tty",
    lang: "en",
    outcome: "ok",
    label: "fg --passets <pixso-link> -o ./card — `-o` as a directory, in English",
    project: "promo-site",
    argv: ["--lang", "en", "--passets", DESIGN_URL, "-o", "./card"],
    mcp: "remote",
    exit: 0,
    must: ["fg v1.0.0 · passets · remote route · item 11-10", "✔ done", "card/card.svg"],
  },
  {
    n: 32,
    command: "psvg",
    mode: "tty",
    lang: "ru",
    outcome: "usage",
    label: "fg --psvg with no source",
    project: "my-app",
    argv: ["--psvg"],
    mcp: "remote",
    exit: 2,
    must: ["✖ не указан источник", "использование:", "fg --psvg <pixso-link|guid>", "fg --help --psvg"],
  },
  {
    /**
     * A LINK WITH NO TOKEN — the one refusal the remote route owns, and the first wall a new
     * user walks into. Exit 2, and the message names all three ways to supply a token, which is
     * what makes it actionable.
     *
     * The endpoint IS pointed at the fake, with only the token missing — the construction
     * `cli/tests/bundle.integration.test.ts:336-339` uses. That is what stops this row passing
     * for the wrong reason: against a dead endpoint, exit 2 could be a connection failure
     * wearing the refusal's clothes. That NOTHING is dialled is tier 2's assertion, measured on
     * the fake's own call log (`:349-351`); what this row photographs is the refusal.
     */
    n: 33,
    command: "psvg-token",
    mode: "tty",
    lang: "ru",
    outcome: "usage",
    label: "a design link with no token — exit 2, and all three fixes are named",
    project: "my-app",
    argv: ["--psvg", DESIGN_URL],
    mcp: "remote-no-token",
    exit: 2,
    must: [
      "✖ для ссылки на кадр",
      "--token",
      "PIXSO_REMOTE_MCP_TOKEN",
      ".env",
      "использование:",
      "fg --psvg <pixso-link|guid>",
    ],
    // §2.6 again: the run never started, so it carries no header.
    mustNot: ["fg v1.0.0 ·"],
  },
  {
    /**
     * THE LOCAL ROUTE, kept because it is a real mode — the Pixso editor open on this machine,
     * its plugin serving the MCP, and a bare node guid as the argument. It is the LAST pixso
     * row and the only card in the gallery that shows a guid; `docs/manual/pixso.md`'s
     * «Локальный маршрут» section is the one place in the documentation that mentions it, and
     * no document references this PNG.
     */
    n: 34,
    command: "psvg-local",
    mode: "tty",
    lang: "ru",
    outcome: "ok",
    label: "fg --psvg 11:10 — the local route, the advanced case",
    project: "brand-site",
    argv: ["--psvg", "11:10"],
    mcp: "local",
    exit: 0,
    must: ["fg v1.0.0 · psvg · локальный маршрут · 11:10", "✔ готово", "fg-out/pixso/11-10.svg"],
  },

  /* ── the refusals the CLI owns ────────────────────────────────────────────────────────── */
  {
    n: 35,
    command: "unknown-flag",
    mode: "tty",
    lang: "ru",
    outcome: "usage",
    label: "an undeclared flag — exit 2, localized, no header",
    project: "my-app",
    argv: ["--nope"],
    exit: 2,
    must: ["✖ неизвестный флаг: --nope", "fg <команда> <аргумент> [опции]", "fg --help"],
    mustNot: ["fg v1.0.0 ·"],
  },
  {
    n: 36,
    command: "unknown-flag",
    mode: "tty",
    lang: "en",
    outcome: "usage",
    label: "…answered in English although parseArgs threw before --lang was parsed",
    project: "my-app",
    argv: ["--lang", "en", "--nope"],
    exit: 2,
    must: ["✖ unknown flag: --nope", "fg <command> <argument> [options]"],
  },
  {
    n: 37,
    command: "flag-not-for-command",
    mode: "tty",
    lang: "ru",
    outcome: "usage",
    label: "a known flag aimed at a command that does not take it (V3 MAJOR-1)",
    project: "my-app",
    argv: ["--psvg", DESIGN_URL, "--config", "./fg.config.json"],
    exit: 2,
    must: ["✖ флаг --config не поддерживается командой --psvg.", "fg --psvg <pixso-link|guid>"],
  },
  {
    n: 38,
    command: "two-commands",
    mode: "tty",
    lang: "ru",
    outcome: "usage",
    label: "exactly one command per invocation",
    project: "my-app",
    argv: ["--psvg", DESIGN_URL, "--phtml", DESIGN_URL],
    exit: 2,
    must: ["✖ за один запуск можно указать ровно одну команду."],
  },
  {
    n: 39,
    command: "bad-lang",
    mode: "tty",
    lang: "ru",
    outcome: "usage",
    label: "the language is validated before --version is honoured",
    project: "my-app",
    argv: ["--lang", "de", "--version"],
    exit: 2,
    must: ["✖ неизвестный язык: de. Допустимые значения: ru, en."],
  },

  /* ── THE PIPE LANE — U3's stream discipline, which a terminal cannot show ─────────────── */
  {
    n: 40,
    command: "preport-eds2",
    mode: "pipe",
    lang: "ru",
    outcome: "fail",
    label: "piped — phase ledger on stderr, the report path alone on stdout",
    project: "storefront",
    argv: ["--preport", "."],
    exit: 1,
    must: ["fg v1.0.0 · preport", "подготовка проекта", "чтение файлов", "✖ отчёт готов, есть ошибки"],
    stdoutMust: ["fg-out/report.html"],
    stdoutMustNot: ["отчёт готов", "fg v1.0.0", "файлов"],
  },
  {
    n: 41,
    command: "preport-compact",
    mode: "pipe",
    lang: "ru",
    outcome: "fail",
    label: "piped compact — the document is the data",
    project: "legacy-ui",
    argv: ["--preport", ".", "--format", "compact"],
    exit: 1,
    must: ["fg v1.0.0 · preport", "чтение файлов"],
    stdoutMust: ["src/App.tsx", "a11y.name.missing", "✖ 6 проблем"],
    stdoutMustNot: ["fg v1.0.0", "отчёт готов"],
  },
  {
    n: 42,
    command: "iconf",
    mode: "pipe",
    lang: "ru",
    outcome: "ok",
    label: "piped — two absolute paths on stdout, one per line",
    project: "portal",
    argv: ["--iconf"],
    exit: 0,
    must: ["✔ конфигурация создана"],
    stdoutMust: ["fg.config.json", "fg.config.schema.json"],
    stdoutMustNot: ["конфигурация создана"],
  },
  {
    n: 43,
    command: "psvg",
    mode: "pipe",
    lang: "ru",
    outcome: "ok",
    label: "piped, remote route — one path on stdout, the card the human sees on stderr",
    project: "nav-demo",
    argv: ["--psvg", DESIGN_URL],
    mcp: "remote",
    exit: 0,
    must: ["fg v1.0.0 · psvg · удалённый маршрут · item 11-10", "✔ готово"],
    stdoutMust: ["fg-out/pixso/11-10.svg"],
    stdoutMustNot: ["готово"],
  },
  {
    n: 44,
    command: "unknown-flag",
    mode: "pipe",
    lang: "ru",
    outcome: "usage",
    label: "piped — a refusal is never data",
    project: "my-app",
    argv: ["--nope"],
    exit: 2,
    must: ["✖ неизвестный флаг: --nope"],
    stdoutMustNot: ["неизвестный флаг", "fg"],
  },
  {
    /**
     * THE ROW THAT PINS THE `phaseRow` FIX, and the reason it exists.
     *
     * The plain lane's phase row used to pad the label to a fixed 23 columns with no minimum gap
     * (`packages/cli-kit/src/ui.ts:215,339-344` before this delivery), so the only label in the
     * product wider than that — `--iconf`'s English «selecting the design system», 27 characters
     * (`packages/fg-project-report/src/strings.ts:951`) — printed with its elapsed welded on:
     * `  selecting the design system0.0s`. Nothing in the matrix could see it, because no row was
     * both `pipe` (the only lane that draws phase rows) and `en`. This row is that combination,
     * and its `mustNot` is the defect itself.
     */
    n: 45,
    command: "iconf",
    mode: "pipe",
    lang: "en",
    outcome: "ok",
    label: "piped, in English — the 27-character phase label keeps its gap (cli-kit fix)",
    project: "docs-site",
    argv: ["--lang", "en", "--iconf", "--ui-kit", "eds"],
    exit: 0,
    must: ["fg v1.0.0 · iconf · eds 1.13.0", "  selecting the design system  ", "✔ configuration written"],
    mustNot: ["selecting the design system0", "selecting the design system1"],
    stdoutMust: ["fg.config.json", "fg.config.schema.json"],
    stdoutMustNot: ["configuration written"],
  },
];

/* ──────────────────────────────────────── running a row ───────────────────────────────────── */

interface RunResult {
  readonly status: number;
  /** What the card is built from: the pty capture, or stderr-then-stdout for a piped row. */
  readonly raw: string;
  readonly stdout: string;
}

/** The token the remote rows send. Any value does: the fake records the `Token` header and
 *  answers regardless (`packages/testkit/src/fakeMcp.ts`), because what these rows are about is
 *  the ROUTE, not the credential. It never reaches a card — see {@link SHOWN_ENV}. */
const FAKE_TOKEN = "fg-e2e-token";

function baseEnv(row: Row, mcpUrl: string): Record<string, string> {
  return {
    PATH: process.env["PATH"] ?? "",
    FG_KITS_DIR: noKits,
    ...mcpEnv(row.mcp, mcpUrl),
    // No `?? {}`: spreading `undefined` adds nothing, which is what `unicorn/no-useless-
    // fallback-in-spread` is about — and the gate counts warnings.
    ...row.env,
  };
}

/** The owner-fixed keys, by route. Their names are the product's
 *  (`packages/fg-pixso/src/runtime.ts:187-191`) and are never spelled anywhere else here. */
function mcpEnv(mode: Row["mcp"], mcpUrl: string): Record<string, string> {
  switch (mode) {
    case "remote":
      return { PIXSO_REMOTE_MCP_URL: mcpUrl, PIXSO_REMOTE_MCP_TOKEN: FAKE_TOKEN };
    case "remote-no-token":
      return { PIXSO_REMOTE_MCP_URL: mcpUrl };
    case "local":
      return { PIXSO_LOCAL_MCP_URL: mcpUrl };
    case undefined:
      return {};
  }
}

/** The piped lane: no terminal on either stream, and the two kept apart. */
function runPiped(row: Row, dir: string, env: Record<string, string>): Promise<RunResult> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [bundle, ...row.argv], {
      cwd: dir,
      env,
      timeout: ROW_TIMEOUT_MS,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      done({ status: code ?? -1, raw: stderr + stdout, stdout });
    });
    child.on("error", () => {
      done({ status: -1, raw: "", stdout: "" });
    });
  });
}

/**
 * BUILD THE WORKSPACE — every project directory, once, before any row runs.
 *
 * Up front rather than per row for two reasons. Rows SHARE a project when none of them writes
 * anything that can collide, and two rows racing to `rmSync` + copy the same directory would be
 * a bug in the harness rather than in the product. And a project has to look like a project
 * before it is photographed: the fixture is copied whole, so `package.json`, `tsconfig.json` and
 * `src/` are all where a reader expects them.
 */
function buildWorkspace(): void {
  rmSync(workRoot, { recursive: true, force: true });
  rmSync(captures, { recursive: true, force: true });
  mkdirSync(captures, { recursive: true });
  for (const [project, fixture] of Object.entries(PROJECTS)) {
    const dir = join(workRoot, project);
    if (fixture === null) mkdirSync(dir, { recursive: true });
    else cpSync(join(fixtures, fixture), dir, { recursive: true });
  }
  // Row 18's project ships the config that demotes everything — a real project's own file at its
  // own root, which is the first place `--preport` looks (design U-config, `--config` is the
  // override rather than the source).
  writeFileSync(
    join(workRoot, "design-audit", "fg.config.json"),
    `${JSON.stringify({ analyzer: { default: "off" } }, null, 2)}\n`,
    "utf8",
  );
  // Row 26's `file://` points HERE, not at `kitRepository` — see {@link kitWorkspaceLink}.
  symlinkSync(kitRepository, kitWorkspaceLink, "dir");
}

async function runRow(row: Row, mcpUrl: string): Promise<RunResult> {
  const dir = workDirOf(row);
  const env = baseEnv(row, mcpUrl);
  if (row.mode === "pipe") return runPiped(row, dir, env);
  const command = [process.execPath, bundle, ...row.argv].map((part) => shq(part)).join(" ");
  const run = await spawnPtyCommand({
    workDir: dir,
    // OUTSIDE the project: see `spawnPtyCommand`'s `rawFile`. A `pty.raw` sitting next to
    // `package.json` would be visible to `--preport`'s own file walk, never mind to a reader.
    rawFile: join(captures, `${String(row.n).padStart(2, "0")}.raw`),
    command,
    env,
    columns: COLUMNS,
    timeoutMs: ROW_TIMEOUT_MS,
  });
  return { status: run.status, raw: run.raw, stdout: "" };
}

/** Every assertion for one row, as one reason string or `null` — ru-code's `Case.expect` shape. */
function verdictOf(row: Row, result: RunResult): string | null {
  if (result.status !== row.exit) return `exit ${String(result.status)}, expected ${String(row.exit)}`;
  const clean = stripAnsi(result.raw);
  const missing = has(clean, ...row.must);
  if (missing !== null) return missing;
  const unexpected = row.mustNot === undefined ? null : hasNot(clean, ...row.mustNot);
  if (unexpected !== null) return unexpected;
  if (row.mode === "pipe") {
    // U3, measured rather than believed: stdout is DATA. No escapes, no live line, and only
    // what `emitPaths`/the compact document put there.
    if (result.stdout.includes(ESC_BYTE)) return "stdout carries an escape sequence";
    if (result.stdout.includes("\r")) return "stdout carries a carriage return";
    const dataMissing = row.stdoutMust === undefined ? null : has(result.stdout, ...row.stdoutMust);
    if (dataMissing !== null) return `stdout: ${dataMissing}`;
    const dataExtra =
      row.stdoutMustNot === undefined ? null : hasNot(result.stdout, ...row.stdoutMustNot);
    if (dataExtra !== null) return `stdout: ${dataExtra}`;
  } else if (row.env?.["NO_COLOR"] !== undefined) {
    // U7's off switch, ON A REAL TERMINAL, and the exact shape `packages/cli-kit/src/ui.ts:277-284`
    // fixes: colour off, TERMINAL STILL ON. So the assertion is two-sided — not one SGR sequence,
    // and the `\r`-redrawn live line still there. An "escapes at all" check would fail the design.
    if (hasSgr(result.raw)) return "NO_COLOR run still emitted an SGR colour sequence";
    if (!result.raw.includes("\r")) return "NO_COLOR run lost the terminal's redraw lane";
  } else if (row.plain === true) {
    // `--help`/`--version`: plain text on stdout, colour would be the defect.
    if (hasSgr(result.raw)) return "a help/version page emitted colour";
  } else if (!hasSgr(result.raw)) {
    // …and the converse, which is the whole reason this lane needs a pty: a UI-drawn run with no
    // colour in it would mean the TTY branch of `capabilityOf` never ran.
    return "a terminal run produced no colour";
  }
  return null;
}

/**
 * THE PROMPT LINE'S OWN VERDICT — the display rule, measured on the caption that was built.
 *
 * Two halves, and they are each other's guard. No card may show a URL: the remote rows carry a
 * real link in their argv and a README card printing `https://pixso.test/…` would be publishing
 * an address that is nobody's file. And a row that DOES pass a link must show the placeholder,
 * so the rule cannot silently stop firing and leave the caption showing a bare flag.
 *
 * Kept apart from {@link verdictOf}, which is about the RUN. This is about the picture's one
 * piece of chrome; the capture it sits above is never inspected here and never rewritten.
 */
function captionVerdictOf(row: Row, command: string): string | null {
  if (/https?:\/\//u.test(command)) return `the prompt line shows a URL: ${command}`;
  const passesLink = row.argv.some(
    (argument) => argument.startsWith("http://") || argument.startsWith("https://"),
  );
  if (passesLink && !command.includes(PIXSO_LINK)) {
    return `a design-link row's prompt line does not show ${PIXSO_LINK}: ${command}`;
  }
  return null;
}

/* ────────────────────────────────────────── the one test ──────────────────────────────────── */

let fake: FakeMcp | null = null;
let browser: Browser | null = null;

afterAll(async () => {
  await fake?.close();
  fake = null;
  await browser?.close();
  browser = null;
});

it("the console matrix: every row asserted, the gallery and every screenshot written", async () => {
  expect(
    existsSync(bundle),
    `${bundle} is missing — run \`pnpm --filter @smart-tools/frontend-guard build\` first`,
  ).toBe(true);
  expect(
    kitAvailable,
    `the EDS checkout was not found at ${kitRepository}; set EDS_REFERENCE to a clone of ui-kit-eds-ce`,
  ).toBe(true);

  buildWorkspace();
  mkdirSync(pkitKits, { recursive: true });

  fake = await startFakeMcp();
  const mcpUrl = fake.url;

  // Bounded concurrency, ru-code's `pool` (`galleryHtml.ts:186-203`). Eight: a PTY spawn is
  // cheap, but `--preport` loads ts-morph and eight of those at once is already the box's limit.
  const results = await pool(ROWS, 8, (row) => runRow(row, mcpUrl));

  const panels: Panel[] = [];
  const failures: string[] = [];
  ROWS.forEach((row, index) => {
    const result = results[index] as RunResult;
    // The prompt line every card carries, and the ONLY chrome on the PNG. Derived from the
    // same `argv` that just ran, so it cannot be a caption that lies.
    const command = commandLine(row);
    const reason = verdictOf(row, result) ?? captionVerdictOf(row, command);
    if (reason !== null) failures.push(`${String(row.n)} ${row.label} → ${reason}`);
    panels.push({
      n: row.n,
      label: `${row.mode} · ${row.lang} · ${row.outcome} — ${row.label}`,
      ok: reason === null,
      command,
      html: ansiToHtml(result.raw),
    });
  });

  // ALWAYS written, even on a red run — the FAIL badges are how a reader sees which rows broke
  // (ru-code's `matrix.gallery.test.ts:443-455`).
  rmSync(shots, { recursive: true, force: true });
  mkdirSync(shots, { recursive: true });
  writeFileSync(
    join(shots, "gallery.html"),
    buildGalleryPage(panels, "Frontend Guard — console matrix"),
    "utf8",
  );

  browser = await chromium.launch();
  try {
    const cards = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: { width: CARD_WIDTH + 32, height: 900 },
    });
    const cardShot = await cards.newPage();
    cardShot.setDefaultTimeout(30_000);
    for (const [index, panel] of panels.entries()) {
      await cardShot.setContent(cardPage(panel), { waitUntil: "load" });
      await cardShot
        .locator("section.panel")
        .screenshot({ path: join(shots, pngName(ROWS[index] as Row)) });
    }
    await cards.close();

    // The dashboard, from the richest run: row 15 is `--format html,sarif,json` over the eds2
    // consumer — 65 findings across 14 files — written into that project's own `./report`.
    const richest = ROWS.find((row) => row.n === 15) as Row;
    const reportHtml = join(workDirOf(richest), "report", "report.html");
    if (existsSync(reportHtml)) {
      const dash = await browser.newContext({
        deviceScaleFactor: 2,
        viewport: { width: 1440, height: 900 },
      });
      const page = await dash.newPage();
      page.setDefaultTimeout(30_000);
      await page.goto(`file://${reportHtml}`, { waitUntil: "load" });
      // The sidebar's own title — the SPA has mounted and read its inlined `ds-data` payload
      // (`packages/fg-analyzer-report/dashboard/src/App.tsx:189`).
      await page.getByText("Аудит дизайн-системы").first().waitFor();
      // …and the charts have finished drawing. Recharts animates a pie in over 1500 ms by
      // default (`packages/fg-analyzer-report/dashboard/src/components/charts.tsx:18` — "Recharts
      // for everything"), and the «По серьёзности» donut sits inside the 900 px viewport, so a
      // shot taken on mount catches an empty ring. A fixed wait is the honest instrument for a
      // fixed-duration animation: there is no state to poll, only time to pass.
      await page.locator(".recharts-surface").first().waitFor();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: join(shots, "dashboard-hero.png") });

      // «План работ» is the findings panel — the nav entry at `App.tsx:171`, whose screen lists
      // one `<article>` per decision (`components/ProblemCard.tsx:98`, rendered at
      // `screens/Problems.tsx:274`). The top card is EXPANDED before the shot because a
      // collapsed list shows no findings: the `<details>` file groups only exist inside an open
      // card (`ProblemCard.tsx:29`, reached through the `<header onClick={onToggle}>` at `:104`).
      await page.getByRole("button", { name: /План работ/u }).click();
      const firstProblem = page.locator("main article").first();
      await firstProblem.waitFor();
      await firstProblem.scrollIntoViewIfNeeded();
      await firstProblem.locator("header").first().click();
      await page.locator("main article details").first().waitFor();
      await page.screenshot({ path: join(shots, "dashboard-findings.png") });
      await dash.close();
    } else {
      failures.push(`15 the richest --preport run wrote no ${reportHtml} — no dashboard captures`);
    }
  } finally {
    await browser.close();
    browser = null;
  }

  // Deliverable 3: this directory holds PNGs and the one gallery page, and nothing else.
  const written = readdirSync(shots).toSorted();
  const strays = written.filter((name) => !name.endsWith(".png") && name !== "gallery.html");
  expect(strays, `docs/screenshots holds files that are neither png nor gallery.html`).toEqual([]);
  expect(written).toContain("dashboard-hero.png");
  expect(written).toContain("dashboard-findings.png");
  for (const row of ROWS) expect(written).toContain(pngName(row));
  const totalBytes = written.reduce((sum, name) => sum + statSync(join(shots, name)).size, 0);
  expect(totalBytes, `docs/screenshots is ${String(totalBytes)} bytes`).toBeLessThan(
    15 * 1024 * 1024,
  );

  expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
});
