import {
  implicitRoleOf,
  namesFromContents,
  requiresAccessibleName,
} from "../../a11y/aria-model.ts";
import type { JsxElement } from "../../domain/observations.ts";
import type { RawFinding, Rule, RuleContext } from "../types.ts";

/**
 * `a11y.name.missing` — controls a screen reader can only announce as "button". Ported
 * verbatim from `hackathon2026/ds-analyzer/src/rules/a11y/name.ts:1-176`, including the
 * `kitComponent !== null` skip (source line 118), dead-false here.
 *
 * An icon-only control with no label is the most common accessible-name failure anywhere, and
 * it is invisible in review because the icon reads perfectly to anyone looking at the screen.
 *
 * The rule reports **provable absence only**. Every source of an accessible name that is
 * visible in the syntax is checked first, and anything that merely *might* produce a name —
 * an expression child, a child component that is not a recognisable icon — makes the element
 * undecidable and the rule silent.
 *
 * That asymmetry is deliberate and was learned the expensive way. An earlier version tested a
 * single "has direct text child" flag and produced eleven false positives out of eleven on
 * the first real codebase it ran against: buttons whose text sat one element deeper, and a
 * textarea wrapped in its `<label>`. A naming rule that fires on correctly labelled controls
 * does not get fixed by the team, it gets switched off.
 */

/** Attributes any of which supplies a name directly. */
const NAMING_ATTRIBUTES = [
  "aria-label",
  "aria-labelledby",
  "title",
  "alt",
  "label",
  "placeholder",
] as const;

const isHostElement = (element: JsxElement): boolean => /^[a-z]/.test(element.name);

/**
 * The role the element carries, explicit or implicit.
 *
 * Custom components are skipped: `<IconButton icon={…} />` may label itself internally, and
 * only its own contract can say. Guessing here would put a finding on every wrapper.
 */
const effectiveRoleOf = (element: JsxElement): string | null => {
  const explicit = element.props["role"];

  if (typeof explicit === "string") {
    return explicit;
  }

  return isHostElement(element) ? implicitRoleOf(element.name) : null;
};

const hasNamingAttribute = (element: JsxElement): boolean =>
  NAMING_ATTRIBUTES.some((attribute) => attribute in element.props);

/**
 * Ids named by a `<label htmlFor>` somewhere in the same file.
 *
 * The explicit half of native labelling; `hasLabelAncestor` covers the implicit half.
 * Together they are why a correctly built form produces no findings here.
 */
const labelledIdsByFile = (
  elements: readonly JsxElement[],
): ReadonlyMap<string, ReadonlySet<string>> => {
  const byFile = new Map<string, Set<string>>();

  for (const element of elements) {
    if (element.name.toLowerCase() !== "label") {
      continue;
    }

    const target = element.props["htmlFor"] ?? element.props["for"];
    if (typeof target !== "string") {
      continue;
    }

    const bucket = byFile.get(element.file) ?? new Set<string>();
    bucket.add(target);
    byFile.set(element.file, bucket);
  }

  return byFile;
};

type Verdict = "named" | "unnamed" | "undecidable";

const judge = (element: JsxElement, labelledIds: ReadonlySet<string>, role: string): Verdict => {
  if (hasNamingAttribute(element) || element.hasLabelAncestor) {
    return "named";
  }

  const id = element.props["id"];
  if (typeof id === "string" && labelledIds.has(id)) {
    return "named";
  }

  // Roles like `tabpanel`, `dialog` and `textbox` take no name from their content: however
  // much text they hold, without an attribute or a label they are unnamed. There is nothing
  // undecidable about them.
  if (!namesFromContents(role)) {
    return "unnamed";
  }

  if (element.content.text) {
    return "named";
  }

  // An expression may render text or nothing; a child component may render either. Both leave
  // the name unknown, and unknown is not a finding.
  if (element.content.expression || element.content.component) {
    return "undecidable";
  }

  return "unnamed";
};

export const missingAccessibleNameRule: Rule = {
  id: "a11y.name.missing",
  category: "a11y",
  description: "Контрол без доступного имени — скринридер объявит только роль",
  run: (context: RuleContext): RawFinding[] => {
    const labelled = labelledIdsByFile(context.observations.jsxElements);
    const findings: RawFinding[] = [];

    for (const element of context.observations.jsxElements) {
      const role = effectiveRoleOf(element);

      if (role === null || !requiresAccessibleName(role) || element.kitComponent !== null) {
        continue;
      }

      const verdict = judge(element, labelled.get(element.file) ?? new Set<string>(), role);

      if (verdict !== "unnamed") {
        continue;
      }

      const fromContents = namesFromContents(role);

      findings.push({
        rule: "a11y.name.missing",
        subkind: fromContents ? "iconOnly" : "unlabelled",
        category: "a11y",
        severity: "error",
        confidence: 0.9,
        file: element.file,
        line: element.line,
        column: element.column,
        actual: `<${element.name}${typeof element.props["role"] === "string" ? ` role="${role}"` : ""}>`,
        expected: {
          token: null,
          cssVar: null,
          component: null,
          value: `<${element.name} aria-label="…">`,
        },
        why: fromContents
          ? `У элемента роль ${role}, внутри только графика и нет ни aria-label, ни title. ` +
            `Скринридер объявит «${role}» и ничего больше.`
          : `Роль ${role} не берёт имя из содержимого — только из aria-label, aria-labelledby ` +
            "или обёртки <label>. Ни одного из них здесь нет.",
        note: null,
        rootCause: null,
        appliedTo: null,
        autoFixable: false,
        needsAgent: true,
        candidates: [],
        a11y: {
          wcag: ["4.1.2"],
          pattern: null,
          impact: `Пользователь скринридера слышит «${role}» и не узнаёт, что это за элемент.`,
          // Two different remedies, because the two subkinds fail differently: a `button` can
          // be named by its own text, a `tabpanel` never can. Telling the second one to "add
          // some text" would be advice that cannot work.
          fix: fromContents
            ? "Добавьте aria-label с описанием действия — или видимый текст рядом с иконкой."
            : `Свяжите элемент с его заголовком через aria-labelledby, либо задайте aria-label: ` +
              `роль ${role} не берёт имя из содержимого.`,
        },
        impactKey: `a11y.name.missing:${role}`,
        replaceWith: null,
      });
    }

    return findings;
  },
};
