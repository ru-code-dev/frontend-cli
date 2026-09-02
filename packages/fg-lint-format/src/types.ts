/**
 * The public contract of `@smart-tools/fg-lint-format`, written down once so the four
 * formatters and the CLI that drives them cannot drift.
 *
 * Binding source: `WORKFLOW/features/rule-config/plans/rc-design.md` §6.
 *
 * Two properties hold for every symbol in this package and are worth stating where the
 * types are, because they are what makes the package safe to bundle:
 *
 *   TYPES ONLY from the engine. Every import of `@smart-tools/fg-analyzer-engine` in this
 *   `src/` is an `import type`, so nothing this package emits can pull a SECOND copy of the
 *   engine into `cli/dist/fg.mjs`. Grep proves it: `grep -rn "fg-analyzer-engine" src`
 *   returns only `import type` lines.
 *
 *   PURE. Findings in, string out. No `node:*` import, no clock, no `process.env`, no
 *   filesystem — which is why `projectRoot` is a parameter rather than something this code
 *   could ask the process for, and why {@link LintInput.color} is a boolean the caller has
 *   already decided (`packages/cli-kit/src/ui.ts:211-227` is where `NO_COLOR` / `FORCE_COLOR`
 *   / `isTTY` are read; this package must not read them a second time and disagree).
 */
import type { Finding, RuleCatalogEntry } from "@smart-tools/fg-analyzer-engine";

/**
 * The three formats this package renders (UX design U1).
 *
 * `stylish` is GONE, and with it the duplicate it created: it and `compact` were two paragraph
 * layouts of the same six findings, differing in column padding, and the owner's verdict on the
 * pair was that the output is unreadable. One human format, two machine ones.
 *
 * `html` — the default of `--format` — is NOT here: it is a report the `fg-analyzer-report`
 * package renders from the payload, not a rendering of visible findings, and listing it in this
 * enum would promise `formatLint("html", …)` a document it cannot produce.
 */
export type LintFormat = "compact" | "json" | "sarif";

/**
 * The same three, as data — the CLI validates `--format` against this list and prints it in
 * the usage error, so the accepted set is never restated in a second place.
 *
 * Order is the design's: the human one first, then the two machine forms.
 */
export const LINT_FORMATS: readonly LintFormat[] = ["compact", "json", "sarif"];

export interface LintInput {
  /**
   * ALREADY VISIBLE findings — the rule config (design D3) has been applied by the engine
   * before they get here, so a formatter never asks whether a finding should be shown and
   * `severity` is final. Assumed sorted by file, then line, then column, which is the order
   * `analyzeProject` returns them in; this package preserves that order rather than imposing
   * a second one (the one exception is `json`, whose per-file entries the design requires to
   * be sorted by path — a no-op on already-sorted input).
   */
  readonly findings: readonly Finding[];
  /**
   * The rule catalog for the run (`ruleCatalog(adapter)`): 11 entries with no kit adapter,
   * 32 with the EDS one (`WORKFLOW/features/rule-config/plans/rc-design.md:152-154`).
   * Only `sarif` reads it — it is what `tool.driver.rules` and every `ruleIndex` are built
   * from. The other three formats ignore it.
   */
  readonly catalog: readonly RuleCatalogEntry[];
  /** Absolute. `finding.file` is relative to it. */
  readonly projectRoot: string;
  readonly tool: { readonly name: "fg"; readonly version: string };
  /**
   * Localizes `compact`'s LABELS AND FOOTER.
   *
   * A finding's own text (`why`, shown under `--verbose`) is written by the rule and is Russian
   * by the rules' design — it is not translated here. The severity words `error` / `warning` /
   * `info` / `candidate` stay English in both languages: UX design §2.4 draws the Russian
   * document with them, they are the vocabulary of every linter a developer already reads, and
   * they line up in a fixed-width column that a translation would not.
   */
  readonly lang: "ru" | "en";
  /**
   * ANSI escapes in `compact`, and nowhere else. Default `false`.
   *
   * `json` and `sarif` are machine formats and are NEVER coloured whatever this says — an
   * escape inside a JSON string would make the document unparseable.
   *
   * NOT read from the environment here: cli-kit decided it once, from `NO_COLOR` /
   * `FORCE_COLOR` / the stream's `isTTY`, and a second reader could disagree with the first.
   */
  readonly color?: boolean;
  /**
   * `--verbose`: `compact` prints each rule's `why` under its row (design U5). Default `false`.
   *
   * Optional rather than required so that a caller who only wants `json` or `sarif` — and the
   * suites of those two formats — need not name a flag neither format reads.
   */
  readonly verbose?: boolean;
  /**
   * Terminal columns for `compact`'s right-flushed rule id and `--verbose` wrapping.
   *
   * ABSENT IS A REAL ANSWER, not a missing one: a pipe, a file and a CI log have no width, and
   * `compact` then puts the rule id two spaces after the message instead of inventing 80
   * columns and wrapping a document nobody can see wrapped.
   */
  readonly width?: number | undefined;
  /**
   * How many findings the rule config hid (design D3) — `compact`'s footer says «скрыто
   * конфигом: N», and stays silent at `0`.
   *
   * Passed in rather than derived: `findings` are the VISIBLE ones by contract, so this number
   * cannot be recovered from them, and a formatter that guessed it would be guessing about the
   * user's own config. Default `0`.
   */
  readonly hiddenCount?: number;
}

export interface LintOutput {
  /** The whole document. No trailing newline is added; printing is the caller's business. */
  readonly text: string;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly candidateCount: number;
}

/** Findings for one file, in input order. Produced by {@link groupByFile}. */
export interface FileGroup {
  /** `finding.file` verbatim — relative to `projectRoot`, separators not yet normalised. */
  readonly file: string;
  readonly findings: readonly Finding[];
}

/**
 * Group by `file`, FIRST-APPEARANCE order.
 *
 * A `Map` rather than a sort: the engine already emits findings sorted by file then position
 * and the design forbids re-sorting them differently, so the honest operation is "keep the
 * order you were given" — which also means a caller who hands over a deliberately ordered
 * list (a test, a future `--sort` flag) gets that order back rather than this package's
 * opinion about it.
 */
export function groupByFile(findings: readonly Finding[]): readonly FileGroup[] {
  const byFile = new Map<string, Finding[]>();
  for (const finding of findings) {
    const bucket = byFile.get(finding.file);
    if (bucket === undefined) byFile.set(finding.file, [finding]);
    else bucket.push(finding);
  }
  return [...byFile].map(([file, group]) => ({ file, findings: group }));
}
