/**
 * EVERY user-facing string this package can ever print, in both languages, in one file.
 *
 * The arrangement and its reasoning are `packages/fg-pixso/src/strings.ts:1-14`'s, and they are
 * followed rather than re-derived: multilingual UX is a contract-level fact
 * (`WORKFLOW/features/initial-analysis/plans/2.1-design.md:127-132`), the `Localized` type is
 * the enforcement (`packages/cli-kit/src/index.ts:25-28`), `ru` is the product default and is
 * therefore written FIRST and never as a translation of the English, and anything carrying a
 * runtime value is a FUNCTION returning `Localized` rather than a template assembled at the
 * call site — interpolating at the call site is how one of the two languages quietly stops
 * being rendered.
 *
 * THE ERROR MAP IS TOTAL BY TYPE. `sourceFailure` below switches on `SourceErrorCode`
 * (`packages/fg-source/src/errors.ts:36-40`) with no `default` arm, so adding a fifth code to
 * `fg-source` breaks the build here instead of reaching a user as a generic sentence. That is
 * the whole reason B1 refused to ship user-facing text of its own: "NO user-facing strings …
 * Localized ru+en wording is the feature package's job, built from `code`"
 * (`WORKFLOW/features/hackathon-analys/reports/b1-fg-source.md:113-117`).
 */
import type { CommandGroup, Localized } from "@smart-tools/fg-cli-kit";
import { FG_OUT_DIR } from "@smart-tools/fg-cli-kit";
import { countPhrase } from "@smart-tools/fg-lint-format";
import type { CorpusProvenance, CorpusWarning, NpmError } from "@smart-tools/fg-eds-adapter";
import type { SourceError } from "@smart-tools/fg-source";

import { adapterNames } from "./adapters.ts";
import {
  CONFIG_FILE,
  CONFIG_SCHEMA_FILE,
  DEFAULT_REPORT_FORMAT,
  FILE_LEVELS,
  INHERIT_LEVEL,
  REPORT_FORMATS,
} from "./config/names.ts";

/**
 * THE HELP GROUP the three commands of this package appear under (design 2.7's second block).
 *
 * Carried by the commands themselves, like `fg-pixso`'s: the help collects groups off the
 * registry, so nothing in `cli` names this section.
 */
export const analysisGroup: CommandGroup = {
  id: "analysis",
  title: { ru: "Анализ проекта", en: "Project analysis" },
  order: 2,
};

/**
 * ONE SHORT LINE for the help table — design 2.7 budgets it 40 columns.
 *
 * What used to be here (a 92-character sentence naming three domains and the output format) is
 * now {@link details}, printed on `fg --help --preport`. Same words, a page that has room for
 * them. The old shape is diagnosis 3 of `WORKFLOW/features/cli-ux/plans/current-output.txt`.
 */
export const summary: Localized = {
  ru: "отчёт по проекту",
  en: "project report",
};

/** The paragraph `fg --help --preport` prints under the usage line (design 2.8). */
export const details: Localized = {
  ru: "Отчёт по фронтенд-проекту: доступность, компоненты, иконки, дизайн-система. Код возврата: 0 — ошибок нет; 1 — есть ошибки (с учётом конфига) или сбой; 2 — неверный вызов.",
  en: "A front-end project report: accessibility, components, icons, design system. Exit code: 0 — no errors; 1 — errors (after the config) or a failure; 2 — a wrong invocation.",
};

/** The `без -o →` column (design 2.7). Read from the constant the command actually writes to. */
export const defaultOut: Localized = {
  ru: `./${FG_OUT_DIR}/report.html`,
  en: `./${FG_OUT_DIR}/report.html`,
};

/**
 * THE ONE-LINE FORMS the main help table shows under `--preport` (design 2.7's sub-rows).
 *
 * Separate from `argDescriptions` on purpose: those are sentences, and a sentence in a table is
 * what made the old page unreadable. Each of these is one line, and the per-command page still
 * prints the full description.
 */
export const argHints = {
  format: {
    ru: `несколько через запятую (по умолчанию ${DEFAULT_REPORT_FORMAT})`,
    en: `several, comma-separated (${DEFAULT_REPORT_FORMAT} by default)`,
  },
  uiKit: {
    ru: "дизайн-система (по умолчанию — по зависимостям)",
    en: "design system (default: from the dependencies)",
  },
  config: {
    ru: "fg.config.json (по умолчанию — корень проекта, затем cwd)",
    en: "fg.config.json (default: the project root, then the cwd)",
  },
} as const satisfies Record<string, Localized>;

/**
 * THE HEADER LINE's parts — design §2.1, `fg v1.0.0 · preport · eds 1.13.0 (встроенная)`.
 *
 * `fg v<version>` is the renderer's (`createUi`); a command contributes the rest. The first part
 * is the command's own SHORT name, spelled without dashes and identically in both languages,
 * because it is the name the help table teaches (U8) rather than a word to translate.
 */
export const headerNames = {
  report: { ru: "preport", en: "preport" },
  initConfig: { ru: "iconf", en: "iconf" },
  parseUiKit: { ru: "pkit", en: "pkit" },
} as const satisfies Record<string, Localized>;

/**
 * The header's design-system part: `eds 1.13.0 (встроенная)`.
 *
 * WHICH SNAPSHOT the numbers came from is the one fact a reader needs before the numbers, and
 * §2.1 puts it on the header rather than into a sentence. The fuller sentence — how the design
 * system was chosen — is still said, as a note (§2.6), because "selected with --ui-kit" and
 * "detected from the dependencies" is news the header has no room for.
 */
export const kitHeader = (name: string, provenance: CorpusProvenance): Localized => ({
  ru: `${name} ${provenanceLabel(provenance).ru}`,
  en: `${name} ${provenanceLabel(provenance).en}`,
});

/** The same slot when no design system is in play — never left blank, per the notice's rule. */
export const noKitHeader: Localized = {
  ru: "без дизайн-системы",
  en: "no design system",
};

/** `--init-config`'s header part (§2.5): the design system only, with its version. */
export const kitVersionHeader = (name: string, version: string | null): Localized => ({
  ru: version === null ? name : `${name} ${version}`,
  en: version === null ? name : `${name} ${version}`,
});

