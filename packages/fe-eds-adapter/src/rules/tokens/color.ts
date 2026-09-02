import {
  colorRoleOf,
  extractValueLiterals,
  literalColumn,
  type RawFinding,
  type Rule,
  type RuleContext,
  type Severity,
  type StyleValue,
} from "@smart-tools/fe-analyzer-engine";

import type { ColorMatch, ColorMatchKind, KitSpec } from "../../kit/spec.ts";
import type { KitContext } from "../kit-context.ts";

/**
 * `token.literal.color` — a raw colour written where a token belongs. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/rules/tokens/color.ts:1-138`; only the shape changes, from a
 * module-level `Rule` reading `context.kit` to a factory closing over one.
 *
 * **Every raw colour is a finding, without exception.** A hex that happens to equal `pink500` is
 * not the token: it will not move when the palette moves, and it will not switch when the theme
 * switches. Whether it matches, nearly matches, or matches nothing changes only what is offered
 * as a replacement.
 *
 * That is also why the four outcomes are subkinds of one rule rather than four rules. The
 * headline number has to be honest — "142 raw colours" — and four separate counters let a large
 * problem read as four small ones.
 *
 * The `near` bucket is the one worth having. A value 0.0007 away in OKLab is indistinguishable
 * on screen, which is exactly why nobody notices it drifting from the design system.
 */

const SEVERITY_BY_KIND: Readonly<Record<ColorMatchKind, Severity>> = {
  exact: "error",
  near: "warning",
  shade: "info",
  foreign: "warning",
};

const explain = (match: ColorMatch, actual: string): string => {
  switch (match.kind) {
    case "exact":
      return `${actual} — это в точности ${match.token?.id ?? "токен кита"}, но записан литералом: при смене палитры значение здесь не поменяется.`;
    case "near":
      return `${actual} визуально неотличим от ${match.token?.id ?? "токена"} (ΔE ${match.distance.toFixed(4)}), но токеном не является.`;
    case "shade":
      return `${actual} — свой оттенок; ближайший токен ${match.token?.id ?? "—"} отличается на ΔE ${match.distance.toFixed(3)}.`;
    case "foreign":
      return `${actual} не входит в палитру кита: ближайший токен дальше ΔE 0.1.`;
  }
};

const replacementFor = (
  match: ColorMatch,
): { readonly token: string; readonly cssVar: string } | null => {
  if (match.token === null || match.kind === "foreign") {
    return null;
  }

  const { id, cssVariable } = match.token;

  // A token with no custom property cannot be referenced from consumer code.
  return cssVariable === null ? null : { token: id, cssVar: cssVariable };
};

const findingsFor = (styleValue: StyleValue, kit: KitSpec): RawFinding[] => {
  const role = styleValue.source === "ts-literal" ? null : colorRoleOf(styleValue.property);
  const literals = extractValueLiterals(styleValue.value, {
    allowNamedColors: styleValue.source !== "ts-literal",
  });

  const findings: RawFinding[] = [];

  for (const literal of literals) {
    if (literal.kind !== "color") {
      continue;
    }

    const match = kit.matchColor(literal.raw, role);
    if (match === null) {
      continue;
    }

    const replacement = replacementFor(match);

    // The property names no role (box-shadow, TS literal), yet the value also exists as a sys
    // token. Which token is right depends on intent the analyzer cannot see — a ring that must
    // follow the theme wants the role, a literal white wants the paint. Named replacement stays
    // (ref: visually safe, claims nothing), but it must not ride into a PR silently, and the AI
    // stage gets it flagged for judgement.
    const sysTwins =
      role === null && match.kind === "exact"
        ? match.alternatives.filter((id) => id.startsWith("sys."))
        : [];
    const ambiguousRole = sysTwins.length > 0;

    const note = ambiguousRole
      ? `Роль свойства неизвестна, а значение совпадает и с ${sysTwins.join(", ")}. Если цвет должен следовать за темой — выберите роль; ref-замена безопасна визуально, но семантики не несёт.`
      : match.roleGap && match.token !== null
        ? `В ките нет sys-роли «${role ?? "—"}» с этим цветом — подставлен ref-токен. Значение не переключится в тёмной теме; это пробел кита, а не ошибка проекта.`
        : match.kind === "near"
          ? "Цвет похож на токен, но им не является — скорее всего, пипетка из макета вместо переменной."
          : null;

    findings.push({
      rule: "token.literal.color",
      subkind: match.kind,
      category: "token",
      severity: SEVERITY_BY_KIND[match.kind],
      confidence: ambiguousRole
        ? 0.7
        : match.kind === "exact"
          ? 1
          : match.kind === "foreign"
            ? 0.9
            : 0.85,
      file: styleValue.file,
      line: styleValue.line,
      column: literalColumn(styleValue, literal.offset),
      actual: literal.raw,
      expected:
        replacement === null
          ? null
          : {
              token: replacement.token,
              cssVar: replacement.cssVar,
              component: null,
              value: `var(${replacement.cssVar})`,
            },
      why: explain(match, literal.raw),
      note,
      rootCause: styleValue.rootCause,
      appliedTo:
        styleValue.appliedTo?.kind === "kit-component" && styleValue.appliedTo.name !== null
          ? { component: styleValue.appliedTo.name, slot: styleValue.appliedTo.slot }
          : null,
      // An exact match is a pure substitution: the rendered colour does not change. The
      // ambiguous-role case is excluded — visually safe, but the tier choice needs a human or
      // the AI stage, so it must not ride into a PR silently.
      autoFixable: match.kind === "exact" && replacement !== null && !ambiguousRole,
      needsAgent: ambiguousRole,
      candidates: [],
      impactKey: `token.literal.color:${literal.raw.toLowerCase()}`,
      replaceWith: replacement === null ? null : `var(${replacement.cssVar})`,
    });
  }

  return findings;
};

export const colorLiteralRule = ({ kit }: KitContext): Rule => ({
  id: "token.literal.color",
  category: "token",
  description: "Сырой цвет вместо токена: exact · near · shade · foreign",
  run: (context: RuleContext): RawFinding[] =>
    context.observations.styleValues.flatMap((styleValue) => findingsFor(styleValue, kit)),
});
