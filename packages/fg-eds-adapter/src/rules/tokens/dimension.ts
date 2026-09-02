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
} from "@smart-tools/fg-analyzer-engine";

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

const findTokenForPx = (
  kit: KitSpec,
  px: number,
  scale: DimensionScaleName,
  syntax: StyleValue["source"],
) => {
  // The scale is derived from the tokens, so a value on it always has a token behind it.
  const match = kit.tokens.tokens.find((token) => {
    if (token.cssVariable === null && (token.jsPath ?? null) === null) {
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

  // The SYNTAX of the file the literal was written in, so a `.css` never gets a member path
  // as its paste-ready value (V6 finding #4).
  return match === undefined ? null : kit.expectedFor(match, null, syntax);
};

const findingsFor = (styleValue: StyleValue, context: RuleContext, kit: KitSpec): RawFinding[] => {
  // A plain TypeScript literal has no property context, so it falls into the scaleless bucket:
  // the value is real, the ramp that would judge it is unknowable.
  const declared =
    styleValue.source === "ts-literal" ? { scale: null } : dimensionScaleOf(styleValue.property);

  // A property the engine's list declines. Whether it is still judged is the profile's answer,
  // and it turns on whether the kit publishes enough scale to judge it with.
  const scale =
    declared ?? (kit.profile.dimensions.governs === "all-lengths" ? { scale: null } : null);

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
      // NO NAMED RAMP for this property. Which evidence decides is the profile's answer, and
      // the two kits genuinely differ. EDS 1.x publishes no spacing tier — its own
      // `spacing-scale-missing` diagnostic — so the only thing to judge a `padding` against is
      // how rare the value is in the project itself. EDS 2.x's theme resolves to a complete
      // 41-value pixel set covering spacing, radii and the ramp, so the kit answers directly
      // and the project's habits are not consulted at all.
      if (kit.profile.dimensions.scaleless === "kit-dimensions") {
        if (kit.scales.allDimensionPx.includes(px)) {
          continue;
        }

        const neighbours = kit.neighboursOnAllDimensions(px);

        findings.push({
          ...common,
          subkind: "offScale",
          severity: "warning",
          confidence: 0.9,
          expected: null,
          why: `${literal.raw} нет среди значений, к которым разрешается тема кита (${String(kit.scales.allDimensionPx.length)} шагов)${neighbours.length > 0 ? `; ближайшие — ${neighbours.join(" и ")}` : ""}.`,
          note: `У свойства ${styleValue.property} нет именованной шкалы, поэтому сверка идёт со всем набором размеров кита.`,
          autoFixable: false,
          replaceWith: null,
        });
        continue;
      }

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

    // A LITERAL THAT IS ON THE RAMP. EDS 1.x reports it at `info` — the value is right and the
    // reference is missing, and the report has always counted that. EDS 2.x does not, and the
    // reason is a property of the kit rather than a preference: its ramp is complete, so a v2
    // project writes on-scale numbers constantly (`gap: 8`, `height: 16`) and an `info` on each
    // would bury the values that really are off the scale.
    if (onScale && !kit.profile.dimensions.reportOnScale) {
      continue;
    }

    const replacement = onScale ? findTokenForPx(kit, px, scale.scale, styleValue.source) : null;
    const neighbours = onScale ? [] : kit.neighboursOnScale(px, scale.scale);

    findings.push({
      ...common,
      subkind: onScale ? "onScale" : "offScale",
      severity: onScale ? "info" : "warning",
      confidence: 1,
      expected: replacement,
      why: onScale
        ? `${literal.raw} есть в шкале ${scaleLabel[scale.scale]}, но записан литералом — при изменении шкалы значение здесь не поедет.`
        : `${literal.raw} нет в шкале ${scaleLabel[scale.scale]} [${values.join(", ")}]${neighbours.length > 0 ? `; ближайшие — ${neighbours.join(" и ")}` : ""}.`,
      note: null,
      autoFixable: onScale && replacement !== null,
      replaceWith: replacement?.value ?? null,
    });
  }

  return findings;
};

export const dimensionLiteralRule = ({ kit }: KitContext): Rule => ({
  id: "token.literal.dimension",
  category: "token",
  description: "Сырой размер вместо токена: onScale · offScale · noScale",
  label: { ru: "Размер литералом вместо токена", en: "Size literal instead of a token" },
  // The shades this rule grades, named — design §2.4 (V5 finding #6). `ru` is the dashboard's
  // own `SUBKIND_LABEL`, pinned by the parity test; `en` is authored here.
  subkindLabels: {
    onScale: { ru: "значение есть на шкале", en: "the value is on the scale" },
    offScale: { ru: "мимо шкалы", en: "off the scale" },
    noScale: { ru: "шкалы нет — магическое число", en: "no scale — a magic number" },
  },
  // On-scale -> info, off-scale -> warning, and a scaleless magic number -> warning.
  severity: "mixed",
  run: (context: RuleContext): RawFinding[] =>
    context.observations.styleValues.flatMap((styleValue) => findingsFor(styleValue, context, kit)),
});