/**
 * The summary block's row keys (design §2.3/§2.5).
 *
 * `files`/`findings`/`hidden` are §2.3's three fact rows; `config`/`schema` are `--iconf`'s two
 * paths. A WRITTEN FORMAT keys its own row by its own name (`html`, `json`, `sarif`) and is
 * therefore not listed here — {@link formatRowKey} builds it, so a fifth format cannot arrive
 * with no row key.
 */
export const rowKeys = {
  files: { ru: "файлов", en: "files" },
  findings: { ru: "находок", en: "findings" },
  hidden: { ru: "скрыто", en: "hidden" },
  config: { ru: "конфиг", en: "config" },
  schema: { ru: "схема", en: "schema" },
} as const satisfies Record<string, Localized>;

/**
 * A `Localized` for text that is the SAME in both languages — a path, a URL, a format name, a
 * design system's name.
 *
 * It exists so those values can travel through the `Localized`-only UI contract without every
 * call site writing `{ ru: x, en: x }`, which is a shape whose two halves can be edited apart.
 */
export const plain = (text: string): Localized => ({ ru: text, en: text });

/** A written file's row key IS its format's name — the same word in both languages (§2.3). */
export const formatRowKey = plain;

/**
 * THE PLACEHOLDERS the help table, the usage line and every refusal spell — design §2.7/§2.8.
 *
 * They live HERE, with every other user-facing string, because they became `Localized` in this
 * pass (V5 finding #12): §2.7 spells the ru page's placeholders in Russian, and the house rule
 * is that Cyrillic outside this file is prose in a comment. A flag's VALUE LIST
 * (`--format html|compact|json|sarif`) is NOT here and stays a plain string on the `ArgSpec`:
 * it is the same text in both languages and `cli/src/parse.ts` reads the accepted values back
 * out of it, so one spelling has to be the spelling.
 */
export const argNames = {
  source: { ru: "<путь|repo>", en: "<path|repo>" },
  out: { ru: "-o <путь>", en: "-o <path>" },
  config: { ru: "--config <файл>", en: "--config <file>" },
  initConfigOut: { ru: "-o <файл>", en: "-o <file>" },
  parseSource: { ru: "--source <путь|repo>", en: "--source <path|repo>" },
} as const satisfies Record<string, Localized>;

export const argDescriptions = {
  source: {
    ru: "Каталог проекта на диске или ссылка на репозиторий (http(s)://…, git@…, file://…) — он будет клонирован во временный каталог и удалён после анализа",
    en: "A project directory on disk, or a repository link (http(s)://…, git@…, file://…) — it is cloned into a temporary directory and removed after the analysis",
  },
  out: {
    ru: `Куда записать отчёт: ФАЙЛ, когда формат-файл один, и КАТАЛОГ, когда их несколько (внутри — report.<ext>). Необязателен: без него — ./${FG_OUT_DIR}/report.<ext>; недостающие каталоги будут созданы`,
    en: `Where to write the report: a FILE when exactly one file format was asked for, a DIRECTORY when several (report.<ext> inside it). Optional: without it, ./${FG_OUT_DIR}/report.<ext>; missing directories are created`,
  },
  /**
   * The accepted values are BUILT from the registry, not typed out: a design system added to
   * `adapters.ts` documents itself in `fg --help`, in both languages, without this file being
   * edited. `none` is one of them because turning the check off is a choice a user makes, not
   * an absence.
   */
  uiKit: {
    ru: `Какую дизайн-систему учитывать: ${adapterNames().join(", ")}. Без флага она определяется по зависимостям проекта; если ничего не подошло — проверяются только общие правила`,
    en: `Which design system to measure against: ${adapterNames().join(", ")}. Without the flag it is detected from the project's dependencies; when nothing matches, only the generic rules are checked`,
  },
} as const satisfies Record<string, Localized>;

/**
 * THE PHASE LABELS — what the progress line calls each stage of a run.
 *
 * Five, because five is what this command actually does and each of them is a wait a user can
 * feel: getting the project onto disk (a clone can be tens of seconds), reading every file
 * (the slow one, and the one with a real file count behind it), running the rules (a real rule
 * count), building the single-file HTML, and writing it.
 *
 * `Localized`, because `CommandUi.phase` takes nothing else — `--lang` reaches the progress
 * line exactly as it reaches every other string here. Short, because the bar gives a label 22
 * columns (`packages/cli-kit/src/ui.ts`, ported from `install:267`).
 */
export const phases = {
  resolve: { ru: "подготовка проекта", en: "fetching the project" },
  scan: { ru: "чтение файлов", en: "reading files" },
  rules: { ru: "проверки", en: "checks" },
  render: { ru: "сборка отчёта", en: "building the report" },
  write: { ru: "запись", en: "writing" },
} as const satisfies Record<string, Localized>;

/**
 * THE RUSSIAN PLURAL RULE (CLDR `one`/`few`/`many` for `ru`), for the two nouns this package
 * counts on its own.
 *
 * `@smart-tools/fg-lint-format` implements the same rule for the five nouns its footer needs
 * and exposes it only through `countPhrase`, which is closed over that list — «файл» and
 * «правило» are not in it, and widening another package's vocabulary is not this pass's to do.
 * Seven lines rather than a sixth noun in a package that would then have to export its
 * pluraliser: the rule is standard and testable, and the alternative was `2 файлов`.
 */
const ruPlural = (count: number, forms: readonly [string, string, string]): string => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
};

/**
 * THE UNITS the counted phases are measured in — `598 файлов`, `32 правила` (design §2.2).
 *
 * FUNCTIONS OF THE COUNT, because the phase row prints `<total> <unit>` and Russian agrees the
 * noun with the number: `1 файл`, `2 файла`, `598 файлов`. The count they agree with is the
 * phase's TOTAL, which is what the row states and what the live line ends with.
 *
 * Handed to `ui.progress(done, total, unit)`, which is also what the NON-TTY row's detail is
 * built from when the phase ends, so the live line and the ledger row cannot name different
 * things.
 */
export const phaseUnits = {
  files: (count: number): Localized => ({
    ru: ruPlural(count, ["файл", "файла", "файлов"]),
    en: count === 1 ? "file" : "files",
  }),
  rules: (count: number): Localized => ({
    ru: ruPlural(count, ["правило", "правила", "правил"]),
    en: count === 1 ? "rule" : "rules",
  }),
} as const;

