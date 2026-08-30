import type { Rule } from "../types.ts";
import { overImports } from "../types.ts";

/**
 * `icon.foreign-pack` — an icon set imported from a third-party library. Ported from
 * `hackathon2026/ds-analyzer/src/rules/icons/icons.ts:221-263` (the `ICON_PACKAGES` table at
 * 28-39 comes with it), **ungated**.
 *
 * The gate that was removed is the two lines the source opens `run` with:
 *
 *     if (!context.icons.available) {
 *       return []
 *     }
 *
 * — `icons.ts:226-228`. h5 §1d proved it vestigial: the check is "did you import from
 * `react-icons`", the package list is a kit-agnostic table of popular libraries, and nothing
 * in the detection reads icon geometry. With no icon-geometry artifact on disk the rule
 * produced nothing at all on any project, which is the opposite of what its evidence
 * supports.
 *
 * The `why` sentence changes with the gate, and for the same reason: it quoted
 * `context.icons.iconCount` — "у кита N собственных иконок с токенами темы" (`icons.ts:251`)
 * — a number that only exists when the artifact does. What is left says the fact this rule
 * actually establishes.
 */

const ICON_PACKAGES = [
  "react-icons",
  "@mui/icons-material",
  "@material-ui/icons",
  "lucide-react",
  "@tabler/icons",
  "@heroicons/react",
  "@ant-design/icons",
  "react-feather",
  "@phosphor-icons/react",
  "@radix-ui/react-icons",
] as const;

export const foreignIconPackRule: Rule = {
  id: "icon.foreign-pack",
  category: "icon",
  description: "Импорт стороннего пакета иконок",
  run: overImports((record) => {
    const pack = ICON_PACKAGES.find(
      (candidate) => record.specifier === candidate || record.specifier.startsWith(`${candidate}/`),
    );
    if (pack === undefined) {
      return [];
    }

    return [
      {
        rule: "icon.foreign-pack",
        subkind: null,
        category: "icon",
        severity: "warning",
        confidence: 1,
        file: record.file,
        line: record.line,
        column: record.column,
        actual: record.specifier,
        expected: null,
        why:
          `Иконки из «${pack}» — сторонний набор рядом с собственной графикой проекта: ` +
          "он тянет свои размеры, цвета и лицензию и не перекрашивается темой.",
        note: null,
        rootCause: null,
        appliedTo: null,
        autoFixable: false,
        needsAgent: true,
        candidates: [],
        impactKey: `icon.foreign-pack:${pack}`,
        replaceWith: null,
      },
    ];
  }),
};
