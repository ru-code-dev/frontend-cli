import type { Declaration, JsxElement } from "../../domain/observations.ts";
import type { RawFinding, Rule, RuleContext } from "../types.ts";

/**
 * `a11y.pattern.focus` — hand-rolled dialogs that trap nothing and close on nothing. Ported
 * from `hackathon2026/ds-analyzer/src/rules/a11y/dialog.ts:1-141`.
 *
 * The one thing not carried over is the optional `equivalent` suggestion — "the kit's Modal
 * already does this" — which the source computes as
 * `context.a11y.available ? context.a11y.canonicalComponentFor('dialog') : null` (source line
 * 86) and then branches on four times (98-101, 105, 111-124, 130-132). With no kit spec
 * loaded that expression is `null` on every run, so all four branches take their `null` arm;
 * the branches are dropped rather than kept as unreachable code, and the finding this rule
 * emits is byte-identical to what the source emits when `a11y.available === false` — the case
 * h2 §2 row 9 calls out as degrading cleanly. The `kitComponent !== null` skip (source line
 * 49) is kept as a dead-false check, like the other element rules'.
 *
 * A modal has three obligations beyond its markup, and none of them are visible to a tool
 * that inspects attributes or a rendered snapshot: `Escape` closes it, focus stays inside
 * while it is open, and focus returns to whatever opened it. `role="dialog"` plus
 * `aria-modal="true"` satisfies every ARIA checker in existence while delivering a dialog
 * that a keyboard user can neither leave nor escape.
 *
 * The evidence is read at the declaration rather than the element, because that is where
 * these obligations are met: `Escape` usually arrives through a `useEffect` listener rather
 * than a JSX prop, and focus is moved through a ref in a hook. An element-level check would
 * report every correctly-built dialog in the project.
 */

const DIALOG_ROLES: ReadonlySet<string> = new Set(["dialog", "alertdialog"]);

/** Names that appear when a component moves focus on purpose. */
const FOCUS_HINTS = ["focus", "Focus", "autoFocus", "tabIndex"];

const isDialogElement = (element: JsxElement): boolean => {
  const role = element.props["role"];

  return (typeof role === "string" && DIALOG_ROLES.has(role)) || "aria-modal" in element.props;
};

/** The declaration a dialog element sits inside — the scope its obligations are met at. */
const owningDeclaration = (
  element: JsxElement,
  declarations: readonly Declaration[],
): Declaration | null => {
  const candidates = declarations.filter(
    (declaration) => declaration.file === element.file && declaration.line <= element.line,
  );

  // The closest declaration above the element is the one that renders it.
  return candidates.sort((left, right) => right.line - left.line)[0] ?? null;
};

export const dialogFocusRule: Rule = {
  id: "a11y.pattern.focus",
  category: "a11y",
  description: "Диалог не закрывается по Escape или не удерживает фокус",
  run: (context: RuleContext): RawFinding[] => {
    const findings: RawFinding[] = [];
    const seen = new Set<string>();

    for (const element of context.observations.jsxElements) {
      if (!isDialogElement(element) || element.kitComponent !== null) {
        continue;
      }

      const owner = owningDeclaration(element, context.observations.declarations);

      // Without an owning declaration there is no scope to judge: the obligations may be met
      // anywhere, and a finding would be a guess.
      if (owner === null) {
        continue;
      }

      const key = `${owner.file}:${owner.name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const handlesEscape = owner.keysHandled.includes("Escape");
      const movesFocus =
        owner.props.some((prop) => FOCUS_HINTS.some((hint) => prop.includes(hint))) ||
        owner.ariaAttributes.includes("aria-activedescendant") ||
        owner.eventHandlers.includes("onFocus") ||
        owner.eventHandlers.includes("onBlur");

      const missing: string[] = [];
      if (!handlesEscape) {
        missing.push("закрытие по Escape");
      }
      if (!movesFocus) {
        missing.push("удержание и возврат фокуса");
      }

      if (missing.length === 0) {
        continue;
      }

      findings.push({
        rule: "a11y.pattern.focus",
        subkind: handlesEscape ? "noFocusTrap" : "noEscape",
        category: "a11y",
        severity: "error",
        confidence: 0.85,
        file: element.file,
        line: element.propLines["role"] ?? element.line,
        column: element.column,
        actual: `<${element.name} role="dialog">`,
        expected: null,
        why:
          `Диалог ${owner.name} объявлен ролью, но в нём не найдено: ${missing.join(", ")}. ` +
          "Пользователь клавиатуры откроет его и не сможет ни выйти, ни вернуться к тому, что открыл.",
        note: "Признаки читаются синтаксически: фокус, перенесённый через внешний хук, отсюда не виден.",
        rootCause: { file: owner.file, line: owner.line, name: owner.name },
        appliedTo: null,
        autoFixable: false,
        needsAgent: true,
        candidates: [],
        a11y: {
          wcag: handlesEscape ? ["2.1.2"] : ["2.1.2", "2.4.3"],
          pattern: "dialog-modal",
          impact:
            "Фокус остаётся заперт вне диалога или не возвращается: пользователь клавиатуры теряет управление.",
          fix: `Допишите недостающее: ${missing.join(", ")}.`,
        },
        impactKey: "a11y.pattern.focus",
        replaceWith: null,
      });
    }

    return findings;
  },
};