/**
 * The `запись` row's detail: the formats the run actually wrote, in the order it wrote them.
 *
 * Not `Localized` in substance — `html, sarif` is the same text in both languages — but typed as
 * one because `CommandUi.phase` takes nothing else.
 */
export const writtenFormats = (formats: readonly string[]): Localized => ({
  ru: formats.join(", "),
  en: formats.join(", "),
});

/**
 * No positional at all. Names BOTH accepted forms, for the reason
 * `packages/fg-pixso/src/strings.ts:66-70` gives: the error is the only place a user who typed
 * the line wrong will look, so it teaches the surface rather than reporting an absence.
 */
export const missingSource: Localized = {
  ru: "не указан проект",
  en: "no project given",
};

/**
 * WHAT «не указан проект» MEANS, on its own dim line under the headline (§2.6, V5 finding #21).
 *
 * The two halves used to be one sentence, and that sentence was 104 columns — a headline the
 * design writes as four words, with the elapsed column at 51 and a 100-column page around it.
 * §2.6's block is three lines for exactly this reason: what went wrong, what it means, what to
 * type. The list of accepted spellings is the middle one.
 */
export const missingSourceDetail: Localized = {
  ru: "передайте каталог на диске либо ссылку на репозиторий (http(s)://…, git@…, file://…)",
  en: "pass a directory on disk, or a repository link (http(s)://…, git@…, file://…)",
};

/**
 * `SourceError` → one localized sentence, per code.
 *
 * `clone-failed` appends git's own words when there are any. They are English and
 * unlocalized — which is exactly why B1 parked them on a separate field rather than making
 * them the error (`packages/fg-source/src/errors.ts:74`,
 * `WORKFLOW/features/hackathon-analys/reports/b1-fg-source.md:119-126`) — but «git не смог
 * склонировать» without them tells a user nothing they can act on, and the alternative is
 * asking them to re-run the clone by hand to see the reason. So the localized sentence carries
 * the diagnosis and git's line rides behind it, clearly marked as git's.
 */
export function sourceFailure(error: SourceError): Localized {
  const input = error.input;
  switch (error.code) {
    case "path-not-found": {
      return {
        ru: `путь не найден: ${input}. Если это ссылка на репозиторий, укажите её со схемой — http(s)://…, git@…, file://…`,
        en: `path not found: ${input}. If it is a repository, give the link with its scheme — http(s)://…, git@…, file://…`,
      };
    }
    case "not-a-directory": {
      return {
        ru: `это не каталог: ${input}. Анализируется проект целиком, поэтому нужен каталог, а не файл`,
        en: `not a directory: ${input}. The analysis reads a whole project, so it needs a directory rather than a file`,
      };
    }
    case "git-not-installed": {
      return {
        ru: `для клонирования ${input} нужен git, но он не найден в PATH. Установите git или передайте каталог проекта на диске`,
        en: `cloning ${input} needs git, and it is not on PATH. Install git, or pass a project directory on disk instead`,
      };
    }
    case "clone-failed": {
      const detail = error.gitStderr;
      return {
        ru:
          `не удалось склонировать ${input}` +
          (detail === undefined ? "" : `. git сообщает: ${detail}`),
        en: `could not clone ${input}` + (detail === undefined ? "" : `. git says: ${detail}`),
      };
    }
  }
}

/** Anything else that failed after the line was accepted: the scan, the render, the write. */
export const failed = (detail: string): Localized => ({
  ru: `не удалось построить отчёт: ${detail}`,
  en: `the report could not be built: ${detail}`,
});

/** What the run looked at and what the config let through — the §2.3 block's three fact rows. */
export interface ReportCounts {
  /** Files the walker read. */
  readonly files: number;
  /** Files the run produced no finding for (the engine's own tally). */
  readonly cleanFiles: number;
  readonly errors: number;
  readonly warnings: number;
  readonly info: number;
  readonly candidates: number;
  /** Findings the rule config removed (design D3). */
  readonly suppressed: number;
  /** The absolute path of the config file in force, or `null` for the built-in defaults. */
  readonly configPath: string | null;
}

/**
 * THE HEADLINE — two words, and nothing else on it (design §2.3).
 *
 * The counts that used to be glued onto this sentence are the ROWS below it now: a headline that
 * carried them collided with the elapsed the renderer prints at column 51 («…файлов 90.3s»,
 * the orchestrator's own observation on the rebuilt bundle), and a number inside a sentence is
 * not a number anyone can align.
 *
 * The failing form says WHY it is red rather than just turning red: U2 makes one visible
 * `error`-severity finding an exit-1 run, which is a decision a reader has to be able to
 * attribute to something.
 */
export const reportReady = (ok: boolean): Localized =>
  ok
    ? { ru: "отчёт готов", en: "report ready" }
    : { ru: "отчёт готов, есть ошибки", en: "report ready, with errors" };

/** `598 просмотрено · 411 чистых` — §2.3's `файлов` row. */
export const filesRow = (counts: ReportCounts): Localized => ({
  ru: `${String(counts.files)} просмотрено · ${String(counts.cleanFiles)} чистых`,
  en: `${String(counts.files)} scanned · ${String(counts.cleanFiles)} clean`,
});

/**
 * `2389   ✖ 436 ошибок  ▲ 466 предупреждений  ● 1110 инфо  ◇ 377 кандидатов` — §2.3's
 * `находок` row, over the VISIBLE findings.
 *
 * The four glyphs are §2.4's, and the counted nouns are the formatter package's `countPhrase`
 * rather than a second Russian plural table in this file — «1 ошибка / 2 ошибки / 5 ошибок» is
 * a rule, and a rule stated twice is a rule that drifts.
 *
 * A severity with nothing in it contributes NO group: four zeroes after a `0` is a row that
 * says nothing four times. A run with no visible findings therefore prints the total alone.
 */
export const findingsRow = (counts: ReportCounts): Localized => {
  const total = counts.errors + counts.warnings + counts.info + counts.candidates;
  const groups = (lang: "ru" | "en"): string =>
    (
      [
        ["✖", counts.errors, "error"],
        ["▲", counts.warnings, "warning"],
        ["●", counts.info, "info"],
        ["◇", counts.candidates, "candidate"],
      ] as const
    )
      .filter(([, count]) => count > 0)
      .map(([glyph, count, noun]) => `${glyph} ${countPhrase(count, lang, noun)}`)
      .join("  ");
  const row = (lang: "ru" | "en"): string => {
    const tail = groups(lang);
    return tail === "" ? String(total) : `${String(total)}   ${tail}`;
  };
  return { ru: row("ru"), en: row("en") };
};

