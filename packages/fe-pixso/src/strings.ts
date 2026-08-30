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

/** The four filenames `--get-pixso-assets` writes. Named once; the command reads them from
 *  here and so does its test, so a rename cannot pass silently (design 2.1:99-102). */
export const ASSET_FILES = {
  svg: "card.svg",
  html: "card.html",
  prompt: "card.md",
  meta: "card.json",
} as const;

/** The three owner-fixed names, quoted inside the missing-token message. Kept as one string
 *  so the message and `runtime.ts`'s reader can never disagree about the spelling. */
const TOKEN_KEY = "PIXSO_REMOTE_MCP_TOKEN";

export const summaries = {
  svg: {
    ru: "SVG-рендер кадра Pixso — в stdout или в файл через -o",
    en: "Render the Pixso frame as SVG — to stdout, or to a file with -o",
  },
  html: {
    ru: "HTML-рендер кадра Pixso — в stdout или в файл через -o",
    en: "Render the Pixso frame as HTML — to stdout, or to a file with -o",
  },
  prompt: {
    ru: "Markdown-промпт по кадру Pixso — в stdout или в файл через -o",
    en: "Build the Markdown prompt for the Pixso frame — to stdout, or to a file with -o",
  },
  assets: {
    ru: `Один скан → четыре файла (${ASSET_FILES.svg}, ${ASSET_FILES.html}, ${ASSET_FILES.prompt}, ${ASSET_FILES.meta}) в каталог -o`,
    en: `One scan → four files (${ASSET_FILES.svg}, ${ASSET_FILES.html}, ${ASSET_FILES.prompt}, ${ASSET_FILES.meta}) into the -o directory`,
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
    ru: "Куда записать байты. Без -o они идут в stdout",
    en: "Where to write the bytes. Without -o they go to stdout",
  },
  outDir: {
    ru: "Каталог, куда лягут четыре файла. Обязателен",
    en: "The directory the four files are written into. Required",
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

/** `--get-pixso-assets` without `-o`. The directory is required (design 2.1:99-102). */
export const missingOutDir: Localized = {
  ru: `нужен каталог назначения: -o <каталог>. Туда будут записаны четыре файла: ${ASSET_FILES.svg}, ${ASSET_FILES.html}, ${ASSET_FILES.prompt}, ${ASSET_FILES.meta}`,
  en: `a destination directory is required: -o <dir>. Four files are written there: ${ASSET_FILES.svg}, ${ASSET_FILES.html}, ${ASSET_FILES.prompt}, ${ASSET_FILES.meta}`,
};

/** Anything the engine threw — a bad link, a refused scan, a dead endpoint, a failed write. */
export const failed = (detail: string): Localized => ({
  ru: `не удалось выполнить команду: ${detail}`,
  en: `the command failed: ${detail}`,
});

/** One file written. */
export const wrote = (path: string): Localized => ({
  ru: `записано → ${path}`,
  en: `wrote → ${path}`,
});

/** The four-file set written. */
export const wroteAssets = (dir: string): Localized => ({
  ru: `записано 4 файла → ${dir}`,
  en: `wrote 4 files → ${dir}`,
});
