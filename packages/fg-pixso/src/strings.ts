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
import type { CommandGroup, Localized } from "@smart-tools/fg-cli-kit";

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
 * THREE, not four. `route` used to be one, and announcing it opened a live progress line ahead
 * of the header — which design §2.1 makes "the first thing a command prints" (V5 finding #3).
 * `resolveRoute` is a pure read of the string the user typed: it waits on nothing, so there was
 * nothing for a phase to report. What is left is the three things a command actually waits on.
 */
export const phases = {
  fetch: { ru: "загрузка", en: "fetch" },
  render: { ru: "рендер", en: "render" },
  write: { ru: "запись", en: "write" },
} as const satisfies Record<string, Localized>;

/**
 * The unit beside the write phase's counter — `2/4 файла` reads; `2/4` alone does not.
 *
 * A FUNCTION OF THE COUNT, because Russian agrees the noun with the number: a fixed genitive
 * singular printed `9/9 файла` for every run (V5 finding #20). The count it agrees with is the
 * phase's TOTAL, which is what the finished non-TTY row states — the same rule
 * `fg-project-report`'s `phaseUnits` follows, and the same CLDR one/few/many table. Restated
 * here rather than imported because these two packages share no dependency but `cli-kit`, which
 * is types and a renderer and has no vocabulary of its own.
 */
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
  out: { ru: "-o <путь>", en: "-o <path>" },
  outDir: { ru: "-o <каталог>", en: "-o <dir>" },
} as const satisfies Record<string, Localized>;

export const fileUnit = (count: number): Localized => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const ru =
    mod10 === 1 && mod100 !== 11
      ? "файл"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "файла"
        : "файлов";
  return { ru, en: count === 1 ? "file" : "files" };
};

/**
 * THE HEADER'S SECOND PART — which of the two routes this run took (design 2.1, 2.5).
 *
 * It is in the header rather than in a phase line because it is a FACT ABOUT THE RUN, not a step
 * of it: a user reading `fg v1.0.0 · psvg · локальный маршрут · 11:10` knows immediately which
 * endpoint was contacted and for what, which is exactly the question a failed fetch raises.
 */
export const routeLabels = {
  local: { ru: "локальный маршрут", en: "local route" },
  remote: { ru: "удалённый маршрут", en: "remote route" },
} as const satisfies Record<string, Localized>;

/**
 * THE HELP GROUP these four commands appear under (design 2.7's first block).
 *
 * It is carried by the commands themselves rather than listed in `cli`: the help collects the
 * groups off the registry, so a feature package introduces its own section and a section with no
 * commands cannot exist (`packages/cli-kit/src/index.ts`'s `CommandGroup`).
 */
export const pixsoGroup: CommandGroup = {
  id: "pixso",
  title: { ru: "Pixso: макет → код", en: "Pixso: design → code" },
  order: 1,
};

/** The summary block's row keys — design 2.5 names them `svg`/`html`/`md`/`json`. */
export const rowKeys = {
  svg: { ru: "svg", en: "svg" },
  html: { ru: "html", en: "html" },
  md: { ru: "md", en: "md" },
  json: { ru: "json", en: "json" },
} as const satisfies Record<string, Localized>;

/** The summary headline every pixso command ends with (design 2.5). */
export const ready: Localized = { ru: "готово", en: "done" };

/** The three owner-fixed names, quoted inside the missing-token message. Kept as one string
 *  so the message and `runtime.ts`'s reader can never disagree about the spelling. */
const TOKEN_KEY = "PIXSO_REMOTE_MCP_TOKEN";

/**
 * HOW A DESIGN LINK IS SPELLED WHEREVER ONE IS SHOWN RATHER THAN USED — owner's decision.
 *
 * The remote route is the MAIN story of all four commands, so every example, every argument
 * description and every refusal that has to NAME a link names this placeholder instead of
 * printing a URL. A literal `https://pixso.net/app/editor/…?item-id=4711` in a help page is a
 * string a reader tries to copy: it is not their file, the ellipsis is not typeable, and the
 * item-id is someone else's frame. `<pixso-link>` says what to paste — the link Pixso's own
 * «Поделиться → Копировать ссылку» puts on the clipboard — and says it in one token that
 * cannot be mistaken for a working address.
 *
 * ONE SPELLING, one constant: the help examples (`./commands.ts`), the argument table and the
 * two refusals below all read it from here, and `docs/manual/pixso.md` + `README.md` spell the
 * same token. The e2e gallery masks a real link down to this same string on a card's prompt
 * line (`packages/testkit/tests/consoleGallery.ts`'s display rule) — so what a reader sees in
 * the documentation and what they see in a screenshot are the same word.
 *
 * NOT localized, deliberately: it is a placeholder for a URL, the same token in both languages,
 * exactly like the `<pixso-link|guid>` the usage line carries.
 */
export const PIXSO_LINK = "<pixso-link>";

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
  svg: { ru: "SVG кадра", en: "the frame as SVG" },
  html: { ru: "HTML кадра", en: "the frame as HTML" },
  prompt: { ru: "Markdown-промпт", en: "a Markdown prompt" },
  assets: { ru: "svg + html + md + json", en: "svg + html + md + json" },
} as const satisfies Record<string, Localized>;