/**
 * `3   конфиг: /abs/path/fg.config.json` — §2.3's `скрыто` row.
 *
 * One row carries two facts because they are one fact: the number of findings that were hidden
 * is meaningless without the file that hid them, and «по умолчанию» is the answer more often
 * than not. The word `конфиг` appears ONCE, in the value — the row's key is `скрыто`.
 */
export const hiddenRow = (counts: ReportCounts): Localized => ({
  ru: `${String(counts.suppressed)}   конфиг: ${counts.configPath ?? "по умолчанию"}`,
  en: `${String(counts.suppressed)}   config: ${counts.configPath ?? "built-in defaults"}`,
});

/**
 * THE ADAPTER NOTICE — one line, on stdout, before the run.
 *
 * A report that measures a project against a design system and a report that does not are two
 * different documents, and the difference is invisible in the file name. So the run says which
 * one it produced, in one line, always — including the «ничего не подошло» case, which is the
 * one a user is most likely to have wanted to be otherwise.
 *
 * It is printed BEFORE the analysis rather than beside the summary at the end: the sentence
 * describes what is about to be measured, and a user watching a slow scan should not have to
 * wait for it to learn that the scan is the generic one.
 */
export const adapterSelected = (
  name: string,
  provenance: CorpusProvenance,
  how: "flag" | "config" | "autodetect",
): Localized => {
  // THREE WAYS A DESIGN SYSTEM GETS PICKED, and the note names the one that happened. `config`
  // was previously reported as `flag` — `requestedAdapter` answers `"flag"` for the config file's
  // `uiKit` too — which only became visible once the note stopped being printed for the flag
  // itself (V5 finding #9): the one case left that says «выбрана флагом» must be the flag.
  const why = {
    flag: { ru: "выбрана флагом --ui-kit", en: "selected with --ui-kit" },
    config: { ru: "указана в fg.config.json", en: "named in fg.config.json" },
    autodetect: {
      ru: "определена по зависимостям проекта",
      en: "detected from the project's dependencies",
    },
  }[how];
  return {
    ru: `дизайн-система: ${name} ${provenanceLabel(provenance).ru} — ${why.ru}`,
    en: `design system: ${name} ${provenanceLabel(provenance).en} — ${why.en}`,
  };
};

/**
 * WHICH SNAPSHOT, as the half-sentence that follows the design system's name.
 *
 * The version printed here is the DESIGN SYSTEM's (`1.13.0`), not the adapter package's. Those
 * are two different numbers and the notice used to print the second one, which answered a
 * question nobody asks: a reader wants to know which EDS a report measured against, and
 * `fg-eds-adapter@1.0.0` does not say. The package version is still carried on
 * `AdapterEntry.version` for whoever needs it.
 *
 * The commit is abbreviated to seven characters — git's own short form, long enough to paste
 * into `git show` and short enough to sit on the same line as everything else.
 */
export const provenanceLabel = (provenance: CorpusProvenance): Localized => {
  const version = provenance.version ?? "?";
  if (provenance.kind === "embedded") {
    return { ru: `${version} (встроенная)`, en: `${version} (embedded)` };
  }
  const date = provenance.extractedAt.slice(0, 10);
  const commit = provenance.commit === null ? "" : `, ${provenance.commit.slice(0, 7)}`;
  return {
    ru: `${version} (обновлена ${date}${commit})`,
    en: `${version} (updated ${date}${commit})`,
  };
};

/**
 * THE SAME FACT, for the payload — and deliberately the same STRING the English notice prints.
 *
 * `ReportPayload.adapter` is `{ name, version }` and nothing more
 * (`packages/fg-analyzer-report/src/contract.ts:206`), a contract the dashboard reads. Rather
 * than widen it — which would mean a schema change, a dashboard change and a migration for a
 * report that is already written — the provenance rides in `version`, which is exactly what a
 * reader of the JSON wants that field to answer. English, because every other string in that
 * contract is English; the notice on the terminal is the localized surface.
 */
export const adapterStamp = (provenance: CorpusProvenance): string =>
  provenanceLabel(provenance).en;

/**
 * AN ON-DISK CORPUS THAT COULD NOT BE USED — one line per bad file, on stderr, never fatal.
 *
 * Total by type over `CorpusWarning["reason"]`, the same discipline `sourceFailure` above
 * follows: adding a third reason to `fg-eds-adapter` breaks the build here rather than reaching
 * a user as a generic sentence. Both arms NAME THE FILE, because the whole value of the message
 * is telling someone which of five files to look at or delete.
 */
export function corpusWarning(kit: string, warning: CorpusWarning): Localized {
  switch (warning.reason) {
    case "incomplete": {
      return {
        ru: `корпус ${kit} неполон: нет файла ${warning.file} — используется встроенный снимок. Соберите корпус заново: fg --parse-ui-kit ${kit}`,
        en: `the ${kit} corpus is incomplete: ${warning.file} is missing — using the embedded snapshot instead. Regenerate it with: fg --parse-ui-kit ${kit}`,
      };
    }
    case "invalid": {
      const detail = warning.detail;
      return {
        ru:
          `файл корпуса ${kit} не прошёл проверку: ${warning.file}` +
          (detail === undefined ? "" : ` (${detail})`) +
          `. Используется встроенный снимок. Соберите корпус заново: fg --parse-ui-kit ${kit}`,
        en:
          `a ${kit} corpus file failed validation: ${warning.file}` +
          (detail === undefined ? "" : ` (${detail})`) +
          `. Using the embedded snapshot instead. Regenerate it with: fg --parse-ui-kit ${kit}`,
      };
    }
  }
}

/**
 * `--ui-kit eds` on a project whose dependencies say EDS 2.x.
 *
 * The two design systems share a name and a vendor, `eds` is the spelling every existing script
 * already contains, and there is exactly one EDS in the user's manifest — so the request is
 * honoured with the version they are actually on. What must NOT happen is honouring it silently:
 * a report measured against a design system the user did not name, with no line saying so, is
 * worse than a refusal. Hence a note, naming both spellings and the reason.
 */
