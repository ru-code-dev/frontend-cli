/**
 * TIER 1 — the three CLI skills (F1-F3). What qwen 0.21.1 discovers and what a model is told to
 * run. That qwen's own loader accepts these files is proven against qwen's source in the real
 * environment run (J7); here the shape, the baked commands and the ownership rule are pinned.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { SKILL_FOLDERS, removeSkills, skillFiles, writeSkills } from "../src/skills.ts";
import { cleanScratch, scratch } from "./support.ts";

afterEach(cleanScratch);

const PATHS = { node: "/opt/cli/node/bin/node", fgMjs: "/home/u/.ru-code/fg/bin/fg.mjs" };
const RUN = `"${PATHS.node}" "${PATHS.fgMjs}"`;

/** qwen's name rule (`qwen-code/packages/core/src/skills/types.ts:262`). */
const SKILL_NAME = /^[\p{L}\p{N}_:.-]+$/u;

/** The frontmatter's two keys, each a JSON string (= a YAML double-quoted scalar). */
function frontmatterOf(text: string): { name: string; description: string } {
  const match = /^---\nname: (.*)\ndescription: (.*)\n---\n/u.exec(text);
  if (match === null) throw new Error("no frontmatter");
  return { name: JSON.parse(match[1] ?? "") as string, description: JSON.parse(match[2] ?? "") as string };
}

const byName = (name: string) => {
  const found = skillFiles(PATHS).find((skill) => skill.name === name);
  if (found === undefined) throw new Error(name);
  return found;
};

describe("F1 — exactly three skills, colon names in colon-free folders", () => {
  it("names, folders, order", () => {
    expect(skillFiles(PATHS).map((s) => [s.folder, s.name])).toEqual([
      ["fg-get-pixso-specs", "fg:get-pixso-specs"],
      ["fg-get-pixso-html", "fg:get-pixso-html"],
      ["fg-project-report", "fg:project-report"],
    ]);
    expect(SKILL_FOLDERS).toEqual(skillFiles(PATHS).map((s) => s.folder));
    for (const { folder } of skillFiles(PATHS)) expect(folder).not.toContain(":");
  });

  it("F3: frontmatter is name + description only, qwen's name rule holds, Russian description", () => {
    for (const skill of skillFiles(PATHS)) {
      const fm = frontmatterOf(skill.text);
      expect(fm.name).toBe(skill.name);
      expect(fm.name).toMatch(SKILL_NAME);
      expect(fm.description).toMatch(/[а-яё]/iu);
      expect(skill.text).not.toContain("allowedTools");
    }
  });

  it("a description holding «: » still parses — it is a JSON (YAML double-quoted) string", () => {
    const fm = frontmatterOf(byName("fg:project-report").text);
    expect(fm.description).toContain("Отчёт о фронтенд-проекте: соответствие");
  });
});

