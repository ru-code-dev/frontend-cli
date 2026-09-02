/**
 * EVERY user-facing string this package can ever print, in both languages, in one file.
 *
 * The arrangement and its reasoning are `packages/fe-pixso/src/strings.ts:1-14`'s, and they are
 * followed rather than re-derived: multilingual UX is a contract-level fact
 * (`WORKFLOW/features/initial-analysis/plans/2.1-design.md:127-132`), the `Localized` type is
 * the enforcement (`packages/cli-kit/src/index.ts:25-28`), `ru` is the product default and is
 * therefore written FIRST and never as a translation of the English, and anything carrying a
 * runtime value is a FUNCTION returning `Localized` rather than a template assembled at the
 * call site — interpolating at the call site is how one of the two languages quietly stops
 * being rendered.
 *
 * THE ERROR MAP IS TOTAL BY TYPE. `sourceFailure` below switches on `SourceErrorCode`
 * (`packages/fe-source/src/errors.ts:36-40`) with no `default` arm, so adding a fifth code to
 * `fe-source` breaks the build here instead of reaching a user as a generic sentence. That is
 * the whole reason B1 refused to ship user-facing text of its own: "NO user-facing strings …
 * Localized ru+en wording is the feature package's job, built from `code`"
 * (`WORKFLOW/features/hackathon-analys/reports/b1-fe-source.md:113-117`).
 */
import type { Localized } from "@smart-tools/fe-cli-kit";
import { FE_OUT_DIR } from "@smart-tools/fe-cli-kit";
import type { CorpusProvenance, CorpusWarning, NpmError } from "@smart-tools/fe-eds-adapter";
import type { SourceError } from "@smart-tools/fe-source";

import { adapterNames } from "./adapters.ts";

export const summary: Localized = {
  ru: "Отчёт по фронтенд-проекту (доступность, компоненты, иконки) — один самодостаточный HTML-файл",
  en: "Front-end project report (accessibility, components, icons) — one self-contained HTML file",
};

