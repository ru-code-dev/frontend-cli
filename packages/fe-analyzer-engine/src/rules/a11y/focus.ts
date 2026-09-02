import type { StyleValue } from "../../domain/observations.ts";
import type { Limitation } from "../../domain/profile.ts";
import { isAnalysableStyleValue, type RawFinding, type Rule, type RuleContext } from "../types.ts";

/**
 * `a11y.focus.suppressed` — `outline: none` with nothing put back in its place. Ported from
 * `hackathon2026/ds-analyzer/src/rules/a11y/focus.ts:1-199`. One string changed: the `note`
 * pointed at `ds.config.json` (source line 172), which v1 does not read.
 *
 * Removing the focus ring costs a keyboard user the ability to see where they are: the
 * control still works, it is simply invisible. The bug survives review by everyone who
 * navigates with a mouse, which is most reviewers.
 *
 * The whole difficulty is telling that apart from the *correct* thing, which looks identical
 * at the declaration: resetting the default ring and drawing a better one. Focus is styled in
 * at least three idioms and the rule has to recognise all of them — `:focus-visible` in
 * stylesheets, `&:focus` in CSS-in-JS, and a state class such as `&$focused` in JSS. A first
 * version recognised only the pseudo-class and reported nine correctly-built components.
 */

/** Properties that can draw a visible focus indicator. */
const INDICATOR_PROPERTIES: ReadonlySet<string> = new Set([
  "outline",
  "outline-color",
  "outline-style",
  "outline-width",
  "outline-offset",
  "box-shadow",
  "border",
  "border-color",
  "border-width",
  "border-bottom",
  "border-bottom-color",
  "background",
  "background-color",
]);

const SUPPRESSING_VALUES: ReadonlySet<string> = new Set(["none", "0", "0px"]);

/**
 * Sources whose selectors survive collection intact.
 *
 * A blanket `outline: none` is only reportable when the file's focus styling — or its absence
 * — is visible, and that depends on the dialect. A JSS style object nests its states as plain
 * keys (`focused: { … }`), and the collector flattens them into the enclosing function name,
 * so nothing distinguishes a file that draws a focus ring from one that does not. Reporting
 * there means guessing, and guessing wrong reported four correctly-built components.
 *
 * `onFocus` findings are exempt from this: seeing a focus selector at all is positive
 * evidence, and positive evidence is trustworthy in any dialect.
 */
const FLATTENED_SOURCES: ReadonlySet<StyleValue["source"]> = new Set([
  "inline-style",
  "jss",
  "ts-literal",
]);

/**
 * Listed by exclusion rather than inclusion, and deliberately so.
 *
 * The first version enumerated the dialects that keep their selectors and forgot
 * `scss-modules` — the very stack it was written for — so the rule went silent on the one case
 * it existed for. Naming the three that lose nesting is a shorter list, and a new stylesheet
 * dialect then defaults to being judged rather than to being ignored.
 */
const keepsSelectors = (source: StyleValue["source"]): boolean => !FLATTENED_SOURCES.has(source);

const isOutlineSuppression = (styleValue: StyleValue): boolean => {
  const normalised = styleValue.value.trim().toLowerCase();

  if (styleValue.property === "outline" || styleValue.property === "outline-style") {
    return SUPPRESSING_VALUES.has(normalised) || normalised.split(/\s+/).includes("none");
  }

  return styleValue.property === "outline-width" && SUPPRESSING_VALUES.has(normalised);
};

/**
 * `true` when a selector addresses the focused state, in any of the idioms in use.
 *
 * Matching the word rather than the pseudo-class is deliberate: `&$focused`, `.is-focused`
 * and `[data-focused]` all mean the same thing to the reader and to the user, and only the
 * spelling differs.
 */
const addressesFocus = (selector: string | null): boolean =>
  selector !== null && /focus/i.test(selector);

/** Draws something the eye can see, as opposed to removing something. */
const drawsIndicator = (styleValue: StyleValue): boolean =>
  INDICATOR_PROPERTIES.has(styleValue.property) &&
  !isOutlineSuppression(styleValue) &&
  styleValue.value.trim() !== "0";

