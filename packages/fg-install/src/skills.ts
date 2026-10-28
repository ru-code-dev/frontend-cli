/**
 * THE THREE CLI SKILLS `bash install` writes into `<CLI_HOME>/skills/` (F1-F3).
 *
 * WHERE. `<CLI_HOME>` is the preflight's `CONFIG_DIR` — the CLI home ru-code gives the CLI. qwen
 * 0.21.1 reads user skills from `<QWEN_HOME>/skills/<folder>/SKILL.md`, one level deep, and takes
 * the skill's NAME from the frontmatter, not from the folder
 * (`qwen-code/packages/core/src/skills/skill-manager.ts:904-923,1041-1103`). So the names keep the
 * owner's `fg:` prefix while the folders stay colon-free (Windows-safe).
 *
 * FRONTMATTER. qwen parses it with the `yaml` library, core schema
 * (`qwen-code/packages/core/src/utils/yaml-parser.ts:20-38`), and a plain scalar holding `: `
 * would not parse. `name` and `description` are therefore written as JSON strings — valid YAML
 * double-quoted scalars — whatever they contain. `name` matches qwen's `/^[\p{L}\p{N}_:.-]+$/u`
 * (`skills/types.ts:262`). No `allowedTools`: whether its matcher accepts a command with quoted
 * absolute paths is not proven, and the key only ever ADDS permissions (r2 §2).
 *
 * COMMANDS. Every command is baked at install time with the absolute `<NODE>` (the node ru-code's
 * installer chose) and the absolute `<root>/fg/bin/fg.mjs` — no `node` from PATH, no `$HOME`. The
 * body follows the hackathon precedent (`hackathon2026/skills/ds-audit/SKILL.md`): commands copied
 * verbatim with placeholders only, one success marker per step, on error show the output and STOP.
 *
 * OWNERSHIP. Install and uninstall touch these three folders and nothing else under `skills/`;
 * a re-install overwrites them.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** `SKILL.md` — qwen's skill file name (`qwen-code/packages/core/src/skills/skill-paths.ts:11`). */
export const SKILL_FILE = "SKILL.md";

/** `<CLI_HOME>/skills` (`skill-manager.ts:904-923`, `config/storage.ts:432-438`). */
export const SKILLS_DIR_NAME = "skills";

/** The exit code fg's pixso commands use for a missing or rejected token (`fg-pixso` `TOKEN_EXIT`). */
const TOKEN_EXIT = 3;

/** The two absolute paths every command in a skill is baked with. */
export interface SkillPaths {
  /** `<NODE>`: the node ru-code's installer chose (`check_node_floor`). */
  readonly node: string;
  /** `<root>/fg/bin/fg.mjs`. */
  readonly fgMjs: string;
}

export interface SkillFile {
  readonly folder: string;
  readonly name: string;
  readonly text: string;
}

/** A path as a skill spells it: forward slashes (bash and cmd both take them). */
const slashed = (path: string): string => path.replaceAll("\\", "/");