export const adapterRedirected = (
  from: string,
  to: string,
  packages: readonly string[],
): Localized => ({
  ru: `дизайн-система: запрошена ${from}, но в зависимостях проекта — ${packages.join(", ")}; отчёт построен против ${to}. Чтобы зафиксировать явно: --ui-kit ${to}`,
  en: `design system: ${from} was requested, but the project depends on ${packages.join(", ")}; the report is measured against ${to}. To pin it explicitly: --ui-kit ${to}`,
});

/** `--ui-kit none`: the user turned it off, and the report says so rather than looking empty. */
export const adapterDisabled: Localized = {
  ru: "дизайн-система: отключена (--ui-kit none) — проверяются только общие правила",
  en: "design system: disabled (--ui-kit none) — only the generic rules are checked",
};

/**
 * Nothing matched. Names the flag, because "no design system was found" and "you can name one"
 * are two different pieces of news and the second is the actionable one.
 */
export const adapterNotFound = (names: readonly string[]): Localized => ({
  ru: `дизайн-система: не найдена среди зависимостей проекта — проверяются только общие правила. Указать явно: --ui-kit ${names.join("|")}`,
  en: `design system: none found among the project's dependencies — only the generic rules are checked. Name one with --ui-kit ${names.join("|")}`,
});

/** `--ui-kit` given a name nobody registered. A usage error: exit 2, with the accepted list. */
export const unknownAdapter = (value: string, names: readonly string[]): Localized => ({
  ru: `неизвестная дизайн-система: ${value}. Допустимые значения: ${names.join(", ")}`,
  en: `unknown design system: ${value}. Accepted values: ${names.join(", ")}`,
});

/* --------------------------------------------------------------------------------------- *
 * `fg --parse-ui-kit <name>` — the corpus regeneration command.
 *
 * Same three rules as everything above: `ru` first and not as a translation, anything carrying a
 * runtime value is a FUNCTION returning `Localized`, and every error map is total by TYPE rather
 * than by a `default` arm.
 * --------------------------------------------------------------------------------------- */

export const parseSummary: Localized = {
  ru: "пересобрать корпус дизайн-системы",
  en: "rebuild a design system's corpus",
};

/** The paragraph `fg --help --pkit` prints (design 2.8); the old long summary, moved. */
export const parseDetails: Localized = {
  ru: "Пересобрать корпус дизайн-системы из её исходников — пять JSON-файлов в ~/.fg/kits/<имя>/.",
  en: "Rebuild a design system's corpus from its sources — five JSON files in ~/.fg/kits/<name>/.",
};

/** The `без -o →` column: this command has no `-o`, and its destination is fixed. */
/**
 * Where `--pkit` writes — design §2.5/§2.7 spell it `~/.fg/kits/eds/`, with the kit named.
 *
 * Generalising it to `~/.fg/kits/<имя>/` was defensible and still a divergence from the binding
 * ASCII (V5 finding #14): today there is exactly ONE parsable kit, the positional it comes from
 * is spelled `eds` on the same row, and a placeholder that stands for a set of one teaches a
 * user to type `<имя>`. Built from {@link PARSABLE_KITS} rather than typed out, so a second kit
 * widens the row instead of making it a lie.
 */
export const parseDefaultOutOf = (names: readonly string[]): Localized => ({
  ru: `~/.fg/kits/${names.join("|")}/`,
  en: `~/.fg/kits/${names.join("|")}/`,
});

export const parseArgDescriptions = {
  kit: {
    ru: "Какую дизайн-систему пересобрать: eds (1.x) или eds2 (2.x, ветка develop-2.0)",
    en: "Which design system to rebuild: eds (1.x) or eds2 (2.x, branch develop-2.0)",
  },
  /**
   * The default is NOT spelled out here.
   *
   * It lives on the adapter (`packages/fg-eds-adapter/src/index.ts`'s `EDS_SOURCE`) and differs
   * per kit, so a URL written into this sentence would be a second copy that goes stale the day
   * a second kit is registered — and the help page is exactly where a stale URL does the most
   * damage. What the sentence promises instead is that omitting the flag is the normal case.
   */
  source: {
    ru: "Откуда взять исходники кита: каталог на диске или ссылка на репозиторий (http(s)://…, git@…, file://…). Без флага берётся официальный репозиторий этой дизайн-системы",
    en: "Where the kit's sources come from: a directory on disk, or a repository link (http(s)://…, git@…, file://…). Without the flag, the design system's own repository is used",
  },
} as const satisfies Record<string, Localized>;

/**
 * THE PHASE LABELS. Seven, because five of them are the five extractors and a user watching a
 * two-minute run should be able to see which one is slow — `tokens` executes the theme, and
 * `components` and `kit-signatures` each load the kit through ts-morph.
 *
 * `extract` is a FUNCTION over the member name rather than five constants, so the list cannot
 * drift from `CORPUS_MEMBERS`: a sixth member would be a type error at the call site instead of
 * a phase that silently prints nothing.
 */
export const parsePhases = {
  fetch: { ru: "получение исходников", en: "fetching the sources" },
  upstream: { ru: "установка @v-uik", en: "installing @v-uik" },
  write: { ru: "запись корпуса", en: "writing the corpus" },
  /**
   * THE MEMBER'S OWN NAME, with no verb in front of it — and the reason is the column budget.
   *
   * The ledger row gives a label 23 columns and the live line gives it 16
   * (`packages/cli-kit/src/ui.ts`'s `ROW_LABEL`/`LIVE_LABEL`); «извлечение: kit-signatures» is
   * 26, so the elapsed glued straight onto the label with no space between them. The five
   * members are the five stages of the extraction the phase above already announced, and their
   * names are what a user watching a two-minute run is actually reading.
   */
  extract: (member: string): Localized => ({ ru: member, en: member }),
} as const;

/** `--parse-ui-kit` with no name. Names the accepted values, because that is the actionable half. */
export const missingKit = (names: readonly string[]): Localized => ({
  ru: `не указана дизайн-система: fg --parse-ui-kit <${names.join("|")}>`,
  en: `no design system given: fg --parse-ui-kit <${names.join("|")}>`,
});

