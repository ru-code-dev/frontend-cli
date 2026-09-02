import type { Limitation, RawFinding, Rule, RuleContext } from "@smart-tools/fe-analyzer-engine";

import type { KitContext } from "../kit-context.ts";

/**
 * A widget that claims an interactive ARIA role but listens for no keys. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/rules/a11y/pattern-keyboard.ts:1-157`.
 *
 * h2 §2 row 10 and h5 §1a both rule this KIT-BOUND with no generic fallback, which is why it was
 * left out of the engine's own eleven and why it belongs here: the claim it makes is "the kit's
 * equivalent handles these keys and yours handles none", and without a kit there is no first
 * half of that sentence.
 *
 * This is the finding the whole accessibility layer exists for, and the one no existing tool
 * produces. `eslint-plugin-jsx-a11y` checks attributes on one element and sees nothing wrong;
 * `axe-core` inspects a rendered snapshot and sees a correct `role="tablist"` with correct
 * `aria-selected`. Neither presses a key. A hand-rolled tab strip therefore passes both while
 * being completely unusable without a mouse.
 *
 * Roles that carry no keyboard contract of their own are excluded. `role="dialog"` needs
 * `Escape` and a focus trap, but a dialog whose buttons are real buttons needs no key handling
 * on the container itself, and demanding one would be wrong.
 */

/** Roles whose APG contract requires the container itself to handle keys. */
const ROLES_REQUIRING_KEYBOARD: ReadonlySet<string> = new Set([
  "tablist",
  "menu",
  "menubar",
  "listbox",
  "tree",
  "grid",
  "radiogroup",
  "toolbar",
  "combobox",
  "slider",
  "spinbutton",
]);

export const patternKeyboardRule = ({ a11y }: KitContext): Rule => ({
  id: "a11y.pattern.keyboard",
  category: "a11y",
  description: "Виджет объявил интерактивную ARIA-роль, но не обрабатывает клавиатуру",
  limitations: (context: RuleContext): Limitation[] => {
    if (a11y.available) {
      return [];
    }

    // Every widget in the project went unchecked. Saying so is the whole point: the reader would
    // otherwise take an empty accessibility section as a pass.
    const widgets = context.observations.jsxElements.filter((element) => {
      const role = element.props["role"];

      return (
        typeof role === "string" &&
        ROLES_REQUIRING_KEYBOARD.has(role) &&
        element.kitComponent === null
      );
    });

    return widgets.map((element) => ({
      file: element.file,
      line: element.propLines["role"] ?? element.line,
      reason: "spec-unavailable" as const,
      detail:
        "Клавиатурная доступность виджета не проверена: артефакт kit-a11y.json не собран " +
        "(нужен установленный @v-uik). Запустите npm run extract:kit-a11y.",
    }));
  },
  run: (context: RuleContext): RawFinding[] => {
    // Without the upstream there is no evidence of what the kit handles, and a finding phrased
    // as "the kit does this and you do not" would be unfounded. The gap is recorded in
    // `limitations`; silence here is deliberate, not an oversight.
    if (!a11y.available) {
      return [];
    }

    const findings: RawFinding[] = [];

    for (const element of context.observations.jsxElements) {
      const role = element.props["role"];

      if (role === null || role === undefined || !ROLES_REQUIRING_KEYBOARD.has(role)) {
        continue;
      }

      // A kit component rendering its own role is the kit's business, not the consumer's.
      if (element.kitComponent !== null) {
        continue;
      }

      if (element.keysHandled.length > 0) {
        continue;
      }

      // A handler whose body lives elsewhere is unreadable, not absent. Reporting it as a
      // keyboard failure would be a guess dressed as a fact, so it is downgraded and sent to the
      // agent stage — the distinction the observations schema exists to preserve.
      const hasHandler = element.eventHandlers.some((name) => name.startsWith("onKey"));

      const equivalents = a11y.componentsRendering(role);
      const best = a11y.canonicalComponentFor(role);

      if (best === null || best.keysHandled.length === 0) {
        continue;
      }

      const keys = best.keysHandled.join(", ");

      findings.push({
        rule: "a11y.pattern.keyboard",
        subkind: hasHandler ? "handlerUnreadable" : "noHandler",
        category: "a11y",
        severity: hasHandler ? "warning" : "error",
        confidence: hasHandler ? 0.5 : 0.95,
        file: element.file,
        line: element.propLines["role"] ?? element.line,
        column: element.column,
        actual: `role="${role}"`,
        expected: {
          token: null,
          cssVar: null,
          component: best.component,
          value: `<${best.component} …>`,
        },
        why: hasHandler
          ? `Элемент объявляет role="${role}", обработчик клавиатуры есть, но его тело объявлено отдельно — ` +
            `проверить нечем. Компонент кита ${best.component} обрабатывает: ${keys}.`
          : `Элемент объявляет role="${role}", но не обрабатывает ни одной клавиши. ` +
            `Пользователь клавиатуры не сможет им управлять. Компонент кита ${best.component} ` +
            `обрабатывает: ${keys}.`,
        note: hasHandler ? "Требуется ручная проверка либо разбор обработчика на стадии ИИ." : null,
        rootCause: null,
        appliedTo: null,
        autoFixable: false,
        needsAgent: true,
        candidates: equivalents.map((pattern) => ({
          component: pattern.component,
          score: pattern.roles.includes(role) ? 0.9 : 0.5,
          reasons: [
            `рендерит role="${role}"`,
            ...(pattern.keysHandled.length > 0
              ? [`обрабатывает ${pattern.keysHandled.join(", ")}`]
              : []),
            ...(pattern.managesFocus ? ["управляет фокусом"] : []),
          ],
        })),
        a11y: {
          wcag: ["2.1.1"],
          pattern: role,
          impact: `Виджет ${role} недоступен с клавиатуры: фокус в него попадает, но управлять им нечем.`,
          // Naming the kit component rather than the APG pattern: the keys are already
          // implemented there, and "read the specification and write the handlers" is advice
          // that loses to a one-line import every time.
          fix: `Возьмите ${best.component} из кита — он уже обрабатывает ${keys}.`,
        },
        impactKey: `a11y.pattern.keyboard:${role}`,
        replaceWith: null,
      });
    }

    return findings;
  },
});
