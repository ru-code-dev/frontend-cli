import {
  compareStrings,
  editDistance,
  type RawFinding,
  type Rule,
  type RuleContext,
} from "@smart-tools/fe-analyzer-engine";

import type { KitContext } from "../kit-context.ts";

/**
 * `prop.invalid` — a prop value the kit does not define, and `api.deprecated` — a symbol the kit
 * has marked for removal. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/rules/api/props.ts:1-217`.
 *
 * Both are checked against the components artifact rather than against the type checker, because
 * a consumer's dependencies are usually not installed when an audit runs. That costs nothing
 * here: the kit declares its variants as `as const` objects, which are readable syntactically
 * and are the same thing the types are derived from.
 *
 * `view="danger"` is the archetype. TypeScript rejects it, so it only survives where types are
 * loose — spread props, `any`, a wrapper that widens the type. Those are exactly the places
 * nobody is looking, and the component silently falls back to its default variant.
 */

/**
 * Values that mean exactly what a kit value means, spelled differently.
 *
 * `view="danger"` and `view="negative"` are the same variant under two design systems'
 * vocabularies; substituting one for the other changes nothing on screen. These are safe to
 * apply mechanically.
 */
const RENAMES: Readonly<Record<string, readonly string[]>> = {
  danger: ["negative", "error"],
  error: ["negative"],
  destructive: ["negative"],
  default: ["primary"],
  medium: ["md"],
  small: ["sm"],
  large: ["lg"],
  tiny: ["xs"],
  mini: ["xs"],
};

/**
 * Values with no equivalent, mapped to the nearest thing the kit offers.
 *
 * `size="xl"` on a kit whose largest size is `md` is not a spelling difference — applying the
 * mapping makes the component visibly smaller. Worth suggesting, never worth applying without a
 * human looking at it.
 */
const APPROXIMATIONS: Readonly<Record<string, readonly string[]>> = {
  ghost: ["secondary"],
  outline: ["secondary"],
  link: ["secondary"],
  xl: ["md"],
  xxl: ["md"],
  huge: ["md"],
};

const lookup = (
  table: Readonly<Record<string, readonly string[]>>,
  actual: string,
  legal: readonly string[],
): string | null => {
  for (const candidate of table[actual.toLowerCase()] ?? []) {
    const hit = legal.find((value) => value.toLowerCase() === candidate);
    if (hit !== undefined) {
      return hit;
    }
  }

  return null;
};

interface Suggestion {
  readonly value: string;
  /** `true` only for a pure rename, which is the sole case safe to patch unattended. */
  readonly safeToApply: boolean;
}

/** Closest legal value, when one is close enough to be what was meant. */
const closestValue = (actual: string, legal: readonly string[]): Suggestion | null => {
  const renamed = lookup(RENAMES, actual, legal);
  if (renamed !== null) {
    return { value: renamed, safeToApply: true };
  }

  const approximated = lookup(APPROXIMATIONS, actual, legal);
  if (approximated !== null) {
    return { value: approximated, safeToApply: false };
  }

  const ranked = [...legal]
    .map((value) => ({ value, distance: editDistance(actual.toLowerCase(), value.toLowerCase()) }))
    .sort(
      (left, right) => left.distance - right.distance || compareStrings(left.value, right.value),
    );

  const best = ranked[0];

  // Beyond half the word length the "suggestion" is noise dressed up as help.
  return best !== undefined && best.distance <= Math.max(1, Math.floor(actual.length / 2))
    ? { value: best.value, safeToApply: false }
    : null;
};

export const invalidPropRule = ({ kit }: KitContext): Rule => ({
  id: "prop.invalid",
  category: "api",
  description: "Значение пропа отсутствует в наборе вариантов кита",
  run: (context: RuleContext): RawFinding[] => {
    const findings: RawFinding[] = [];

    for (const element of context.observations.jsxElements) {
      if (element.kitComponent === null) {
        continue;
      }

      for (const [prop, value] of Object.entries(element.props)) {
        // A prop whose value is an expression cannot be checked without evaluating it.
        if (value === null) {
          continue;
        }

        const legal = kit.variantValues(element.kitComponent, prop);
        if (legal === null || legal.includes(value)) {
          continue;
        }

        const suggestion = closestValue(value, legal);

        findings.push({
          rule: "prop.invalid",
          subkind: null,
          category: "api",
          severity: "error",
          confidence: 1,
          file: element.file,
          line: element.propLines[prop] ?? element.line,
          column: element.column,
          actual: `${prop}="${value}"`,
          expected:
            suggestion === null
              ? null
              : {
                  token: null,
                  cssVar: null,
                  component: element.kitComponent,
                  value: `${prop}="${suggestion.value}"`,
                },
          why: `${element.kitComponent} не знает ${prop}="${value}" — допустимы только ${legal.join(", ")}. Компонент молча отрисуется значением по умолчанию.`,
          note:
            suggestion === null
              ? null
              : suggestion.safeToApply
                ? `«${value}» — это то же самое, что «${suggestion.value}», просто другим словарём.`
                : `«${value}» в ките нет; ближайшее — «${suggestion.value}», но это изменит внешний вид: проверьте глазами.`,
          rootCause: null,
          appliedTo: { component: element.kitComponent, slot: null },
          autoFixable: suggestion?.safeToApply ?? false,
          needsAgent: false,
          candidates: [],
          impactKey: `prop.invalid:${element.kitComponent}.${prop}=${value}`,
          replaceWith: suggestion === null ? null : `${prop}="${suggestion.value}"`,
        });
      }
    }

    return findings;
  },
});

export const deprecatedApiRule = ({ kit }: KitContext): Rule => ({
  id: "api.deprecated",
  category: "api",
  description: "Использован символ, помеченный @deprecated",
  run: (context: RuleContext): RawFinding[] => {
    const findings: RawFinding[] = [];
    const reported = new Set<string>();

    for (const element of context.observations.jsxElements) {
      if (element.kitComponent === null) {
        continue;
      }

      const note = kit.deprecationOf(element.kitComponent);
      if (note === undefined) {
        continue;
      }

      const key = `${element.file}:${String(element.line)}:${element.kitComponent}`;
      if (reported.has(key)) {
        continue;
      }
      reported.add(key);

      // The kit writes its deprecation notes as "Используйте компонент X"; the name in there is
      // a better suggestion than anything that could be inferred.
      const replacement =
        /(?:используйте|use)\s+(?:компонент\s+)?([A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*)*)/i.exec(
          note ?? "",
        )?.[1] ?? null;

      findings.push({
        rule: "api.deprecated",
        subkind: null,
        category: "api",
        severity: "warning",
        confidence: 1,
        file: element.file,
        line: element.line,
        column: element.column,
        actual: element.kitComponent,
        expected:
          replacement === null
            ? null
            : { token: null, cssVar: null, component: replacement, value: replacement },
        why: `${element.kitComponent} помечен в ките как @deprecated${note === null ? "" : `: ${note}`}. Он останется рабочим ровно до того релиза, в котором его удалят.`,
        note:
          replacement === null
            ? "Замена в ките не указана — уточнить у команды дизайн-системы."
            : null,
        rootCause: null,
        appliedTo: { component: element.kitComponent, slot: null },
        // Renaming the element is mechanical; the prop surface of the replacement is not.
        autoFixable: false,
        needsAgent: replacement !== null,
        candidates: [],
        impactKey: `api.deprecated:${element.kitComponent}`,
        replaceWith: null,
      });
    }

    return findings;
  },
});