/** A name nobody registered. A usage error: exit 2, with the accepted list. */
export const unknownParseKit = (value: string, names: readonly string[]): Localized => ({
  ru: `неизвестная дизайн-система: ${value}. Допустимые значения: ${names.join(", ")}`,
  en: `unknown design system: ${value}. Accepted values: ${names.join(", ")}`,
});

/**
 * `NpmError` → one localized sentence, per code. TOTAL BY TYPE over `NpmError["code"]`.
 *
 * `install-failed` appends npm's own words when there are any, for the same reason
 * `sourceFailure` appends git's: they are English and unlocalized, and «npm не смог установить»
 * without them tells a user nothing they can act on. Both arms explain WHY the command stopped
 * rather than degrading — see `parse-ui-kit.ts`'s header — because a user who is told only
 * "failed" will reasonably assume the tool could have carried on.
 */
export function npmFailure(error: NpmError): Localized {
  switch (error.code) {
    case "npm-not-installed": {
      return {
        ru: "для сборки корпуса нужен npm, но он не найден в PATH. Установите Node.js вместе с npm и повторите — без @v-uik корпус остался бы без данных о доступности и отступах, то есть беднее встроенного, поэтому он не записан",
        en: "building the corpus needs npm, and it is not on PATH. Install Node.js with npm and retry — without @v-uik the corpus would carry no accessibility or spacing evidence, making it poorer than the embedded snapshot, so nothing was written",
      };
    }
    case "install-failed": {
      const detail = error.detail;
      return {
        ru:
          `не удалось установить @v-uik${detail === undefined ? "" : `. npm сообщает: ${detail}`}` +
          ". Корпус не записан: без этого пакета он был бы беднее встроенного",
        en:
          `could not install @v-uik${detail === undefined ? "" : `. npm says: ${detail}`}` +
          ". Nothing was written: without that package the corpus would be poorer than the embedded snapshot",
      };
    }
  }
}

/** Anything else that failed after the line was accepted: the clone, an extractor, the write. */
export const failedToParse = (detail: string): Localized => ({
  ru: `не удалось собрать корпус: ${detail}`,
  en: `the corpus could not be built: ${detail}`,
});

export interface CorpusCounts {
  readonly kit: string;
  readonly version: string | null;
  readonly files: readonly string[];
}

/**
 * THE SUCCESS HEADLINE, above the list of absolute paths that `resultOf` puts under it
 * (`packages/cli-kit/src/out.ts`).
 *
 * The paths are NOT joined into the sentence, and absolutely rather than relative to anything:
 * five paths inside a Russian sentence is unreadable, and the shape this produces — a summary
 * line then a plain list — is what a shell user can pipe into `xargs` or paste into an editor.
 * Every command in this repo now ends this way; this one was simply first.
 */
export const corpusWritten = (counts: CorpusCounts): Localized => ({
  ru: `корпус собран, файлов: ${String(counts.files.length)}`,
  en: `the corpus is built, ${String(counts.files.length)} files`,
});

/* --------------------------------------------------------------------------------------- *
 * `fg.config.json` — the rule config file, `--lint`/`--format`, and `fg --init-config`.
 *
 * Same three rules as everything above: `ru` first and not as a translation, anything carrying a
 * runtime value is a FUNCTION returning `Localized`, and no sentence is assembled at a call site.
 * --------------------------------------------------------------------------------------- */

/**
 * The three arguments `--project-report` gained. Documented HERE, under the command, for the
 * reason `argDescriptions.uiKit` above states: they are not global options — `--config` and
 * `--lint` mean nothing to a pixso command — and `cli/src/parse.ts` declares them only so the
 * tokenizer knows `--config` and `--format` take a value.
 */
export const configArgDescriptions = {
  config: {
    ru: `Путь к файлу конфигурации правил (${CONFIG_FILE}). Без флага он ищется сначала в корне анализируемого проекта, затем в текущем каталоге; если нигде нет — работают значения по умолчанию`,
    en: `Path to the rule configuration file (${CONFIG_FILE}). Without the flag it is looked for in the analysed project's root first, then in the current directory; when neither has one, the built-in defaults apply`,
  },
  format: {
    ru: `Что произвести: ${REPORT_FORMATS.join(", ")} — несколько через запятую, порядок не важен, повторы игнорируются (по умолчанию ${DEFAULT_REPORT_FORMAT}). html — самодостаточный HTML-отчёт; compact — находки в консоль; json — массив в формате ESLint; sarif — SARIF 2.1.0 для IDE и CI`,
    en: `What to produce: ${REPORT_FORMATS.join(", ")} — several comma-separated, order irrelevant, duplicates ignored (default ${DEFAULT_REPORT_FORMAT}). html — a self-contained HTML report; compact — the findings in the console; json — an ESLint-shaped array; sarif — SARIF 2.1.0 for an IDE or CI`,
  },
} as const satisfies Record<string, Localized>;

/** `--config <path>` naming a file that is not there. The user promised it; exit 2. */
export const configNotFound = (path: string): Localized => ({
  ru: `файл конфигурации не найден: ${path}. Создать его: fg --init-config`,
  en: `configuration file not found: ${path}. Create one with: fg --init-config`,
});

/** The file is there and unreadable — a directory, a permission. Never a silent fallback. */
export const configUnreadable = (path: string, detail: string): Localized => ({
  ru: `не удалось прочитать файл конфигурации ${path}: ${detail}`,
  en: `the configuration file ${path} could not be read: ${detail}`,
});

/** Bad JSON. Node's own message names the offset better than a generic sentence could. */
export const configNotJson = (path: string, detail: string): Localized => ({
  ru: `файл конфигурации ${path} — не JSON: ${detail}`,
  en: `the configuration file ${path} is not JSON: ${detail}`,
});

/**
 * A place that must hold an object and does not. `where` is the dotted key path
 * (`analyzer.rules`), or `""` for the document itself.
 */
export const configNotAnObject = (path: string, where: string): Localized => ({
  ru:
    where === ""
      ? `файл конфигурации ${path} должен содержать объект JSON`
      : `в файле конфигурации ${path} значение ${where} должно быть объектом`,
  en:
    where === ""
      ? `the configuration file ${path} must contain a JSON object`
      : `in the configuration file ${path}, ${where} must be an object`,
});