describe("F2 — commands are absolute, baked, verbatim", () => {
  it("specs: --pprompt <link> -o <file>, then read the file", () => {
    const text = byName("fg:get-pixso-specs").text;
    expect(text).toContain(`${RUN} --pprompt "<ССЫЛКА>" -o "<ФАЙЛ>"`);
    expect(text).toContain("fg-out/pixso/<ИМЯ>.md");
    expect(text).toContain("Прочитай `<ФАЙЛ>`");
  });

  it("html: --phtml <link> -o <file>, then read only what is needed", () => {
    const text = byName("fg:get-pixso-html").text;
    expect(text).toContain(`${RUN} --phtml "<ССЫЛКА>" -o "<ФАЙЛ>"`);
    expect(text).toContain("fg-out/pixso/<ИМЯ>.html");
    expect(text).toContain("HTML целиком пользователю не вставляй");
  });

  it("project report: ask with ask_user_question, --format html,summary -o, local → <project>/fg-out, URL → <cwd>/fg-out/<repo>", () => {
    const text = byName("fg:project-report").text;
    expect(text).toContain("ask_user_question");
    expect(text).toContain("«Текущий каталог»");
    expect(text).toContain("«Git-репозиторий — вставьте URL»");
    expect(text).toContain(`${RUN} --preport "<ИСТОЧНИК>" --format html,summary -o "<ВЫХОД>"`);
    expect(text).toContain("`<ВЫХОД>` = `<ИСТОЧНИК>/fg-out`");
    expect(text).toContain("`<ВЫХОД>` = `<КАТАЛОГ>/fg-out/<ИМЯ>`");
    expect(text).toContain("`<ВЫХОД>/report.summary.json`");
    expect(text).toContain("[Открыть дашборд](file://<artifacts.html>)");
    expect(text).toContain("report.html` НЕ открывай");
  });

  it("every skill: no node from PATH, no $HOME, success marker, stop on error, never .env, never the token in chat", () => {
    for (const skill of skillFiles(PATHS)) {
      const commands = [...skill.text.matchAll(/```bash\n([^`]*)```/gu)].map((m) => m[1] ?? "");
      expect(commands.length).toBeGreaterThan(0);
      // The first block is step 0, the fg.mjs check; every other command runs fg.mjs on <NODE>.
      for (const command of commands.slice(1)) {
        expect(command.startsWith(RUN)).toBe(true);
        expect(command).not.toContain("$HOME");
      }
      expect(skill.text).toContain("Маркер успеха");
      expect(skill.text).toContain("ОСТАНОВИСЬ");
      expect(skill.text).toContain("Никогда не открывай и не читай файлы `.env`");
      expect(skill.text).toContain("Никогда не спрашивай токен в чате");
    }
  });

  it("the two pixso skills: exit 3 → relay fg's line verbatim, ask, retry ONCE", () => {
    for (const name of ["fg:get-pixso-specs", "fg:get-pixso-html"]) {
      const text = byName(name).text;
      expect(text).toContain("(код возврата 3)");
      expect(text).toContain("ДОСЛОВНО — строку, в которой есть «fguard token»");
      expect(text).toContain("ответьте мне, когда будет готово");
      expect(text).toContain("повтори шаг 2 ОДИН раз");
    }
  });

  it("Windows paths are baked with forward slashes", () => {
    const text = skillFiles({ node: "C:\\cli\\node.exe", fgMjs: "C:\\Users\\u\\.ru-code\\fg\\bin\\fg.mjs" })[0]?.text ?? "";
    expect(text).toContain(`"C:/cli/node.exe" "C:/Users/u/.ru-code/fg/bin/fg.mjs" --pprompt`);
  });

  it("refuses a path a double-quoted shell word cannot carry", () => {
    for (const bad of ['/a"b/node', "/a$b/node", "/a`b/node"]) {
      expect(() => skillFiles({ node: bad, fgMjs: PATHS.fgMjs })).toThrow(bad);
    }
  });
});

describe("FIX2 — every skill first checks the baked fg.mjs and STOPS with the reinstall line", () => {
  it("step 0 is a check command whose failure output IS the user-facing message", () => {
    for (const skill of skillFiles(PATHS)) {
      const first = /```bash\n([^`]*)```/u.exec(skill.text)?.[1] ?? "";
      expect(first.trim()).toBe(
        `test -f "${PATHS.fgMjs}" && echo FG_OK || { echo "fguard не найден: ${PATHS.fgMjs}. Установите его заново: склонируйте репозиторий релиза fguard и выполните в нём bash install"; exit 1; }`,
      );
      expect(skill.text).toContain("Маркер успеха: `FG_OK`");
      expect(skill.text).toContain("перешли пользователю строку команды ДОСЛОВНО и ОСТАНОВИСЬ");
    }
  });
});

describe("F3 — install and uninstall touch these three folders only", () => {
  it("writes SKILL.md into each, creating skills/ when missing", async () => {
    const dir = join(scratch(), "skills");
    const written = await writeSkills(dir, PATHS);
    expect(written).toEqual(SKILL_FOLDERS.map((f) => join(dir, f, "SKILL.md")));
    for (const file of written) expect(readFileSync(file, "utf8")).toContain(RUN);
  });

  it("re-install overwrites; remove deletes ours and leaves every other skill", async () => {
    const dir = join(scratch(), "skills");
    mkdirSync(join(dir, "theirs"), { recursive: true });
    writeFileSync(join(dir, "theirs", "SKILL.md"), "theirs");
    await writeSkills(dir, PATHS);
    writeFileSync(join(dir, "fg-project-report", "SKILL.md"), "stale");
    await writeSkills(dir, { ...PATHS, node: "/new/node" });
    expect(readFileSync(join(dir, "fg-project-report", "SKILL.md"), "utf8")).toContain('"/new/node"');
    await removeSkills(dir);
    expect(readdirSync(dir)).toEqual(["theirs"]);
    expect(readFileSync(join(dir, "theirs", "SKILL.md"), "utf8")).toBe("theirs");
  });
});
