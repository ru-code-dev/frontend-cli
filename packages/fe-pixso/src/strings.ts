/**
 * EVERY user-facing string this package can ever print, in both languages, in one file.
 *
 * Why they live here and not in `cli`: design 2.1:129-131 makes multilingual UX a
 * contract-level fact ("feature packages ship their own strings"), and the `Localized` type
 * the frozen contract uses for `summary`/`description` (`packages/cli-kit/src/index.ts:25-28`)
 * is the enforcement — a command that shipped only an English summary would not compile.
 * `ru` is the product default (design 2.1:127-128), so `ru` is written first everywhere below
 * and is never a translation of the English: both are written for their own reader.
 *
 * The entries that carry a runtime value are FUNCTIONS returning `Localized`, not templates
 * assembled at the call site — interpolating at the call site is how one of the two languages
 * quietly stops being rendered.
 */
import type { Localized } from "@smart-tools/fe-cli-kit";

import { ASSET_FILES, DEFAULT_DIR, FACE_EXTENSION } from "./out.ts";

/**
 * THE PHASE LABELS — what the progress line calls each stage of a run.
 *
 * They are `Localized` for the same reason every other string here is: `--lang` has to reach
 * them, and `CommandUi.phase` takes a `Localized` precisely so it cannot be handed a bare
 * English word (`packages/cli-kit/src/ui.ts`). They are SHORT because the bar gives a label 22
 * columns and truncates past that (`install:267`, ported at `packages/cli-kit/src/ui.ts`'s
 * `LABEL_WIDTH`) — a phase name is a signpost, not a sentence.
 *
 * The four are the four things a face command actually does, in the order it does them:
 * decide the route, fetch and parse the design, render the face, put the bytes somewhere.
 */
export const phases = {
  route: { ru: "Разбор источника", en: "Reading the source" },
  fetch: { ru: "Загрузка макета", en: "Fetching the design" },
  render: { ru: "Рендер", en: "Rendering" },
  write: { ru: "Запись", en: "Writing" },
} as const satisfies Record<string, Localized>;

/** The three owner-fixed names, quoted inside the missing-token message. Kept as one string
 *  so the message and `runtime.ts`'s reader can never disagree about the spelling. */
const TOKEN_KEY = "PIXSO_REMOTE_MCP_TOKEN";

/**
 * THE COMMAND SUMMARIES — and each of the four names its own default, because that is the
 * question a user asks first now that `-o` is optional and a bare run writes a file.
 *
 * The directory and the extensions are READ from `out.ts` (`DEFAULT_DIR`, `FACE_EXTENSION`)
 * rather than typed here: the help page is exactly where a stale path does the most damage,
 * and the whole point of `out.ts` is that one module decides where bytes go. Only `<имя>` /
 * `<name>` is a literal, because it is a placeholder no function returns.
 */
export const summaries = {
  svg: {
    ru: `SVG-рендер кадра Pixso. Без -o → ./${DEFAULT_DIR}/<имя>${FACE_EXTENSION.svg}`,
    en: `Render the Pixso frame as SVG. Without -o → ./${DEFAULT_DIR}/<name>${FACE_EXTENSION.svg}`,
  },
  html: {
    ru: `HTML-рендер кадра Pixso. Без -o → ./${DEFAULT_DIR}/<имя>${FACE_EXTENSION.html}`,
    en: `Render the Pixso frame as HTML. Without -o → ./${DEFAULT_DIR}/<name>${FACE_EXTENSION.html}`,
  },
  prompt: {
    ru: `Markdown-промпт по кадру Pixso. Без -o → ./${DEFAULT_DIR}/<имя>${FACE_EXTENSION.prompt}`,
    en: `Build the Markdown prompt for the Pixso frame. Without -o → ./${DEFAULT_DIR}/<name>${FACE_EXTENSION.prompt}`,
  },
  assets: {
    ru: `Один скан → четыре файла (${ASSET_FILES.svg}, ${ASSET_FILES.html}, ${ASSET_FILES.prompt}, ${ASSET_FILES.meta}). Без -o → ./${DEFAULT_DIR}/<имя>/`,
    en: `One scan → four files (${ASSET_FILES.svg}, ${ASSET_FILES.html}, ${ASSET_FILES.prompt}, ${ASSET_FILES.meta}). Without -o → ./${DEFAULT_DIR}/<name>/`,
  },
} as const satisfies Record<string, Localized>;

