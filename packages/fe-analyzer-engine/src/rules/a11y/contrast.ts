import { formatRatio, judgeTextContrast } from "../../a11y/contrast.ts";
import { parseColor, type ColorValue } from "../../css/color.ts";
import { parseDimension } from "../../css/dimension.ts";
import type { StyleValue } from "../../domain/observations.ts";
import type { RawFinding, Rule, RuleContext } from "../types.ts";

/**
 * `a11y.contrast.text` — text whose colour does not carry against the background it is
 * written on. Ported from `hackathon2026/ds-analyzer/src/rules/a11y/contrast.ts:1-169`.
 *
 * Two changes, both in the DELTAS table. `colorOf` loses its `var(--…)` branch (source lines
 * 71-79), which resolved a custom property through `context.kit.tokenByCssVariable` and
 * returned `null` for every property that was not one of that kit's tokens — h2 §5.4 records
 * that a project's own `:root{--brand:…}` already fell through it silently, so on a kit-less
 * project the branch and its absence are the same behaviour. And the `fix` sentence no longer
 * tells the reader to take a colour "из ролей кита" (source line 159), advice this engine
 * cannot make good on.
 *
 * Contrast is normally the one check that forces a browser into the pipeline, because the
 * hard part is not the arithmetic but discovering which two colours ended up stacked. Here a
 * useful share of that is already known: when a rule block sets both `color` and
 * `background-color`, the pairing is explicit in the source and the verdict is exact.
 *
 * What this deliberately does *not* do is chase inherited backgrounds. A `color` with no
 * background in the same block might render on anything, and assuming white would manufacture
 * failures on dark themes and miss them on light ones. Those pairs are left alone rather than
 * guessed at — an unreported pair is a known gap, while a wrongly reported one is a reason to
 * stop reading the report.
 */

const COLOR_PROPERTIES: ReadonlySet<string> = new Set(["color"]);
const BACKGROUND_PROPERTIES: ReadonlySet<string> = new Set(["background", "background-color"]);

interface Block {
  readonly color: StyleValue | null;
  readonly background: StyleValue | null;
  readonly fontSize: StyleValue | null;
  readonly fontWeight: StyleValue | null;
}

/** Groups declarations by the block they were written in: one file, one selector. */
const groupIntoBlocks = (styleValues: readonly StyleValue[]): Map<string, Block> => {
  const blocks = new Map<string, Block>();

  for (const styleValue of styleValues) {
    if (styleValue.dynamic || styleValue.selector === null) {
      continue;
    }

    const key = `${styleValue.file} ${styleValue.selector}`;
    const current = blocks.get(key) ?? {
      color: null,
      background: null,
      fontSize: null,
      fontWeight: null,
    };

    if (COLOR_PROPERTIES.has(styleValue.property)) {
      blocks.set(key, { ...current, color: styleValue });
    } else if (BACKGROUND_PROPERTIES.has(styleValue.property)) {
      blocks.set(key, { ...current, background: styleValue });
    } else if (styleValue.property === "font-size") {
      blocks.set(key, { ...current, fontSize: styleValue });
    } else if (styleValue.property === "font-weight") {
      blocks.set(key, { ...current, fontWeight: styleValue });
    }
  }

  return blocks;
};

/**
 * Resolves a declaration to a colour.
 *
 * A value that is a `var(…)` reference resolves to nothing here and the pair is skipped —
 * the same outcome the source produced for any custom property outside its own kit's token
 * table.
 */
const colorOf = (styleValue: StyleValue): ColorValue | null => parseColor(styleValue.value.trim());

const weightOf = (styleValue: StyleValue | null): number | null => {
  if (styleValue === null) {
    return null;
  }

  const named: Record<string, number> = { normal: 400, bold: 700, lighter: 300, bolder: 700 };
  const trimmed = styleValue.value.trim().toLowerCase();
  const parsed = Number.parseInt(trimmed, 10);

  return Number.isNaN(parsed) ? (named[trimmed] ?? null) : parsed;
};

export const textContrastRule: Rule = {
  id: "a11y.contrast.text",
  category: "a11y",
  description: "Текст не набирает контраст против своего фона",
  run: (context: RuleContext): RawFinding[] => {
    const findings: RawFinding[] = [];

    for (const block of groupIntoBlocks(context.observations.styleValues).values()) {
      const { color, background } = block;

      if (color === null || background === null) {
        continue;
      }

      const foregroundColor = colorOf(color);
      const backgroundColor = colorOf(background);

      if (foregroundColor === null || backgroundColor === null) {
        continue;
      }

      const fontSizePx =
        block.fontSize === null ? null : (parseDimension(block.fontSize.value)?.px ?? null);
      const verdict = judgeTextContrast({
        foreground: foregroundColor,
        background: backgroundColor,
        fontSizePx,
        fontWeight: weightOf(block.fontWeight),
      });

      if (verdict.passes) {
        continue;
      }

      findings.push({
        rule: "a11y.contrast.text",
        subkind: verdict.threshold === 3 ? "largeText" : "normalText",
        category: "a11y",
        severity: verdict.ratio < 3 ? "error" : "warning",
        confidence: fontSizePx === null ? 0.8 : 0.95,
        file: color.file,
        line: color.line,
        column: color.column,
        actual: `${color.value} на ${background.value}`,
        expected: null,
        why:
          `Контраст ${formatRatio(verdict.ratio)} при минимуме ${String(verdict.threshold)}:1. ` +
          "Текст этого размера на этом фоне не прочитают при слабом зрении, на солнце или на плохом экране." +
          (fontSizePx === null
            ? " Размер шрифта в этом блоке не задан, поэтому взят строгий порог."
            : ""),
        note: null,
        rootCause: color.rootCause,
        appliedTo:
          color.appliedTo?.kind === "kit-component" && color.appliedTo.name !== null
            ? { component: color.appliedTo.name, slot: color.appliedTo.slot }
            : null,
        autoFixable: false,
        needsAgent: false,
        candidates: [],
        a11y: {
          wcag: [verdict.criterion],
          pattern: null,
          impact: `Текст с контрастом ${formatRatio(verdict.ratio)} нечитаем для значительной доли пользователей.`,
          // No colour is named on purpose. Which of the two to move is a design decision, and
          // picking one here would be a guess presented as a requirement.
          fix:
            `Разведите цвет текста и фона так, чтобы пара давала минимум ` +
            `${String(verdict.threshold)}:1 — обычно достаточно затемнить текст на пару ступеней шкалы.`,
        },
        impactKey: `a11y.contrast.text:${color.value}:${background.value}`,
        replaceWith: null,
      });
    }

    return findings;
  },
};
