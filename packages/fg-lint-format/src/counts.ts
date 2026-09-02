/**
 * The four severity counters every format returns, and the agreement rules for the counted
 * nouns — the ONLY localized text this package produces.
 *
 * The counters live here rather than inside each formatter for a reason that shows up in the
 * CLI: `formatLint(...)`'s `errorCount` is what decides the process exit code (design U2,
 * "exit code 1 when ≥1 visible `error`-severity finding"). If each format counted for itself,
 * `--format json` and `--format sarif` could disagree about whether the build fails.
 */
import type { Finding } from "@smart-tools/fg-analyzer-engine";

export interface SeverityCounts {
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly candidateCount: number;
}

export const ZERO_COUNTS: SeverityCounts = {
  errorCount: 0,
  warningCount: 0,
  infoCount: 0,
  candidateCount: 0,
};

/** One pass, exhaustive over `severitySchema`'s four options. */
export function countSeverities(findings: readonly Finding[]): SeverityCounts {
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  let candidateCount = 0;
  for (const finding of findings) {
    switch (finding.severity) {
      case "error":
        errorCount += 1;
        break;
      case "warning":
        warningCount += 1;
        break;
      case "info":
        infoCount += 1;
        break;
      case "candidate":
        candidateCount += 1;
        break;
    }
  }
  return { errorCount, warningCount, infoCount, candidateCount };
}

/** Every finding is a problem, whatever its severity — so this is the row count. */
export function totalOf(counts: SeverityCounts): number {
  return counts.errorCount + counts.warningCount + counts.infoCount + counts.candidateCount;
}

export type Lang = "ru" | "en";

/** `[nominative singular, genitive singular, genitive plural]` — Russian's three forms. */
type RuForms = readonly [one: string, few: string, many: string];

/**
 * The Russian plural rule (CLDR `one` / `few` / `many` for the `ru` locale), hand-rolled
 * because pulling `Intl.PluralRules` in would make the output depend on the ICU data the host
 * Node was built with, and a summary line that differs between two machines is not
 * deterministic output.
 */
function ru(count: number, forms: RuForms): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/**
 * ESLint's `pluralize`
 * (`node_modules/.pnpm/eslint@9.39.5_jiti@2.7.0/node_modules/eslint/lib/cli-engine/formatters/stylish.js:21-23`),
 * transcribed.
 */
function en(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

const PROBLEMS: RuForms = ["проблема", "проблемы", "проблем"];
const ERRORS: RuForms = ["ошибка", "ошибки", "ошибок"];
const WARNINGS: RuForms = ["предупреждение", "предупреждения", "предупреждений"];
const CANDIDATES: RuForms = ["кандидат", "кандидата", "кандидатов"];

/**
 * The five countable nouns the compact footer needs, ru and en.
 *
 * `info` declines in neither language — «5 инфо», «1 инфо», "5 info", "1 info" — and saying so
 * with an empty English plural is the honest encoding: the alternative, a special case at the
 * call site, would put the grammar of one word in two places.
 */
const NOUNS = {
  problem: { ru: PROBLEMS, en: "problem" },
  error: { ru: ERRORS, en: "error" },
  warning: { ru: WARNINGS, en: "warning" },
  info: { ru: ["инфо", "инфо", "инфо"] as RuForms, en: "info", invariant: true },
  candidate: { ru: CANDIDATES, en: "candidate" },
} as const;

export type CountNoun = keyof typeof NOUNS;

/**
 * `<count> <noun>`, agreed with the count in `lang` — the whole of this package's localized
 * vocabulary, and the reason `compact` can be read in Russian without a translation table
 * anywhere near the formatter.
 */
export function countPhrase(count: number, lang: Lang, noun: CountNoun): string {
  const forms = NOUNS[noun];
  if (lang === "ru") return `${count} ${ru(count, forms.ru)}`;

  return `${count} ${"invariant" in forms ? forms.en : en(count, forms.en)}`;
}