export const argDescriptions = {
  /** The positional. Both accepted forms are named — the same two the missing-source error
   *  names, because a user who reads one and not the other must still learn both. */
  source: {
    ru: "Ссылка на дизайн http(s)://… (удалённый маршрут) или guid узла, например 11:10 (локальный маршрут)",
    en: "A design link http(s)://… (remote route) or a node guid such as 11:10 (local route)",
  },
  out: {
    ru: `Куда записать файл. Необязателен: без него — ./${DEFAULT_DIR}/<имя>.<расширение>, где <имя> — guid узла (11:10 → 11-10) или item-id из ссылки; недостающие каталоги будут созданы`,
    en: `Where to write the file. Optional: without it, ./${DEFAULT_DIR}/<name>.<ext>, where <name> is the node guid (11:10 → 11-10) or the link's item-id; missing directories are created`,
  },
  outDir: {
    ru: `Каталог, куда лягут четыре файла. Необязателен: без него — ./${DEFAULT_DIR}/<имя>/; недостающие каталоги будут созданы`,
    en: `The directory the four files are written into. Optional: without it, ./${DEFAULT_DIR}/<name>/; missing directories are created`,
  },
} as const satisfies Record<string, Localized>;

/**
 * No source argument at all. Names BOTH accepted forms, as briefed — the error is the only
 * place a user who typed the command wrong will look, so it teaches the surface rather than
 * reporting the absence.
 */
export const missingSource: Localized = {
  ru: "не указан источник: нужна ссылка на дизайн Pixso (http(s)://…) либо guid узла, например 11:10",
  en: "no source given: pass a Pixso design link (http(s)://…) or a node guid such as 11:10",
};

/**
 * A design link was given but no token was resolved. ACTIONABLE: all three ways to supply
 * one, in the precedence order the cli applies them (design 2.1:110-111).
 */
export const missingToken: Localized = {
  ru:
    `для ссылки на дизайн нужен токен удалённого MCP. Задайте его любым из трёх способов: ` +
    `флаг --token <значение>; переменная окружения ${TOKEN_KEY}; ` +
    `строка ${TOKEN_KEY}=<значение> в файле .env рядом с местом запуска`,
  en:
    `a design link needs the remote MCP token. Supply it any of three ways: ` +
    `the --token <value> flag; the ${TOKEN_KEY} environment variable; ` +
    `a ${TOKEN_KEY}=<value> line in a .env file next to where you run`,
};

/** Anything the engine threw — a bad link, a refused scan, a dead endpoint, a failed write. */
export const failed = (detail: string): Localized => ({
  ru: `не удалось выполнить команду: ${detail}`,
  en: `the command failed: ${detail}`,
});

/**
 * THE RESULT HEADLINE — how many files, and nothing else.
 *
 * The paths are NOT in the sentence. They are the lines under it, put there by cli-kit's
 * `resultOf` (`packages/cli-kit/src/out.ts`), which is the one output shape every command in
 * this repo now ends with. That is why this builder takes a COUNT rather than a path: a
 * headline that also named the file would print it twice, and at four files it would print a
 * sentence nobody can read.
 *
 * Russian counts, so the plural is chosen rather than templated — «1 файл», «4 файла». The
 * three forms are the ones this command can actually produce (1 or 4), plus the general case,
 * because a rule that only covers today's two numbers is a rule that breaks on the third.
 */
export const wroteFiles = (count: number): Localized => ({
  ru: `готово, записано ${String(count)} ${plural(count)}`,
  en: `done, ${String(count)} ${count === 1 ? "file" : "files"} written`,
});

/** Russian plural for «файл», by the standard rule (1 файл / 2-4 файла / 5+ файлов, with the
 *  11-14 exception that makes the naive `n % 10` version wrong). */
function plural(count: number): string {
  const n = Math.abs(count) % 100;
  if (n >= 11 && n <= 14) return "файлов";
  switch (n % 10) {
    case 1:
      return "файл";
    case 2:
    case 3:
    case 4:
      return "файла";
    default:
      return "файлов";
  }
}