export const suppressedFocusRule: Rule = {
  id: "a11y.focus.suppressed",
  category: "a11y",
  description: "Фокус скрыт через outline: none, и замена не нарисована",
  limitations: (context: RuleContext): Limitation[] =>
    context.observations.styleValues
      .filter(
        (styleValue) =>
          isOutlineSuppression(styleValue) &&
          !styleValue.dynamic &&
          !addressesFocus(styleValue.selector) &&
          !keepsSelectors(styleValue.source),
      )
      .map((styleValue) => ({
        file: styleValue.file,
        line: styleValue.line,
        reason: "unsupported-syntax" as const,
        detail:
          "Кольцо фокуса убрано в объектном стиле, где состояния не различимы после сбора: " +
          "проверить, нарисована ли замена, невозможно. Требует ручной проверки.",
      })),
  run: (context: RuleContext): RawFinding[] => {
    const analysable = context.observations.styleValues.filter(
      (styleValue) => isAnalysableStyleValue(styleValue) && !styleValue.dynamic,
    );

    // Files that style focus at all, and blocks that draw an indicator while doing so.
    const filesStylingFocus = new Set<string>();
    const blocksDrawingIndicator = new Set<string>();

    for (const styleValue of analysable) {
      if (!addressesFocus(styleValue.selector)) {
        continue;
      }

      filesStylingFocus.add(styleValue.file);

      if (drawsIndicator(styleValue)) {
        blocksDrawingIndicator.add(`${styleValue.file} ${styleValue.selector ?? ""}`);
      }
    }

    const findings: RawFinding[] = [];

    for (const styleValue of analysable) {
      if (!isOutlineSuppression(styleValue)) {
        continue;
      }

      const onFocusSelector = addressesFocus(styleValue.selector);

      // Removing the ring inside a focus block is fine when that same block draws its own
      // indicator — the ordinary way to replace a default ring with a designed one.
      if (
        onFocusSelector &&
        blocksDrawingIndicator.has(`${styleValue.file} ${styleValue.selector ?? ""}`)
      ) {
        continue;
      }

      if (!onFocusSelector) {
        // A blanket reset in a file that styles focus somewhere is the standard pattern, and
        // reporting it would punish exactly the teams that did the work.
        if (filesStylingFocus.has(styleValue.file)) {
          continue;
        }

        if (!keepsSelectors(styleValue.source)) {
          continue;
        }
      }

      findings.push({
        rule: "a11y.focus.suppressed",
        subkind: onFocusSelector ? "onFocus" : "blanket",
        category: "a11y",
        severity: "error",
        confidence: onFocusSelector ? 0.95 : 0.85,
        file: styleValue.file,
        line: styleValue.line,
        column: styleValue.column,
        actual: `${styleValue.property}: ${styleValue.value}`,
        expected: null,
        why: onFocusSelector
          ? "Кольцо фокуса убрано прямо в блоке про фокус, и ничего видимого взамен не нарисовано. " +
            "Пользователь клавиатуры перестаёт видеть, где он находится."
          : "Кольцо фокуса убрано, а оформления фокуса в этом файле нет вообще. " +
            "Элемент останется рабочим, но невидимым при навигации с клавиатуры.",
        // The source names the escape hatch its own config file provided
        // (`ds-analyzer/src/rules/a11y/focus.ts:172`). This engine has no such file, so with no
        // adapter the sentence says what the reader can actually do instead.
        note:
          context.kit === null
            ? "Если фокус оформлен в другом файле или глобально, это правило об этом не знает — проверьте вручную."
            : "Если фокус оформлен в другом файле или глобально, отключите правило в ds.config.json.",
        rootCause: styleValue.rootCause,
        appliedTo:
          styleValue.appliedTo?.kind === "kit-component" && styleValue.appliedTo.name !== null
            ? { component: styleValue.appliedTo.name, slot: styleValue.appliedTo.slot }
            : null,
        autoFixable: false,
        needsAgent: false,
        candidates: [],
        a11y: {
          wcag: ["2.4.7"],
          pattern: null,
          impact:
            "Навигация с клавиатуры становится невидимой — непонятно, какой элемент сейчас активен.",
          // `:focus-visible` rather than `:focus`, and said in both variants: it is the reason
          // the ring was removed in the first place — it keeps the outline off a mouse click
          // and on a Tab press, which is what the author actually wanted.
          fix: onFocusSelector
            ? "Нарисуйте в этом же блоке видимый индикатор — outline или box-shadow контрастным цветом."
            : "Уберите сброс либо добавьте :focus-visible с видимым outline: он не показывается по клику мышью.",
        },
        impactKey: "a11y.focus.suppressed",
        replaceWith: null,
      });
    }

    return findings;
  },
};
