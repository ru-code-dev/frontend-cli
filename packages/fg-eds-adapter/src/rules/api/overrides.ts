import {
  compareStrings,
  styleCategoryOf,
  type RawFinding,
  type Rule,
  type RuleContext,
  type Severity,
  type StyleValue,
} from "@smart-tools/fg-analyzer-engine";

import type { KitSpec } from "../../kit/spec.ts";
import type { KitContext } from "../kit-context.ts";
import { isImportant } from "../style-value.ts";

import { kitClassesIn } from "./kit-classes.ts";

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
 *
 * ## Two ways a declaration is known to land on a kit component
 *
 * The first is the engine's LINKING pass: a class the consumer owns, applied to a kit element in
 * JSX. That is how every EDS 1.x override is found, and it is unchanged.
 *
 * The second is the SELECTOR: `globalStyle("[class*='sds-eng-modal-root']", …)` names the kit's
 * own class, which never appears in the consumer's JSX and therefore cannot be linked. It is
 * also the only form an EDS 2.x consumer can write, because v2 class names carry a build hash
 * (S1 break V12). `kit-classes.ts` does that matching, and a profile without a class prefix gets
 * nothing from it.
 *
 * ## Why one declaration can produce two verdicts
 *
 * `width: 213px !important` on a kit component is two separate statements: the size is being
 * overridden from outside, AND the design system's cascade is being fought. A reader who is
 * shown only the second learns nothing about which prop would have solved it. The 1.x path keeps
 * ONE verdict per declaration — that is the behaviour the parity goldens hold — and the profiles
 * with a class prefix emit both.
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

/** Where a declaration was found to target a kit component, and which part of it. */
interface OverrideTarget {
  readonly component: string;
  readonly slot: string | null;
  readonly inner: boolean;
  /** `true` when the target came from the selector rather than from the linking pass. */
  readonly viaSelector: boolean;
}

/**
 * The kit component a declaration lands on — through the linking pass, or through the selector.
 *
 * At most one target per declaration: a selector naming two kit classes is one override of the
 * one the developer meant, and reporting both would double every finding on a compound selector.
 * The first match wins, which is the leftmost class in the selector.
 */
const targetOf = (styleValue: StyleValue, kit: KitSpec): OverrideTarget | null => {
  const linked = styleValue.appliedTo;
  if (linked?.kind === "kit-component" && linked.name !== null) {
    return {
      component: linked.name,
      slot: linked.slot,
      inner: linked.slot !== null && kit.slot(linked.name, linked.slot)?.inner === true,
      viaSelector: false,
    };
  }

  const [named] = kitClassesIn(styleValue.selector ?? "", kit);
  return named === undefined
    ? null
    : { component: named.component, slot: named.slot, inner: named.inner, viaSelector: true };
};

/**
 * Box dimensions the engine's classifier buckets as `layout`.
 *
 * `styleCategoryOf` puts `width` in `layout` on purpose, and for the LINKED case that is right:
 * a consumer's own class on a kit element that sets a width is positioning the component inside
 * its parent, which is the parent's job (`packages/fg-analyzer-engine/src/css/
 * properties.ts:104,122-126`). Reaching into the kit's OWN class — `[class*='sds-eng-tooltip-
 * root']` — is not positioning anything: there is no parent context in that selector, only the
 * component, so a width there is a resize of the component itself. Hence this list applies to
 * selector-matched targets only.
 */
const BOX_DIMENSION_PROPERTIES: ReadonlySet<string> = new Set([
  "width",
  "min-width",
  "max-width",
  "inline-size",
  "min-inline-size",
  "max-inline-size",
  "block-size",
]);

/** The verdicts one declaration attracts; see the header for why a selector match yields two. */
const verdictsOf = (styleValue: StyleValue, target: OverrideTarget): string[] => {
  const important = isImportant(styleValue);
  const category = styleCategoryOf(styleValue.property);

  if (!target.viaSelector) {
    // The 1.x path, unchanged: `!important` REPLACES the property verdict rather than joining it.
    const verdict = important ? "important" : category;
    if (verdict === "layout" && !target.inner) return [];
    return [target.inner ? "inner" : verdict];
  }

  const graded =
    category === "layout" && BOX_DIMENSION_PROPERTIES.has(styleValue.property.toLowerCase())
      ? "size"
      : category;

  const verdicts: string[] = [];
  if (important) verdicts.push("important");
  // BOTH, not one: reaching a private part of the component and resizing it are two separate
  // things to fix, and a reader shown only the first learns nothing about which prop would have
  // avoided the second.
  if (target.inner) verdicts.push("inner");
  if (graded !== "layout") verdicts.push(graded);

  return verdicts;
};

/** Groups declarations by the class they belong to and the verdict they attract. */
const groupOverrides = (context: RuleContext, kit: KitSpec): Map<string, OverrideGroup> => {
  const groups = new Map<string, OverrideGroup>();

  for (const styleValue of context.observations.styleValues) {
    const target = targetOf(styleValue, kit);
    if (target === null) {
      continue;
    }

    const selector = styleValue.selector ?? styleValue.property;

    for (const verdict of verdictsOf(styleValue, target)) {
      const key = `${styleValue.file}::${selector}::${verdict}`;

      const existing = groups.get(key);
      if (existing) {
        existing.properties.push(styleValue.property);
        continue;
      }

      groups.set(key, {
        styleValue,
        component: target.component,
        slot: target.slot,
        properties: [styleValue.property],
      });
    }
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
  const list = [...new Set(properties)].toSorted(compareStrings).join(", ");

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
  label: { ru: "Стилизация компонента кита снаружи", en: "Kit component styled from outside" },
  // Four verdicts, four finding ids, four severities — so this rule is four controllable
  // things in a config, not one. `style.override` still addresses all of them at once, as a
  // dot-prefix of each. Declared rather than derived: the ids are chosen inside `run`.
  severity: "mixed",
  emits: [
    {
      id: "style.override.repaint",
      description: "Перекраска компонента кита снаружи — вариант или токен уже есть",
      label: { ru: "Перекраска компонента кита", en: "Repaint of a kit component" },
      severity: SEVERITY_BY_CATEGORY.repaint,
    },
    {
      id: "style.override.size",
      description: "Размеры компонента кита правятся снаружи — вероятно, не подошёл проп size",
      // The two halves used to describe DIFFERENT defects — ru «внутренних отступов», en
      // "resized" (V5 finding #18). The ru side is byte-identical to the dashboard's
      // `RULE_LABEL`, so the English is the one that moves.
      label: {
        ru: "Изменение внутренних отступов кита",
        en: "Kit component's inner padding overridden",
      },
      severity: SEVERITY_BY_CATEGORY.size,
    },
    {
      id: "style.override.inner",
      description: "Стиль целится в приватный (@inner) слот — его переименуют без депрекации",
      label: { ru: "Стилизация приватного слота", en: "Styling of a private slot" },
      severity: "error",
    },
    {
      id: "style.override.important",
      description: "!important поверх стиля кита — явная борьба с дизайн-системой",
      label: { ru: "!important поверх стилей кита", en: "!important over kit styles" },
      severity: "error",
    },
  ],
  run: (context: RuleContext): RawFinding[] => {
    const groups = groupOverrides(context, kit);

    return [...groups.entries()]
      .toSorted(([left], [right]) => compareStrings(left, right))
      .map(([key, group]) => buildFinding(key, group));
  },
});