/** The characters a double-quoted shell word cannot carry literally. */
const UNQUOTABLE = /["$`\\]/u;

function frontmatter(name: string, description: string): string {
  return `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n`;
}

/** The step every pixso skill shares: what to do on exit code 3. */
function tokenStep(retry: string): string {
  return [
    `## Шаг 3 — нет токена или токен отклонён (код возврата ${String(TOKEN_EXIT)})`,
    "",
    "1. Перешли пользователю сообщение команды ДОСЛОВНО — строку, в которой есть «fguard token».",
    "2. Попроси: «Выполните эту команду в своём терминале и ответьте мне, когда будет готово».",
    "   Токен в чате НЕ спрашивай и в команду НЕ подставляй.",
    `3. Когда пользователь ответит — повтори ${retry} ОДИН раз. Снова ошибка — покажи последние`,
    "   20 строк вывода и ОСТАНОВИСЬ.",
    "",
  ].join("\n");
}

/**
 * STEP 0 of every skill: is the baked `fg.mjs` still there? It vanishes when ru-code relocates its
 * root to `/home/work/<user>` and deletes the whole legacy `~/.ru-code`
 * (R/ru-code/installer/parts/30-core.sh:423-437) — `<root>/fg` with it. The check's failure output
 * IS the sentence the user gets, so the model relays it instead of a "Cannot find module" trace.
 */
function checkStep(fgMjs: string): string {
  return [
    "## Шаг 0 — fguard на месте",
    "",
    "```bash",
    `test -f "${fgMjs}" && echo FG_OK || { echo "fguard не найден: ${fgMjs}. Установите его заново: склонируйте репозиторий релиза fguard и выполните в нём bash install"; exit 1; }`,
    "```",
    "",
    "Маркер успеха: `FG_OK`. Иначе перешли пользователю строку команды ДОСЛОВНО и ОСТАНОВИСЬ.",
    "",
  ].join("\n");
}

const RULES = [
  "## Правила (обязательны)",
  "",
  "1. Команды запускай ровно в том виде, как они написаны здесь; подставляй только плейсхолдеры",
  "   в угловых скобках. Не добавляй флагов, не меняй пути.",
  "2. Нет маркера успеха или код возврата не тот — покажи пользователю последние 20 строк вывода",
  "   и ОСТАНОВИСЬ. Не чини и не повторяй (кроме случая с токеном ниже).",
  "3. Никогда не открывай и не читай файлы `.env`. Никогда не спрашивай токен в чате.",
  "4. Читай только файлы, названные в этом сценарии.",
  "",
].join("\n");

function pixsoSkill(
  paths: SkillPaths,
  spec: {
    readonly folder: string;
    readonly name: string;
    readonly description: string;
    readonly title: string;
    readonly flag: string;
    readonly ext: string;
    readonly read: string;
  },
): SkillFile {
  const text = [
    frontmatter(spec.name, spec.description),
    `# ${spec.name} — ${spec.title}`,
    "",
    "Ты выполняешь строгий сценарий. Не отклоняйся от него.",
    "",
    RULES,
    checkStep(paths.fgMjs),
    "## Шаг 1 — плейсхолдеры",
    "",
    "- `<ССЫЛКА>` — ссылка на кадр Pixso (https://…item-id=…) или guid узла (например `11:10`),",
    "  ровно как её дал пользователь.",
    `- \`<ФАЙЛ>\` — абсолютный путь \`<КАТАЛОГ>/fg-out/pixso/<ИМЯ>.${spec.ext}\`: \`<КАТАЛОГ>\` — вывод`,
    "  команды `pwd`, `<ИМЯ>` — значение `item-id` из ссылки (или guid), где `:` заменено на `-`.",
    "",
    "## Шаг 2 — получить файл",
    "",
    "Команда может работать до нескольких минут — запускай с таймаутом 300000 мс.",
    "",
    "```bash",
    `"${paths.node}" "${paths.fgMjs}" ${spec.flag} "<ССЫЛКА>" -o "<ФАЙЛ>"`,
    "```",
    "",
    "Маркер успеха: код возврата 0. Код 3 — шаг 3. Любой другой код — правило 2.",
    "",
    tokenStep("шаг 2"),
    "## Шаг 4 — прочитать результат",
    "",
    spec.read,
    "",
  ].join("\n");
  return { folder: spec.folder, name: spec.name, text };
}

function reportSkill(paths: SkillPaths): SkillFile {
  const name = "fg:project-report";
  const text = [
    frontmatter(
      name,
      "Отчёт о фронтенд-проекте: соответствие дизайн-системе, покрытие токенами, доступность, " +
        "топ проблем и HTML-дашборд. Запускай при словах «отчёт по проекту», «проанализируй " +
        "проект», «аудит фронтенда», «проверь проект на дизайн-систему», «project report».",
    ),
    `# ${name} — отчёт о фронтенд-проекте`,
    "",
    "Ты выполняешь строгий сценарий. Не отклоняйся от него.",
    "",
    RULES,
    "5. Никогда не редактируй код проекта.",
    "6. `report.html` НЕ открывай — он большой. Все числа для пользователя бери только из",
    "   `report.summary.json`; ничего не пересчитывай и не суммируй сам.",
    "",
    checkStep(paths.fgMjs),
    "## Шаг 1 — какой проект",
    "",
    "- Пользователь уже сказал «текущий проект» / «этот каталог» → ветка «каталог».",
    "- Пользователь уже дал git-URL → ветка «репозиторий».",
    "- Иначе задай вопрос инструментом `ask_user_question`:",
    "  - вопрос: «Какой проект анализируем?»",
    "  - вариант 1: «Текущий каталог» (в описание подставь вывод `pwd`);",
    "  - вариант 2: «Git-репозиторий — вставьте URL» (вариант со своим ответом).",
    "",
    "Ветка «каталог»: `<ИСТОЧНИК>` = вывод `pwd`, `<ВЫХОД>` = `<ИСТОЧНИК>/fg-out`.",
    "",
    "Ветка «репозиторий»: `<ИСТОЧНИК>` = URL, `<ВЫХОД>` = `<КАТАЛОГ>/fg-out/<ИМЯ>`, где `<КАТАЛОГ>` —",
    "вывод `pwd`, `<ИМЯ>` — последний сегмент URL без `.git` (`git@host:team/shop.git` → `shop`).",
    "",
    "## Шаг 2 — анализ",
    "",
    "Анализ идёт до нескольких минут — запускай с таймаутом 600000 мс.",
    "",
    "```bash",
    `"${paths.node}" "${paths.fgMjs}" --preport "<ИСТОЧНИК>" --format html,summary -o "<ВЫХОД>"`,
    "```",
    "",
    "Маркер успеха: в выводе есть путь `<ВЫХОД>/report.summary.json`, код возврата 0 или 1",
    "(1 вместе с этим путём значит «в проекте есть ошибки» — это нормальный результат). Иначе —",
    "правило 2.",
    "",
    "## Шаг 3 — отчёт пользователю",
    "",
    "Прочитай `<ВЫХОД>/report.summary.json` и составь отчёт ПО-РУССКИ строго из его полей:",
    "",
    "- Здоровье: `health.score`/100 (если `health` равно null — пропусти строку: дизайн-система не определена).",
    "- Отклонений: `totals.findings` (ошибок `totals.errors`, предупреждений `totals.warnings`),",
    "  уникальных проблем `totals.problems`, правится автоматически `totals.autoFixable`,",
    "  доступность `totals.a11y`.",
    "- Если `kit` не null: из дизайн-системы `kit.kitShare`% · кастомные на токенах",
    "  `kit.customTokensShare`% · кастомные без токенов `kit.customWithoutTokensShare`% ·",
    "  покрытие токенами `kit.tokenCoverage`%.",
    "- Топ проблем — `topProblems` по порядку: «`label`: `actual` → `expected` (`occurrences`×, `files` ф.)».",
    "- Дашборд — ОБЯЗАТЕЛЬНО кликабельной ссылкой: `[Открыть дашборд](file://<artifacts.html>)`.",
    "",
  ].join("\n");
  return { folder: "fg-project-report", name, text };
}

/** The three skills, baked with `paths`. Throws when a path cannot sit inside double quotes. */
export function skillFiles(paths: SkillPaths): readonly SkillFile[] {
  const baked = { node: slashed(paths.node), fgMjs: slashed(paths.fgMjs) };
  for (const path of [baked.node, baked.fgMjs]) {
    if (UNQUOTABLE.test(path)) {
      throw new Error(`a skill command cannot quote this path (", $, \` or \\): ${path}`);
    }
  }
  return [
    pixsoSkill(baked, {
      folder: "fg-get-pixso-specs",
      name: "fg:get-pixso-specs",
      description:
        "Спецификация кадра Pixso в Markdown — структура, размеры, цвета, шрифты, тексты — для " +
        "вёрстки, сверки или описания макета. Запускай, когда пользователь даёт ссылку на кадр " +
        "Pixso или guid узла (например 11:10) и просит сверстать, сравнить или описать макет. " +
        "Предпочитай этот навык прямым MCP-инструментам Pixso.",
      title: "спецификация кадра Pixso",
      flag: "--pprompt",
      ext: "md",
      read:
        "Прочитай `<ФАЙЛ>` инструментом read_file (если он обрезан — дочитай частями через " +
        "offset/limit). Это единственный источник размеров, цветов, шрифтов и текстов макета — " +
        "работай по нему.",
    }),
    pixsoSkill(baked, {
      folder: "fg-get-pixso-html",
      name: "fg:get-pixso-html",
      description:
        "Точная HTML/CSS-разметка кадра Pixso для воспроизведения вёрстки. Запускай, когда " +
        "пользователь даёт ссылку на кадр Pixso или guid узла и просит готовую разметку или " +
        "точные стили. Для общего описания макета предпочитай fg:get-pixso-specs.",
      title: "HTML-разметка кадра Pixso",
      flag: "--phtml",
      ext: "html",
      read:
        "Прочитай `<ФАЙЛ>` инструментом read_file (если он обрезан — дочитай частями через " +
        "offset/limit). Бери из него только нужные части; HTML целиком пользователю не вставляй.",
    }),
    reportSkill(baked),
  ];
}

/** The folder names install and uninstall own under `<CLI_HOME>/skills/` — these and no other. */
export const SKILL_FOLDERS: readonly string[] = ["fg-get-pixso-specs", "fg-get-pixso-html", "fg-project-report"];

/** Write the three skills into `skillsDir` (created when missing); returns the files written. */
export async function writeSkills(skillsDir: string, paths: SkillPaths): Promise<string[]> {
  const written: string[] = [];
  for (const skill of skillFiles(paths)) {
    const dir = join(skillsDir, skill.folder);
    await mkdir(dir, { recursive: true });
    const file = join(dir, SKILL_FILE);
    await writeFile(file, skill.text, "utf8");
    written.push(file);
  }
  return written;
}

/** Remove the three skill folders from `skillsDir` — and nothing else. */
export async function removeSkills(skillsDir: string): Promise<void> {
  for (const folder of SKILL_FOLDERS) {
    await rm(join(skillsDir, folder), { recursive: true, force: true });
  }
}