/** A key inside `analyzer` nobody defined. Names the accepted set, because that is the fix. */
export const configUnknownKey = (
  path: string,
  key: string,
  allowed: readonly string[],
): Localized => ({
  ru: `неизвестный ключ в analyzer файла конфигурации ${path}: ${key}. Допустимые ключи: ${allowed.join(", ")}`,
  en: `unknown key in the analyzer section of ${path}: ${key}. Accepted keys: ${allowed.join(", ")}`,
});

/**
 * A level nobody defined. `where` is the exact key path, so a file with two hundred rules in it
 * still tells the user WHICH line to fix.
 */
export const configBadLevel = (path: string, where: string, value: unknown): Localized => ({
  ru: `в файле конфигурации ${path} значение ${where} = ${JSON.stringify(value)} не является уровнем. Допустимые уровни: ${FILE_LEVELS.join(", ")}`,
  en: `in the configuration file ${path}, ${where} = ${JSON.stringify(value)} is not a level. Accepted levels: ${FILE_LEVELS.join(", ")}`,
});

/** A category that does not exist. Unlike a rule id, the eight categories are a closed set. */
export const configBadCategory = (
  path: string,
  name: string,
  categories: readonly string[],
): Localized => ({
  ru: `в файле конфигурации ${path} нет такой категории: ${name}. Допустимые категории: ${categories.join(", ")}`,
  en: `the configuration file ${path} names a category that does not exist: ${name}. Accepted categories: ${categories.join(", ")}`,
});

export const configBadUiKit = (path: string): Localized => ({
  ru: `в файле конфигурации ${path} значение analyzer.uiKit должно быть непустой строкой — именем дизайн-системы`,
  en: `in the configuration file ${path}, analyzer.uiKit must be a non-empty string — a design system's name`,
});

export const configBadIgnore = (path: string): Localized => ({
  ru: `в файле конфигурации ${path} значение analyzer.ignore должно быть списком строк (шаблоны в синтаксисе .gitignore)`,
  en: `in the configuration file ${path}, analyzer.ignore must be an array of strings (gitignore-syntax patterns)`,
});

/**
 * RULE IDS THIS RUN CANNOT ACT ON — a warning in the UI's gutter, never a refusal (D8).
 *
 * One file is expected to serve projects built on different design systems, so a key naming an
 * EDS rule in a project without EDS is inert rather than wrong. The keys are LISTED because that
 * is what turns the same message into a typo report when the id is simply misspelled.
 */
export const configUnknownRules = (path: string, ids: readonly string[]): Localized => ({
  ru: `в файле конфигурации ${path} эти правила не применяются к текущему запуску (нет в каталоге правил): ${ids.join(", ")}`,
  en: `these rules in ${path} do not apply to this run (they are not in its rule catalogue): ${ids.join(", ")}`,
});

/**
 * `--format` given a name nobody implemented. Names the accepted list, like every other refusal.
 *
 * The list is passed IN rather than read from `REPORT_FORMATS` here, because the CLI refuses the
 * same value before the command ever runs (`cli/src/parse.ts`) and both refusals must be able to
 * quote the same set — the one the command declares in its `ArgSpec` (design U1).
 */
export const unknownFormat = (value: string, formats: readonly string[]): Localized => ({
  ru: `неизвестный формат: ${value}. Допустимые значения: ${formats.join(", ")}`,
  en: `unknown format: ${value}. Accepted values: ${formats.join(", ")}`,
});

/**
 * `-o` beside `--format compact` and nothing else — U9's one refusal.
 *
 * `compact` is a document for a terminal, not a file: there is nothing for `-o` to name, and
 * silently ignoring a destination the user typed is exactly the defect V3 MAJOR-1 removed.
 */
export const outWithoutFile: Localized = {
  ru: "-o нечего записывать: формат compact печатается в stdout. Добавьте формат-файл (--format compact,html) или уберите -o",
  en: "-o has nothing to write: the compact format goes to stdout. Add a file format (--format compact,html) or drop -o",
};

/**
 * WHERE THE RULES CAME FROM — the note §2.6 draws as `· конфиг: /abs/path/fg.config.json`.
 *
 * Printed only when a FILE was found: «по умолчанию» is the summary block's business (the
 * `скрыто` row states it there), and a note saying "nothing was configured" before every run
 * would be a line that never carries news.
 */
export const configSource = (path: string): Localized => ({
  ru: `конфиг: ${path}`,
  en: `config: ${path}`,
});

/* ── `fg --init-config` ─────────────────────────────────────────────────────────────────── */

export const initConfigSummary: Localized = {
  ru: `создать ${CONFIG_FILE} и схему`,
  en: `write ${CONFIG_FILE} and its schema`,
};

/** The paragraph `fg --help --iconf` prints (design 2.8); the old long summary, moved. */
export const initConfigDetails: Localized = {
  ru: `Создать ${CONFIG_FILE} и ${CONFIG_SCHEMA_FILE} со всеми правилами выбранной дизайн-системы — каждое можно выключить или переоценить.`,
  en: `Write ${CONFIG_FILE} and ${CONFIG_SCHEMA_FILE} listing every rule of the selected design system — each one can be switched off or re-graded.`,
};

/** The `без -o →` column (design 2.7). */
export const initConfigDefaultOut: Localized = {
  ru: `./${CONFIG_FILE}`,
  en: `./${CONFIG_FILE}`,
};

export const initConfigArgDescriptions = {
  out: {
    ru: `Куда записать конфигурацию. Необязателен: без него — ./${CONFIG_FILE}; ${CONFIG_SCHEMA_FILE} кладётся рядом; недостающие каталоги будут созданы`,
    en: `Where to write the configuration. Optional: without it, ./${CONFIG_FILE}; ${CONFIG_SCHEMA_FILE} lands beside it; missing directories are created`,
  },
  uiKit: {
    ru: `Правила какой дизайн-системы включить в файл: ${adapterNames().join(", ")}. Без флага она определяется по зависимостям проекта в текущем каталоге; если ничего не подошло — в файл попадут только общие правила`,
    en: `Whose design-system rules to list in the file: ${adapterNames().join(", ")}. Without the flag it is detected from the current directory's project dependencies; when nothing matches, only the generic rules are listed`,
  },
} as const satisfies Record<string, Localized>;

/** The file is already there. Exit 2, and NOTHING is written — a config is hand-edited work. */
export const configExists = (path: string): Localized => ({
  ru: `файл уже существует: ${path}. Удалите или переименуйте его, либо укажите другой путь через -o — команда никогда не перезаписывает конфигурацию`,
  en: `the file already exists: ${path}. Remove it, rename it, or name another path with -o — this command never overwrites a configuration`,
});

