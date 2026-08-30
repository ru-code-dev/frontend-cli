import {
  ariaAttributeNames,
  implicitRoleOf,
  isAbstractRole,
  isKnownAriaAttribute,
  isKnownRole,
  prohibitedPropsOf,
  requiredPropsOf,
  roleNames,
  roleSupports,
} from "../../a11y/aria-model.ts";
import type { JsxElement } from "../../domain/observations.ts";
import { editDistance } from "../../shared/edit-distance.ts";
import type { RawFinding, Rule, RuleContext } from "../types.ts";
import { deletionOf, occursOn } from "./source-edit.ts";

/**
 * `a11y.aria.invalid`, `a11y.aria.required`, `a11y.aria.redundant` — ARIA that the
 * specification itself rejects. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/rules/a11y/aria.ts:1-348`, including the
 * `element.kitComponent !== null` guard in `requiredAriaRule` (source line 255), which stays
 * as a dead-false check because this engine never sets that field — h2 §2 row 3 calls it "a
 * benign no-op on a kit-less project", and deleting it would be a rewrite with nothing to
 * gain.
 *
 * Everything here is decided from the ARIA 1.2 role model rather than from an opinion, so
 * there is no threshold to tune and no judgement to disagree with: `role="buton"` names
 * nothing, `aria-labeledby` is not an attribute, a `checkbox` without `aria-checked` has no
 * state to announce. A screen reader either ignores these or announces something wrong, and
 * both failures are invisible to everyone who does not use one.
 *
 * This is also the one accessibility family where a *patch* is possible rather than advice. A
 * name that is not in the specification and is one character away from one that is has
 * exactly one plausible reading, and a role that repeats what the tag already says can only
 * be deleted. Both are offered as diffs; everything else here still needs a human.
 */

const ariaAttributesOf = (element: JsxElement): string[] =>
  Object.keys(element.props).filter((name) => name.startsWith("aria-"));

/** A component may forward `role` to any element, so only host tags can be judged. */
const isHostElement = (element: JsxElement): boolean => /^[a-z]/.test(element.name);

const lineOf = (element: JsxElement, prop: string): number =>
  element.propLines[prop] ?? element.line;

const sourceLineOf = (context: RuleContext, file: string, line: number): string | undefined =>
  context.sources.get(file)?.[line - 1];

/**
 * The known name the author most plausibly meant, or `null`.
 *
 * Two guards, and both are there because a wrong suggestion is worse than none. The tolerance
 * scales with length, so a five-letter role has to be within one edit while a long `aria-*`
 * name may be within two — otherwise every short unknown role would acquire a confident
 * correction to some unrelated one. And a tie is refused outright: if two known names are
 * equally close, the tool does not know which was meant, and saying so by staying quiet is the
 * only defensible answer.
 */
const nearestKnown = (written: string, known: readonly string[]): string | null => {
  const tolerance = Math.min(2, Math.max(1, Math.floor(written.length / 3)));

  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let tied = false;

  for (const candidate of known) {
    // Levenshtein cannot be smaller than the length gap, so this skips most of the table
    // without computing anything.
    if (Math.abs(candidate.length - written.length) > tolerance) {
      continue;
    }

    const distance = editDistance(written, candidate);

    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      tied = false;
    } else if (distance === bestDistance) {
      tied = true;
    }
  }

  return best === null || tied || bestDistance > tolerance ? null : best;
};

const base = (
  element: JsxElement,
  prop: string,
): Pick<
  RawFinding,
  "category" | "file" | "line" | "column" | "rootCause" | "appliedTo" | "candidates" | "replaceWith"
> => ({
  category: "a11y",
  file: element.file,
  line: lineOf(element, prop),
  column: element.column,
  rootCause: null,
  appliedTo: null,
  candidates: [],
  replaceWith: null,
});

