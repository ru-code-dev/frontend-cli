import {
  compareStrings,
  styleCategoryOf,
  type RawFinding,
  type Rule,
  type RuleContext,
  type Severity,
  type StyleValue,
} from "@smart-tools/fe-analyzer-engine";

import type { KitSpec } from "../../kit/spec.ts";
import type { KitContext } from "../kit-context.ts";

/**
 * `style.override.*` — styling a kit component from outside. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/rules/api/overrides.ts:1-173`.
 *
 * The naive rule — "any override is a deviation" — produces a report nobody reads. On a real
 * project roughly four out of five `className`s on kit components only set a margin or a width,
 * and positioning a component inside its parent's layout is the parent's job, not the design
 * system's.
 *
 * The opposite naive rule — "only `!important` and private slots count" — misses the damaging
 * case. Repainting through the public `root` slot looks innocent and is exactly what destroys
 * visual consistency, because the component now looks like the kit and behaves like something
 * else.
 *
 * So the verdict comes from the properties inside the class:
 *
 *   layout   → not a finding
 *   size     → info; the component probably needed a different `size`
 *   repaint  → warning; there is a variant or a token for this
 *   @inner   → error; a private slot, and private means it moves without notice
 *   !important → error; an explicit fight with the design system
 *
 * One finding per class and category, anchored at the first offending declaration. Reporting per
 * declaration turns a single repaint into five findings and buries the `!important` underneath
 * them.
 */

interface OverrideGroup {
  readonly styleValue: StyleValue;
  readonly component: string;
  readonly slot: string | null;
  readonly properties: string[];
}

const RULE_BY_CATEGORY = {
  repaint: "style.override.repaint",
  size: "style.override.size",
} as const;

const SEVERITY_BY_CATEGORY: Readonly<Record<"repaint" | "size", Severity>> = {
  repaint: "warning",
  size: "info",
};

/** Groups declarations by the class they belong to and the verdict they attract. */
const groupOverrides = (context: RuleContext, kit: KitSpec): Map<string, OverrideGroup> => {
  const groups = new Map<string, OverrideGroup>();

  for (const styleValue of context.observations.styleValues) {
    const target = styleValue.appliedTo;
    if (target?.kind !== "kit-component" || target.name === null) {
      continue;
    }

    const slot = target.slot;
    const isInner = slot !== null && kit.slot(target.name, slot)?.inner === true;

    const category = styleValue.important ? "important" : styleCategoryOf(styleValue.property);

    // A private slot is a violation whatever the property does. Even a margin breaks when the
    // kit renames the slot, and it renames private slots without deprecating them — so the
    // layout exemption, which applies to public styling, must not apply here.
    if (category === "layout" && !isInner) {
      continue;
    }

    const verdict = isInner ? "inner" : category;
    const selector = styleValue.selector ?? styleValue.property;
    const key = `${styleValue.file}::${selector}::${verdict}`;

    const existing = groups.get(key);
    if (existing) {
      existing.properties.push(styleValue.property);
      continue;
    }

    groups.set(key, {
      styleValue,
      component: target.name,
      slot,
      properties: [styleValue.property],
    });
  }

  return groups;
};

const buildFinding = (key: string, group: OverrideGroup): RawFinding => {
  const verdict = key.slice(key.lastIndexOf("::") + 2) as
    | "important"
    | "inner"
    | "repaint"
    | "size";
  const { styleValue, component, slot, properties } = group;
  const selector = styleValue.selector ?? styleValue.property;
  const list = [...new Set(properties)].sort(compareStrings).join(", ");

  const base = {
    subkind: null,
    category: "override" as const,
    file: styleValue.file,
    line: styleValue.line,
    column: styleValue.column,
    actual: selector,
    expected: null,
    rootCause: styleValue.rootCause,
    appliedTo: { component, slot },
    autoFixable: false,
    candidates: [],
    replaceWith: null,
  };

  switch (verdict) {
    case "important":
      return {
        ...base,
        rule: "style.override.important",
        severity: "error",
        confidence: 1,
        why: `${selector} перебивает стиль ${component} через !important (${list}) — это явная борьба с дизайн-системой, и она сломается, как только кит поменяет специфичность.`,
        note: "Если варианта или токена под задачу нет — это запрос в дизайн-систему, а не повод повышать специфичность.",
        needsAgent: true,
        impactKey: `style.override.important:${component}`,
      };
    case "inner":
      return {
        ...base,
        rule: "style.override.inner",
        severity: "error",
        confidence: 1,
        why: `${selector} целится в слот «${slot ?? "—"}» компонента ${component}, помеченный в ките как @inner. Приватные слоты переименовывают без депрекации — стиль отвалится молча при обновлении.`,
        note: "Публичные слоты того же компонента можно посмотреть на экране «Токены и компоненты».",
        needsAgent: true,
        impactKey: `style.override.inner:${component}.${slot ?? ""}`,
      };
    case "repaint":
      return {
        ...base,
        rule: RULE_BY_CATEGORY.repaint,
        severity: SEVERITY_BY_CATEGORY.repaint,
        confidence: 0.9,
        why: `${selector} перекрашивает ${component} (${list}). Компонент выглядит как кит, а ведёт себя иначе — именно это и разъезжается по продукту.`,
        note: `У ${component} могут быть варианты под эту задачу — проверьте набор view/size, прежде чем красить руками.`,
        needsAgent: false,
        impactKey: `style.override.repaint:${component}`,
      };
    case "size":
      return {
        ...base,
        rule: RULE_BY_CATEGORY.size,
        severity: SEVERITY_BY_CATEGORY.size,
        confidence: 0.7,
        why: `${selector} задаёт ${list} на ${component} — обычно это значит, что не подошёл размер компонента.`,
        note: `Проверьте проп size у ${component}, прежде чем править отступы снаружи.`,
        needsAgent: false,
        impactKey: `style.override.size:${component}`,
      };
  }
};

export const styleOverrideRule = ({ kit }: KitContext): Rule => ({
  id: "style.override",
  category: "override",
  description: "Стилизация компонента кита снаружи: repaint · size · inner · important",
  run: (context: RuleContext): RawFinding[] => {
    const groups = groupOverrides(context, kit);

    return [...groups.entries()]
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, group]) => buildFinding(key, group));
  },
});