export const argDescriptions = {
  source: {
    ru: "Каталог проекта на диске или ссылка на репозиторий (http(s)://…, git@…, file://…) — он будет клонирован во временный каталог и удалён после анализа",
    en: "A project directory on disk, or a repository link (http(s)://…, git@…, file://…) — it is cloned into a temporary directory and removed after the analysis",
  },
  out: {
    ru: `Куда записать HTML-отчёт, например ./report.html. Необязателен: без него — ./${FE_OUT_DIR}/report.html; недостающие каталоги будут созданы`,
    en: `Where to write the HTML report, e.g. ./report.html. Optional: without it, ./${FE_OUT_DIR}/report.html; missing directories are created`,
  },
  /**
   * The accepted values are BUILT from the registry, not typed out: a design system added to
   * `adapters.ts` documents itself in `fe --help`, in both languages, without this file being
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
  resolve: { ru: "Подготовка проекта", en: "Fetching the project" },
  scan: { ru: "Чтение файлов", en: "Reading files" },
  rules: { ru: "Проверки", en: "Running checks" },
  render: { ru: "Сборка отчёта", en: "Building the report" },
  write: { ru: "Запись", en: "Writing" },
} as const satisfies Record<string, Localized>;

/**
 * No positional at all. Names BOTH accepted forms, for the reason
 * `packages/fe-pixso/src/strings.ts:66-70` gives: the error is the only place a user who typed
 * the line wrong will look, so it teaches the surface rather than reporting an absence.
 */
export const missingSource: Localized = {
  ru: "не указан проект: передайте каталог на диске либо ссылку на репозиторий (http(s)://…, git@…, file://…)",
  en: "no project given: pass a directory on disk or a repository link (http(s)://…, git@…, file://…)",
};

/**
 * `SourceError` → one localized sentence, per code.
 *
 * `clone-failed` appends git's own words when there are any. They are English and
 * unlocalized — which is exactly why B1 parked them on a separate field rather than making
 * them the error (`packages/fe-source/src/errors.ts:74`,
 * `WORKFLOW/features/hackathon-analys/reports/b1-fe-source.md:119-126`) — but «git не смог
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

/**
 * What the run found. Counts of what it looked at and what it saw.
 *
 * NO `out` FIELD any more, and its absence is the contract: the path is a RESULT LINE under the
 * headline, put there by cli-kit's `resultOf` (`packages/cli-kit/src/out.ts`), not a value
 * spliced into a sentence. A builder that still took the path would let one command print it
 * inside the sentence while the rest print it below, which is exactly the drift the one output
 * shape exists to prevent.
 */
export interface ReportCounts {
  readonly findings: number;
  readonly errors: number;
  readonly warnings: number;
  readonly files: number;
}

/**
 * THE SUCCESS LINE — one line, on stdout, exit 0 even when the report is full of violations.
 *
 * Findings are the PRODUCT here, not a failure: this command reports on a project, it does not
 * gate one (brief B4 deliverable 1). So the counts are stated plainly and the exit code stays
 * 0; a caller that wants a gate reads the numbers in the payload.
 */
export const reportWritten = (counts: ReportCounts): Localized => ({
  ru: `отчёт готов: находок ${String(counts.findings)} (ошибок ${String(counts.errors)}, предупреждений ${String(counts.warnings)}), просмотрено файлов ${String(counts.files)}`,
  en: `report ready: ${String(counts.findings)} findings (${String(counts.errors)} errors, ${String(counts.warnings)} warnings), ${String(counts.files)} files scanned`,
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
  how: "flag" | "autodetect",
): Localized => ({
  ru:
    `дизайн-система: ${name} ${provenanceLabel(provenance).ru} — ` +
    (how === "flag" ? "выбрана флагом --ui-kit" : "определена по зависимостям проекта"),
  en:
    `design system: ${name} ${provenanceLabel(provenance).en} — ` +
    (how === "flag" ? "selected with --ui-kit" : "detected from the project's dependencies"),
});

/**
 * WHICH SNAPSHOT, as the half-sentence that follows the design system's name.
 *
 * The version printed here is the DESIGN SYSTEM's (`1.13.0`), not the adapter package's. Those
 * are two different numbers and the notice used to print the second one, which answered a
 * question nobody asks: a reader wants to know which EDS a report measured against, and
 * `fe-eds-adapter@0.1.0` does not say. The package version is still carried on
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
 * (`packages/fe-analyzer-report/src/contract.ts:206`), a contract the dashboard reads. Rather
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
 * follows: adding a third reason to `fe-eds-adapter` breaks the build here rather than reaching
 * a user as a generic sentence. Both arms NAME THE FILE, because the whole value of the message
 * is telling someone which of five files to look at or delete.
 */
export function corpusWarning(kit: string, warning: CorpusWarning): Localized {
  switch (warning.reason) {
    case "incomplete": {
      return {
        ru: `корпус ${kit} неполон: нет файла ${warning.file} — используется встроенный снимок. Соберите корпус заново: fe --parse-ui-kit ${kit}`,
        en: `the ${kit} corpus is incomplete: ${warning.file} is missing — using the embedded snapshot instead. Regenerate it with: fe --parse-ui-kit ${kit}`,
      };
    }
    case "invalid": {
      const detail = warning.detail;
      return {
        ru:
          `файл корпуса ${kit} не прошёл проверку: ${warning.file}` +
          (detail === undefined ? "" : ` (${detail})`) +
          `. Используется встроенный снимок. Соберите корпус заново: fe --parse-ui-kit ${kit}`,
        en:
          `a ${kit} corpus file failed validation: ${warning.file}` +
          (detail === undefined ? "" : ` (${detail})`) +
          `. Using the embedded snapshot instead. Regenerate it with: fe --parse-ui-kit ${kit}`,
      };
    }
  }
}

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
 * `fe --parse-ui-kit <name>` — the corpus regeneration command.
 *
 * Same three rules as everything above: `ru` first and not as a translation, anything carrying a
 * runtime value is a FUNCTION returning `Localized`, and every error map is total by TYPE rather
 * than by a `default` arm.
 * --------------------------------------------------------------------------------------- */

export const parseSummary: Localized = {
  ru: "Пересобрать корпус дизайн-системы из её исходников — пять JSON-файлов в ~/.fe/kits/<имя>/",
  en: "Rebuild a design system's corpus from its sources — five JSON files in ~/.fe/kits/<name>/",
};

export const parseArgDescriptions = {
  kit: {
    ru: "Какую дизайн-систему пересобрать. Сегодня поддерживается только eds",
    en: "Which design system to rebuild. Only eds is supported today",
  },
  /**
   * The default is NOT spelled out here.
   *
   * It lives on the adapter (`packages/fe-eds-adapter/src/index.ts`'s `EDS_SOURCE`) and differs
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
  fetch: { ru: "Получение исходников", en: "Fetching the sources" },
  upstream: { ru: "Установка @v-uik", en: "Installing @v-uik" },
  write: { ru: "Запись корпуса", en: "Writing the corpus" },
  extract: (member: string): Localized => ({
    ru: `Извлечение: ${member}`,
    en: `Extracting: ${member}`,
  }),
} as const;

/** `--parse-ui-kit` with no name. Names the accepted values, because that is the actionable half. */
export const missingKit = (names: readonly string[]): Localized => ({
  ru: `не указана дизайн-система: fe --parse-ui-kit <${names.join("|")}>`,
  en: `no design system given: fe --parse-ui-kit <${names.join("|")}>`,
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
  ru: `корпус ${counts.kit}${counts.version === null ? "" : ` ${counts.version}`} собран, файлов: ${String(counts.files.length)}`,
  en: `the ${counts.kit}${counts.version === null ? "" : ` ${counts.version}`} corpus is built, ${String(counts.files.length)} files`,
});