/**
 * THE `без -o →` COLUMN — where each command writes when the user named nothing (design 2.7).
 *
 * The directory and the extensions are READ from `out.ts` rather than typed here: the help page
 * is exactly where a stale path does the most damage, and the whole point of `out.ts` is that one
 * module decides where bytes go. Only `<имя>` / `<name>` is a literal, because it is a
 * placeholder no function returns.
 */
export const defaultOuts = {
  svg: {
    ru: `./${DEFAULT_DIR}/<имя>${FACE_EXTENSION.svg}`,
    en: `./${DEFAULT_DIR}/<name>${FACE_EXTENSION.svg}`,
  },
  html: {
    ru: `./${DEFAULT_DIR}/<имя>${FACE_EXTENSION.html}`,
    en: `./${DEFAULT_DIR}/<name>${FACE_EXTENSION.html}`,
  },
  prompt: {
    ru: `./${DEFAULT_DIR}/<имя>${FACE_EXTENSION.prompt}`,
    en: `./${DEFAULT_DIR}/<name>${FACE_EXTENSION.prompt}`,
  },
  assets: { ru: `./${DEFAULT_DIR}/<имя>/`, en: `./${DEFAULT_DIR}/<name>/` },
} as const satisfies Record<string, Localized>;

/** The paragraph `fg --help --psvg` prints under the usage line (design 2.8). */
export const details = {
  svg: {
    ru: `Рендер кадра Pixso в SVG. ${PIXSO_LINK} → удалённый маршрут (нужен токен); guid узла → локальный.`,
    en: `Render a Pixso frame as SVG. ${PIXSO_LINK} → the remote route (a token is required); a node guid → the local one.`,
  },
  html: {
    ru: `Рендер кадра Pixso в самодостаточный HTML. ${PIXSO_LINK} → удалённый маршрут (нужен токен); guid узла → локальный.`,
    en: `Render a Pixso frame as self-contained HTML. ${PIXSO_LINK} → the remote route (a token is required); a node guid → the local one.`,
  },
  prompt: {
    ru: "Markdown-промпт по кадру Pixso — описание макета, пригодное для передачи модели.",
    en: "A Markdown prompt describing the Pixso frame, ready to hand to a model.",
  },
  assets: {
    ru: `Один скан макета → четыре файла в одном каталоге: ${ASSET_FILES.svg}, ${ASSET_FILES.html}, ${ASSET_FILES.prompt}, ${ASSET_FILES.meta}. Дизайн запрашивается ровно один раз.`,
    en: `One scan of the design → four files in one directory: ${ASSET_FILES.svg}, ${ASSET_FILES.html}, ${ASSET_FILES.prompt}, ${ASSET_FILES.meta}. The design is fetched exactly once.`,
  },
} as const satisfies Record<string, Localized>;

export const argDescriptions = {
  /**
   * The positional. Both accepted forms are named — the same two the missing-source error
   * names, because a user who reads one and not the other must still learn both — and the
   * REMOTE one is named first, in both languages, because it is the route this product leads
   * with: a link plus a token works from any machine, while a guid needs the Pixso editor open
   * beside the terminal.
   */
  source: {
    ru: `${PIXSO_LINK} → удалённый маршрут (нужен токен); guid узла, например 11:10 → локальный`,
    en: `${PIXSO_LINK} → the remote route (a token is required); a node guid such as 11:10 → the local one`,
  },
  out: {
    ru: `Куда записать файл. Необязателен: без него — ./${DEFAULT_DIR}/<имя>.<расширение>, где <имя> — item-id из ${PIXSO_LINK} (или guid узла: 11:10 → 11-10); недостающие каталоги будут созданы`,
    en: `Where to write the file. Optional: without it, ./${DEFAULT_DIR}/<name>.<ext>, where <name> is the item-id from the ${PIXSO_LINK} (or the node guid: 11:10 → 11-10); missing directories are created`,
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
  ru: `не указан источник: нужна ссылка на кадр Pixso (${PIXSO_LINK}) либо guid узла, например 11:10`,
  en: `no source given: pass a Pixso frame link (${PIXSO_LINK}) or a node guid such as 11:10`,
};

/**
 * A design link was given but no token was resolved. ACTIONABLE: all three ways to supply
 * one, in the precedence order the cli applies them (design 2.1:110-111).
 */
export const missingToken: Localized = {
  ru:
    `для ссылки на кадр (${PIXSO_LINK}) нужен токен удалённого MCP. Задайте его любым из трёх способов: ` +
    `флаг --token <значение>; переменная окружения ${TOKEN_KEY}; ` +
    `строка ${TOKEN_KEY}=<значение> в файле .env рядом с местом запуска`,
  en:
    `a frame link (${PIXSO_LINK}) needs the remote MCP token. Supply it any of three ways: ` +
    `the --token <value> flag; the ${TOKEN_KEY} environment variable; ` +
    `a ${TOKEN_KEY}=<value> line in a .env file next to where you run`,
};

/** Anything the engine threw — a bad link, a refused scan, a dead endpoint, a failed write. */
export const failed = (detail: string): Localized => ({
  ru: `не удалось выполнить команду: ${detail}`,
  en: `the command failed: ${detail}`,
});
