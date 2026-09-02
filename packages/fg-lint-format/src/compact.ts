/**
 * `compact` — the findings, as a person reads them in a terminal.
 *
 * Binding source: `WORKFLOW/features/cli-ux/plans/ux-design.md` §2.4, with U5 (the row names
 * the rule by its SHORT LABEL and hides `why` behind `--verbose`), U6 (paths are never wrapped
 * or truncated) and U7 (colour only when the caller says so).
 *
 * ```
 * src/theme.js
 *     7:10  ✖ error    #FFFFFF  Цвет литералом вместо токена           token.literal.color
 *                      → var(--sds-eng-palette-white)
 *
 * ✖ 11 проблем   5 ошибок · 1 предупреждение · 5 инфо   скрыто конфигом: 3
 * ```
 *
 * THIS IS NOT THE OLD `compact`. Until the UX redesign this name meant ESLint's one-line
 * `file: line N, col N, Error - message (rule)` grammar, kept because VS Code's built-in
 * `$eslint-compact` problem matcher parses it. That format is DELETED (design §2.4, last
 * bullet): IDE integration is SARIF and JSON, both of which carry more than a matcher can, and
 * the name is now spent on the thing a human actually looks at. A test asserting the matcher
 * would today be asserting a contract with a consumer we no longer serve.
 *
 * FOUR DECISIONS WORTH THE READING:
 *
 *   THE ROW SAYS WHAT IS WRONG, NOT WHY. `actual` is the offending value — the reader's eye
 *   goes there first because it is the text they will search their file for — followed by the
 *   rule's label, three or four words naming the problem. The rule's own sentence (`why`) is
 *   an explanation, and an explanation on every row is a wall; `--verbose` prints it.
 *
 *   ALIGNMENT IS PER FILE GROUP, NOT PER DOCUMENT (design §2.4: "right-aligned to the widest
 *   in the FILE group"). A single 4-digit line number in one file would otherwise indent every
 *   row of every other file, and the groups are read one at a time.
 *
 *   WIDTH IS OPTIONAL AND NEVER GUESSED. With `width` the rule id is flushed right, the way a
 *   linter's output has looked since ESLint's stylish; without it (a pipe, a file, a CI log)
 *   the id follows the message after two spaces. Inventing 80 for an unknown terminal would
 *   corrupt the very case — a redirected document — where nobody can see the damage.
 *
 *   EVERY STRING FROM THE ANALYSED PROJECT IS SANITISED. `actual`, `expected.value` and `why`
 *   are fragments of someone else's source: a newline in one would forge a row, an ANSI escape
 *   would repaint the rest of the report. {@link sanitize} flattens both.
 */
import type { Finding, RuleCatalogEntry, Severity } from "@smart-tools/fg-analyzer-engine";

import { paint, plainWidth, stripAnsi, type Style } from "./ansi.ts";
import { countPhrase, type Lang, type SeverityCounts, totalOf } from "./counts.ts";
import { singleLine, toPosix } from "./text.ts";
import { groupByFile } from "./types.ts";

export interface CompactOptions {
  /**
   * The run's catalog — where the LABELS come from.
   *
   * A `Finding` carries its rule id, not its name; the catalog is the one table that has both
   * (`RuleCatalogEntry.label`, engine `config/types.ts`), and this formatter is handed it
   * already because `sarif` needs it. So a label added to a rule reaches the terminal with no
   * second table to keep in step — which is the whole point of putting labels on rules.
   */
  readonly catalog: readonly RuleCatalogEntry[];
  readonly lang: Lang;
  readonly color: boolean;
  /** `--verbose`: print each rule's `why` under its row. */
  readonly verbose: boolean;
  /** Terminal columns, when the caller knows them. */
  readonly width?: number | undefined;
  /** How many findings the rule config hid — the footer says so, or stays silent at 0. */
  readonly hiddenCount: number;
  readonly counts: SeverityCounts;
}

/** Design §2.4. The severity WORD is a format token and is not localized, like the glyph. */
const GLYPH: Readonly<Record<Severity, string>> = {
  error: "✖",
  warning: "▲",
  info: "●",
  candidate: "◇",
};

const COLOUR: Readonly<Record<Severity, Style>> = {
  error: "red",
  warning: "yellow",
  info: "blue",
  candidate: "magenta",
};

