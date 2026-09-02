import {
  dimensionScaleOf,
  extractValueLiterals,
  literalColumn,
  parseDimension,
  type DimensionScaleName,
  type RawFinding,
  type Rule,
  type RuleContext,
  type StyleValue,
} from "@smart-tools/fe-analyzer-engine";

import type { KitSpec } from "../../kit/spec.ts";
import type { KitContext } from "../kit-context.ts";

/**
 * `token.literal.dimension` — a raw length written where a token belongs. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/rules/tokens/dimension.ts:1-153`.
 *
 * Three outcomes, and the third is the interesting one.
 *
 * - `onScale` — the value is on the kit's ramp. Still a literal, still reported, but at `info`:
 *   the fix is mechanical and the rendering does not change.
 * - `offScale` — a ramp exists and the value is not on it. Somebody typed a number.
 * - `noScale` — **the kit has no ramp for this property at all.** Padding, margin and gap live
 *   inside component implementations rather than in tokens, so there is nothing to compare
 *   against. The only available evidence is the project's own distribution, so a value is called
 *   magic when it is rare against the team's habits.
 *
 * Which properties take part at all is decided by `dimensionScaleOf`, which lives in the engine
 * — the same function its own spacing-frequency index uses, so the two cannot disagree about
 * which declarations were counted.
 */

const scaleLabel: Readonly<Record<DimensionScaleName, string>> = {
  borderRadiusPx: "скруглений",
  borderWidthPx: "толщин границы",
  fontSizePx: "кеглей",
  lineHeightPx: "интерлиньяжа",
};

const findTokenForPx = (kit: KitSpec, px: number, scale: DimensionScaleName): string | null => {
  // The scale is derived from the tokens, so a value on it always has a token behind it.
  const match = kit.tokens.tokens.find((token) => {
    if (token.cssVariable === null) {
      return false;
    }
    if ((token.dimension?.[kit.mode]?.px ?? null) !== px) {
      return false;
    }
    return scale === "fontSizePx"
      ? token.kind === "fontSize"
      : scale === "lineHeightPx"
        ? token.kind === "lineHeight"
        : token.pathString
            .toLowerCase()
            .includes(scale === "borderRadiusPx" ? "borderradius" : "borderwidth");
  });

  return match?.cssVariable ?? null;
};

const findingsFor = (styleValue: StyleValue, context: RuleContext, kit: KitSpec): RawFinding[] => {
  // A plain TypeScript literal has no property context, so it falls into the scaleless bucket:
  // the value is real, the ramp that would judge it is unknowable.
  const scale =
    styleValue.source === "ts-literal" ? { scale: null } : dimensionScaleOf(styleValue.property);

  if (scale === null) {
    return [];
  }

  const findings: RawFinding[] = [];

  for (const literal of extractValueLiterals(styleValue.value)) {
    if (literal.kind !== "dimension") {
      continue;
    }

    const dimension = parseDimension(literal.raw);
    const px = dimension?.px ?? null;

    // A zero carries no design decision, and a context-dependent unit has no pixel value to
    // compare with anything.
    if (px === null || px === 0) {
      continue;
    }

    const common = {
      rule: "token.literal.dimension",
      category: "token" as const,
      file: styleValue.file,
      line: styleValue.line,
      column: literalColumn(styleValue, literal.offset),
      actual: literal.raw,
      rootCause: styleValue.rootCause,
      appliedTo:
        styleValue.appliedTo?.kind === "kit-component" && styleValue.appliedTo.name !== null
          ? { component: styleValue.appliedTo.name, slot: styleValue.appliedTo.slot }
          : null,
      needsAgent: false,
      candidates: [],
      impactKey: `token.literal.dimension:${styleValue.property}:${literal.raw}`,
    };

    if (scale.scale === null) {
      const magic = context.spacing.isMagic(px);

      findings.push({
        ...common,
        subkind: "noScale",
        severity: magic ? "warning" : "info",
        confidence: magic ? 0.7 : 0.5,
        expected: null,
        why: magic
          ? `${literal.raw} встречается в проекте ${String(context.spacing.counts.get(px) ?? 0)} раз(а) на фоне остальных отступов — похоже на число из макета.`
          : `${literal.raw} — сырой отступ. В ките нет шкалы отступов, поэтому проверить его не с чем; значение зафиксировано как есть.`,
        note:
          context.spacing.total < 12
            ? null
            : "У кита нет шкалы отступов (диагностика spacing-scale-missing) — вердикт опирается на частоту значений в самом проекте.",
        autoFixable: false,
        replaceWith: null,
      });
      continue;
    }

    const values = kit.scaleValues(scale.scale);
    const onScale = values.includes(px);
    const cssVar = onScale ? findTokenForPx(kit, px, scale.scale) : null;
    const neighbours = onScale ? [] : kit.neighboursOnScale(px, scale.scale);

    findings.push({
      ...common,
      subkind: onScale ? "onScale" : "offScale",
      severity: onScale ? "info" : "warning",
      confidence: 1,
      expected:
        cssVar === null
          ? null
          : {
              token: kit.tokenByCssVariable(cssVar)?.id ?? null,
              cssVar,
              component: null,
              value: `var(${cssVar})`,
            },
      why: onScale
        ? `${literal.raw} есть в шкале ${scaleLabel[scale.scale]}, но записан литералом — при изменении шкалы значение здесь не поедет.`
        : `${literal.raw} нет в шкале ${scaleLabel[scale.scale]} [${values.join(", ")}]${neighbours.length > 0 ? `; ближайшие — ${neighbours.join(" и ")}` : ""}.`,
      note: null,
      autoFixable: onScale && cssVar !== null,
      replaceWith: cssVar === null ? null : `var(${cssVar})`,
    });
  }

  return findings;
};

export const dimensionLiteralRule = ({ kit }: KitContext): Rule => ({
  id: "token.literal.dimension",
  category: "token",
  description: "Сырой размер вместо токена: onScale · offScale · noScale",
  run: (context: RuleContext): RawFinding[] =>
    context.observations.styleValues.flatMap((styleValue) => findingsFor(styleValue, context, kit)),
});