export const invalidAriaRule: Rule = {
  id: "a11y.aria.invalid",
  category: "a11y",
  description: "Роль или ARIA-атрибут, которых нет в спецификации",
  run: (context: RuleContext): RawFinding[] => {
    const findings: RawFinding[] = [];

    for (const element of context.observations.jsxElements) {
      const role = element.props["role"];

      if (typeof role === "string" && !isKnownRole(role)) {
        const written = `role="${role}"`;
        const suggestion = isAbstractRole(role) ? null : nearestKnown(role, roleNames());
        const sourceLine = sourceLineOf(context, element.file, lineOf(element, "role"));
        const patchable = suggestion !== null && occursOn(sourceLine, written);

        findings.push({
          ...base(element, "role"),
          rule: "a11y.aria.invalid",
          subkind: isAbstractRole(role) ? "abstractRole" : "unknownRole",
          severity: "error",
          confidence: 1,
          actual: written,
          expected:
            suggestion === null
              ? null
              : { token: null, cssVar: null, component: null, value: `role="${suggestion}"` },
          why: isAbstractRole(role)
            ? `role="${role}" — абстрактная роль. Спецификация запрещает ставить её в разметку: ` +
              "она существует только как основа для других ролей, и вспомогательные технологии её игнорируют."
            : `role="${role}" нет в ARIA 1.2. Атрибут будет проигнорирован, и элемент останется тем, ` +
              "чем был по своему тегу." +
              (suggestion === null ? "" : ` Ближайшая существующая роль — ${suggestion}.`),
          note: null,
          autoFixable: patchable,
          needsAgent: false,
          a11y: {
            wcag: ["4.1.2"],
            pattern: null,
            impact: "Скринридер объявит элемент не тем, чем он выглядит, либо не объявит вовсе.",
            fix: isAbstractRole(role)
              ? "Замените абстрактную роль на конкретную из ARIA 1.2 либо уберите атрибут."
              : suggestion === null
                ? "Сверьтесь со списком ролей ARIA 1.2 и поставьте существующую — или уберите атрибут, " +
                  "если роль тега уже верна."
                : `Исправьте опечатку: role="${suggestion}".`,
          },
          impactKey: `a11y.aria.invalid:role:${role}`,
          replaceWith: patchable ? `role="${suggestion ?? ""}"` : null,
        });
      }

      for (const attribute of ariaAttributesOf(element)) {
        if (!isKnownAriaAttribute(attribute)) {
          const suggestion = nearestKnown(attribute, ariaAttributeNames());
          const sourceLine = sourceLineOf(context, element.file, lineOf(element, attribute));
          const patchable = suggestion !== null && occursOn(sourceLine, attribute);

          findings.push({
            ...base(element, attribute),
            rule: "a11y.aria.invalid",
            subkind: "unknownAttribute",
            severity: "error",
            confidence: 1,
            actual: attribute,
            expected:
              suggestion === null
                ? null
                : { token: null, cssVar: null, component: null, value: suggestion },
            why:
              `${attribute} нет в ARIA 1.2 — скорее всего опечатка. Атрибут молча игнорируется, ` +
              "поэтому состояние, которое он должен был передать, не передаётся вообще." +
              (suggestion === null ? "" : ` Ближайший существующий атрибут — ${suggestion}.`),
            note: null,
            autoFixable: patchable,
            needsAgent: false,
            a11y: {
              wcag: ["4.1.2"],
              pattern: null,
              impact: "Состояние элемента не доходит до вспомогательных технологий.",
              fix:
                suggestion === null
                  ? "Сверьтесь со списком атрибутов ARIA 1.2: существующего атрибута с таким именем нет."
                  : `Исправьте опечатку: ${suggestion}.`,
            },
            impactKey: `a11y.aria.invalid:attr:${attribute}`,
            replaceWith: patchable ? suggestion : null,
          });
          continue;
        }

        // Only meaningful against a role we actually know: without one there is nothing to
        // check support against, and guessing the implicit role of a custom component would
        // produce confident nonsense.
        if (typeof role !== "string" || !isKnownRole(role)) {
          continue;
        }

        if (prohibitedPropsOf(role).includes(attribute)) {
          findings.push({
            ...base(element, attribute),
            rule: "a11y.aria.invalid",
            subkind: "prohibitedAttribute",
            severity: "error",
            confidence: 1,
            actual: `${attribute} на role="${role}"`,
            expected: null,
            why: `Спецификация запрещает ${attribute} на role="${role}".`,
            note: null,
            autoFixable: false,
            needsAgent: false,
            a11y: {
              wcag: ["4.1.2"],
              pattern: null,
              impact: "Запрещённый атрибут игнорируется или ломает объявление элемента.",
              fix: `Уберите ${attribute} — либо смените роль на ту, для которой этот атрибут разрешён.`,
            },
            impactKey: `a11y.aria.invalid:prohibited:${role}:${attribute}`,
          });
        } else if (!roleSupports(role, attribute)) {
          findings.push({
            ...base(element, attribute),
            rule: "a11y.aria.invalid",
            subkind: "unsupportedAttribute",
            severity: "warning",
            confidence: 0.9,
            actual: `${attribute} на role="${role}"`,
            expected: null,
            why: `role="${role}" не поддерживает ${attribute}: атрибут не будет прочитан.`,
            note: null,
            autoFixable: false,
            needsAgent: false,
            a11y: {
              wcag: ["4.1.2"],
              pattern: null,
              impact: "Атрибут не даёт ничего — состояние остаётся необъявленным.",
              fix: `Уберите ${attribute} или поставьте роль, которая его поддерживает.`,
            },
            impactKey: `a11y.aria.invalid:unsupported:${role}:${attribute}`,
          });
        }
      }
    }

    return findings;
  },
};