/** Worst first — the footer's glyph, and the order its breakdown is written in. */
const SEVERITY_ORDER: readonly Severity[] = ["error", "warning", "info", "candidate"];

/** Two spaces between every pair of columns (design §2.4's layout). */
const GAP = "  ";

/** The `line:col` column sits three spaces in, which is what §2.4's sample draws. */
const INDENT = "   ";

/**
 * `▲ warning`, the width §2.4 pads the severity cell to — a FLOOR rather than a constant.
 *
 * `◇ candidate` is two columns wider and the design's sample never shows one. Padding to the
 * widest severity actually present keeps the promise the sample makes (the messages of one
 * document line up) while never printing narrower than the design's number.
 */
const MIN_SEVERITY_WIDTH = 9;

/** Design §2.4: `actual` is "truncated with `…` at 60 cols". */
const ACTUAL_LIMIT = 60;

/** Design §2.4: `--verbose` wraps `why` at `width − 21`, i.e. at the message column. */
const MIN_WRAP = 20;

/**
 * One line, no escapes — for every string that came out of the analysed project.
 *
 * The rules do not write multi-line `why` today and no source line contains an escape by
 * accident; this makes neither of those an assumption the format's integrity rests on.
 */
function sanitize(text: string): string {
  return singleLine(stripAnsi(text)).replace(/\p{Cc}/gu, " ");
}

/** `…` in the 60th column, never a 61st, and counted in code points rather than UTF-16 units. */
function truncate(text: string, limit: number): string {
  const points = [...text];

  return points.length <= limit ? text : `${points.slice(0, limit - 1).join("")}…`;
}

/**
 * The label for one finding: the SUB-RULE's when the finding names one, else the rule's — and
 * then, when the finding's `subkind` has a name, `<label> — <subkind label>`.
 *
 * `a11y.lint`'s own label — «Базовое правило доступности» — is true of all thirty sub-rules and
 * useful for none, and the sub-rule's name is exactly what the reader needs to look the
 * problem up. Rules whose `subkind` is an open value (a component name, a role) declare neither
 * a sub-rule nor a subkind label, so both lookups miss and the rule's own label stands.
 *
 * THE SUFFIX IS V5 FINDING #6. Design §2.4's worked example gives the three `token.literal.color`
 * shades three different messages — «Цвет литералом вместо токена» / «Цвет не из палитры» /
 * «Свой оттенок; ближайший electric700» — and one label per finding-level id rendered them as
 * seven visually identical rows, differing only in the actual. The shade is a MODIFIER of the
 * problem rather than a different problem, so it is appended with an em dash rather than
 * replacing the label: the reader still sees which rule fired, and now also which way.
 * `--verbose` still prints the full `why`; this is what the row says without it.
 *
 * A rule missing from the catalog (an adapter the caller did not pass a catalog for) yields
 * `""` and the row prints `actual` alone: the rule id is already on the same line, so a
 * fabricated name would add nothing but noise.
 */
function labelOf(
  finding: Finding,
  catalog: ReadonlyMap<string, RuleCatalogEntry>,
  lang: Lang,
): string {
  const entry = catalog.get(finding.rule);
  if (entry === undefined) return "";

  const subkind = finding.subkind;
  const subrule =
    subkind === null ? undefined : entry.subrules.find((candidate) => candidate.id === subkind);
  const label = (subrule ?? entry).label[lang];
  // A SUB-RULE already names the shade — it IS the finding's subkind — so it is never suffixed
  // with itself.
  if (subrule !== undefined || subkind === null) return label;

  const shade = entry.subkindLabels[subkind];
  return shade === undefined ? label : `${label} — ${shade[lang]}`;
}

/** Wrap on spaces at `width` columns; a word longer than the line is left alone (U6). */
function wrap(text: string, width: number): readonly string[] {
  if (!Number.isFinite(width)) return [text];

  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ").filter((part) => part.length > 0)) {
    if (current.length === 0) {
      current = word;
      continue;
    }
    if ([...current].length + 1 + [...word].length > width) {
      lines.push(current);
      current = word;
      continue;
    }
    current = `${current} ${word}`;
  }
  if (current.length > 0) lines.push(current);

  return lines.length === 0 ? [text] : lines;
}