export interface InitConfigCounts {
  /** Finding-level rule ids written into `analyzer.rules`. */
  readonly rules: number;
  /** `<rule>/<subrule>` keys written alongside them. */
  readonly subrules: number;
}

/**
 * `✔ конфигурация создана    32 правила · 30 подправил` — design §2.5, verbatim.
 *
 * TWO FIXES IN ONE LINE. The counts were spelled `32 правил`, a hardcoded genitive plural used
 * for every number, while the pluraliser for exactly that noun sits sixty lines above
 * (V5 finding #11 — the README wrote «32 правила» and the binary disagreed). And the headline
 * joined them with a colon; §2.5 joins them with a column of spaces, because a colon makes the
 * counts part of the sentence and the design makes them a value beside it (finding #22).
 */
export const initConfigWritten = (counts: InitConfigCounts): Localized => {
  const gap = "    ";
  const ru =
    `${String(counts.rules)} ${ruPlural(counts.rules, ["правило", "правила", "правил"])} · ` +
    `${String(counts.subrules)} ${ruPlural(counts.subrules, ["подправило", "подправила", "подправил"])}`;
  const en =
    `${String(counts.rules)} ${counts.rules === 1 ? "rule" : "rules"} · ` +
    `${String(counts.subrules)} ${counts.subrules === 1 ? "sub-rule" : "sub-rules"}`;
  return {
    ru: `конфигурация создана${gap}${ru}`,
    en: `configuration written${gap}${en}`,
  };
};

/**
 * Nothing matched in the current directory, so the file lists the generic rules only.
 *
 * A NOTE rather than a refusal: a config for the generic rules is a perfectly good config, and a
 * user running this outside a project is doing something legitimate. What they must not do is
 * discover the kit rules are missing later, from an empty section.
 */
export const initConfigNoKit = (names: readonly string[]): Localized => ({
  ru: `дизайн-система не определена по зависимостям текущего каталога — в файл вошли только общие правила. Указать явно: --ui-kit ${names.join("|")}`,
  en: `no design system was detected from the current directory's dependencies — only the generic rules are listed. Name one with --ui-kit ${names.join("|")}`,
});

/** Anything that failed after the line was accepted: the read of a manifest, the write. */
export const initConfigFailed = (detail: string): Localized => ({
  ru: `не удалось создать конфигурацию: ${detail}`,
  en: `the configuration could not be written: ${detail}`,
});

/**
 * `--init-config`'s two phases. Two, because two are what a user can wait on: reading the
 * current directory's manifest to decide which design system's rules go into the file, and
 * writing the pair. `phases.write` is reused rather than re-spelled — "Запись" is the same
 * event, and a second spelling of it would be a second string to translate.
 */
export const initConfigPhases = {
  detect: { ru: "выбор дизайн-системы", en: "selecting the design system" },
  write: phases.write,
} as const satisfies Record<string, Localized>;

/* ── The generated JSON Schema's own text (`config/files.ts`) ───────────────────────────── */

/**
 * THE SCHEMA IS UI, so its text is `Localized` like every other string in this file.
 *
 * `fg.config.schema.json` is not an internal artifact: its `title` and its `description`s are
 * what an editor shows while somebody edits the config — the hover text is the feature's
 * primary in-editor documentation. Written in Russian only, it made `--lang en` a half
 * translation, which PROTOCOL §4 ("all user-facing strings `Localized {ru,en}`") does not allow.
 *
 * ONE THING STAYS RUSSIAN ON PURPOSE: the rule's own `description` interpolated into
 * {@link schemaKeyDescription}. That text comes from the engine's catalog, which has exactly one
 * language, and inventing an English paraphrase here would be a second, drifting copy of it.
 * What is localized is the WRAPPER — «встроенный уровень: error — …» / «built-in level: error —
 * …» — which is this package's sentence about the catalog's, not the catalog's own.
 */
export const schemaTitle: Localized = {
  ru: "fg — конфигурация правил анализа проекта",
  en: "fg — rule configuration for the project analysis",
};

export const schemaAnalyzer: Localized = {
  ru: "Что и как проверяет fg --project-report",
  en: "What fg --project-report checks, and how",
};

export const schemaUiKit: Localized = {
  ru: "Дизайн-система, правила которой учитывать. Флаг --ui-kit важнее этого значения",
  en: "The design system whose rules to apply. The --ui-kit flag wins over this value",
};

export const schemaIgnore: Localized = {
  ru: "Дополнительные шаблоны игнорирования в синтаксисе .gitignore",
  en: "Extra ignore patterns, in .gitignore syntax",
};

export const schemaDefault: Localized = {
  ru: `Уровень для всего, что не названо явно. Последняя ступень: ${INHERIT_LEVEL} здесь означает on`,
  en: `The level for everything not named explicitly. The last scope: ${INHERIT_LEVEL} here means on`,
};

export const schemaCategories: Localized = {
  ru: "Уровень для целой категории находок. Важнее default, но слабее строки в rules, если та не inherit",
  en: "The level for a whole finding category. Beats default, loses to a rules row unless that row is inherit",
};

export const schemaRules: Localized = {
  ru: "Уровень для правила, для группы правил по префиксу (style.override) или для подправила (a11y.lint/alt-text). Важнее категории и default; inherit означает «нет мнения» — тогда решает категория",
  en: "The level for one rule, for a group of rules by prefix (style.override) or for a sub-rule (a11y.lint/alt-text). Beats the category and default; inherit means «no opinion» — the category then decides",
};

/** `"mixed"` is not a severity anyone can act on: it is spelled as what it means. */
export const schemaMixedSeverity: Localized = {
  ru: "зависит от находки",
  en: "depends on the finding",
};

/**
 * «встроенный уровень: error — Кнопка без доступного имени…» — one line, for an editor's hover.
 *
 * `description` is the catalog's own Russian text (see the section header); the sentence around
 * it is this package's, and follows `--lang`.
 */
export const schemaKeyDescription = (builtin: string, description: string): Localized => ({
  ru: `встроенный уровень: ${builtin} — ${description}`,
  en: `built-in level: ${builtin} — ${description}`,
});
