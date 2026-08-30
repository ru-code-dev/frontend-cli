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
import type { SourceError } from "@smart-tools/fe-source";

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
    ru: "Куда записать HTML-отчёт, например ./report.html. Обязателен; недостающие каталоги будут созданы",
    en: "Where to write the HTML report, e.g. ./report.html. Required; missing directories are created",
  },
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

/** `--project-report` without `-o`. The report is a FILE; there is no stdout form of it. */
export const missingOut: Localized = {
  ru: "нужен файл назначения: -o <файл.html>. Отчёт — это один самодостаточный HTML-файл, в stdout он не выводится",
  en: "a destination file is required: -o <file.html>. The report is one self-contained HTML file and is never written to stdout",
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

/** What the run found. Counts of what it looked at and what it saw. */
export interface ReportCounts {
  readonly out: string;
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
  ru: `отчёт готов → ${counts.out}: находок ${String(counts.findings)} (ошибок ${String(counts.errors)}, предупреждений ${String(counts.warnings)}), просмотрено файлов ${String(counts.files)}`,
  en: `report ready → ${counts.out}: ${String(counts.findings)} findings (${String(counts.errors)} errors, ${String(counts.warnings)} warnings), ${String(counts.files)} files scanned`,
});