/** `✖ 11 проблем   5 ошибок · 1 предупреждение · 5 инфо   скрыто конфигом: 3` (design §2.4). */
export function compactFooter(options: CompactOptions): string {
  const { counts, lang, color } = options;
  const total = totalOf(counts);
  const hidden =
    options.hiddenCount > 0
      ? paint(
          lang === "ru"
            ? `скрыто конфигом: ${options.hiddenCount}`
            : `hidden by config: ${options.hiddenCount}`,
          ["dim"],
          color,
        )
      : "";

  if (total === 0) {
    const clean = paint(lang === "ru" ? "✔ проблем нет" : "✔ no problems", ["green"], color);

    return hidden === "" ? clean : `${clean}${GAP} ${hidden}`;
  }

  const byseverity: Readonly<Record<Severity, number>> = {
    error: counts.errorCount,
    warning: counts.warningCount,
    info: counts.infoCount,
    candidate: counts.candidateCount,
  };
  // The glyph of the worst severity present: `✖` while anything is an error, `▲` when only
  // warnings are left (design §2.4), and — the case the design's three examples do not
  // reach — `●`/`◇` for a run that found nothing louder. Colour follows the glyph.
  const worst = SEVERITY_ORDER.find((severity) => byseverity[severity] > 0) ?? "info";
  const head = paint(
    `${GLYPH[worst]} ${countPhrase(total, lang, "problem")}`,
    [COLOUR[worst]],
    color,
  );
  const breakdown = SEVERITY_ORDER.filter((severity) => byseverity[severity] > 0)
    .map((severity) => countPhrase(byseverity[severity], lang, severity))
    .join(" · ");

  return [head, breakdown, hidden].filter((part) => part.length > 0).join(`${GAP} `);
}

export function formatCompact(findings: readonly Finding[], options: CompactOptions): string {
  const catalog = new Map(options.catalog.map((entry) => [entry.id, entry]));
  const color = options.color;
  const severityWidth = Math.max(
    MIN_SEVERITY_WIDTH,
    ...findings.map((finding) => plainWidth(`${GLYPH[finding.severity]} ${finding.severity}`)),
  );

  const lines: string[] = [];
  for (const group of groupByFile(findings)) {
    // The path stays RELATIVE to the analysed root (design §2.4) and whole (U6): it is what the
    // reader types into their editor, and half of it is worse than none.
    lines.push(paint(toPosix(group.file), ["bold"], color));

    const locWidth = Math.max(
      ...group.findings.map((finding) => `${finding.line}:${finding.column}`.length),
    );
    const messageColumn = INDENT.length + locWidth + GAP.length + severityWidth + GAP.length;

    for (const finding of group.findings) {
      const severityCell = `${GLYPH[finding.severity]} ${finding.severity}`;
      const label = labelOf(finding, catalog, options.lang);
      const actual = truncate(sanitize(finding.actual), ACTUAL_LIMIT);
      const message = [actual, label].filter((part) => part.length > 0).join(GAP);
      const head =
        INDENT +
        `${finding.line}:${finding.column}`.padStart(locWidth) +
        GAP +
        paint(severityCell, [COLOUR[finding.severity]], color) +
        " ".repeat(severityWidth - plainWidth(severityCell)) +
        GAP +
        message;
      // The rule id is flushed right when the terminal's width is known, and follows the
      // message after two spaces when it is not — never closer than two spaces either way.
      const pad =
        options.width === undefined
          ? GAP.length
          : Math.max(GAP.length, options.width - plainWidth(head) - finding.rule.length);
      lines.push(head + " ".repeat(pad) + paint(finding.rule, ["dim"], color));

      const fix = finding.expected?.value ?? null;
      if (fix !== null && fix.length > 0) {
        lines.push(
          " ".repeat(messageColumn) + paint(`→ ${sanitize(fix)}`, ["dim", "green"], color),
        );
      }

      if (options.verbose && finding.why.length > 0) {
        const room =
          options.width === undefined
            ? Number.POSITIVE_INFINITY
            : Math.max(MIN_WRAP, options.width - messageColumn);
        for (const line of wrap(sanitize(finding.why), room)) {
          lines.push(" ".repeat(messageColumn) + paint(line, ["dim"], color));
        }
      }
    }

    // A blank line after every group, which is also the blank line before the footer.
    lines.push("");
  }

  lines.push(compactFooter(options));

  // No trailing newline: printing is the caller's business (`LintOutput.text`).
  return lines.join("\n");
}