export const requiredAriaRule: Rule = {
  id: "a11y.aria.required",
  category: "a11y",
  description: "Роль без обязательных ARIA-атрибутов",
  run: (context: RuleContext): RawFinding[] => {
    const findings: RawFinding[] = [];

    for (const element of context.observations.jsxElements) {
      const role = element.props["role"];

      if (typeof role !== "string" || !isKnownRole(role) || element.kitComponent !== null) {
        continue;
      }

      const missing = requiredPropsOf(role).filter((attribute) => !(attribute in element.props));

      if (missing.length === 0) {
        continue;
      }

      findings.push({
        ...base(element, "role"),
        rule: "a11y.aria.required",
        subkind: role,
        severity: "error",
        confidence: 0.95,
        actual: `role="${role}"`,
        expected: null,
        why:
          `role="${role}" обязана нести ${missing.join(", ")}. Без этого состояние элемента ` +
          "не объявляется: он выглядит переключаемым, но всегда сообщает одно и то же.",
        note: null,
        autoFixable: false,
        needsAgent: false,
        a11y: {
          wcag: ["4.1.2"],
          pattern: role,
          impact: `Состояние ${role} не передаётся: пользователь скринридера не узнает, включён элемент или нет.`,
          // Naming the attributes but not their values on purpose: the value is the state,
          // and only the component's own logic knows it.
          fix: `Добавьте ${missing.join(", ")} и обновляйте значение вместе с состоянием элемента.`,
        },
        impactKey: `a11y.aria.required:${role}:${missing.join(",")}`,
      });
    }

    return findings;
  },
};

export const redundantRoleRule: Rule = {
  id: "a11y.aria.redundant",
  category: "a11y",
  description: "Роль дублирует ту, что у тега уже есть",
  run: (context: RuleContext): RawFinding[] => {
    const findings: RawFinding[] = [];

    for (const element of context.observations.jsxElements) {
      const role = element.props["role"];

      if (typeof role !== "string" || !isHostElement(element)) {
        continue;
      }

      if (implicitRoleOf(element.name) !== role) {
        continue;
      }

      // Both quotings occur in real JSX, and the deletion has to match the file's own.
      const sourceLine = sourceLineOf(context, element.file, lineOf(element, "role"));
      const deletion =
        deletionOf(sourceLine, `role="${role}"`) ?? deletionOf(sourceLine, `role='${role}'`);

      findings.push({
        ...base(element, "role"),
        rule: "a11y.aria.redundant",
        subkind: null,
        severity: "info",
        confidence: 1,
        // The text to delete when it was found, so the diff is exact; otherwise the element
        // as written, which at least says where to look.
        actual: deletion ?? `<${element.name} role="${role}">`,
        // No replacement string exists — the fix is a deletion, and offering `<ul>` as
        // something to paste would invite replacing the whole opening tag.
        expected: null,
        why:
          `<${element.name}> уже имеет роль ${role}. Атрибут ничего не добавляет и создаёт впечатление, ` +
          "что семантика держится на нём, — при рефакторинге тег заменят, а роль оставят.",
        note: null,
        autoFixable: deletion !== null,
        needsAgent: false,
        a11y: {
          wcag: [],
          pattern: null,
          impact: "Вреда сейчас нет; риск в том, что явная роль переживёт замену тега.",
          fix: `Удалите role="${role}": тег <${element.name}> несёт эту роль сам.`,
        },
        impactKey: `a11y.aria.redundant:${element.name}`,
        replaceWith: deletion === null ? null : "",
      });
    }

    return findings;
  },
};
