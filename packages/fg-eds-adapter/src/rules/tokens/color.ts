import {
  colorRoleOf,
  extractValueLiterals,
  literalColumn,
  type ColorRole,
  type RawFinding,
  type Rule,
  type RuleContext,
  type Severity,
  type StyleValue,
} from "@smart-tools/fg-analyzer-engine";

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

/**
 * The replacement to offer, in the spelling THIS design system's consumers write.
 *
 * `expectedFor` fills both channels and picks `value` from the file's own style syntax, so a
 * `.css.ts` gets `themeTokens.edsSys.Background.backAccent` and a `.css` next to it gets
 * `var(--sds-eng-edsSys-Background-backAccent)` — the same token, each in the spelling that
 * file can actually hold. A token nameable in neither channel is not a suggestion at all.
 *
 * `offerable` is the second gate, and it is the one V6 finding #1 asked for: under EDS 2.x the
 * nearest token can be raw paint the tier rule forbids, and offering it would be this tool
 * writing this tool's next error. Nothing is offered then — {@link unofferableNote} says why.
 */
const replacementFor = (
  match: ColorMatch,
  kit: KitSpec,
  syntax: StyleValue["source"],
): ReturnType<KitSpec["expectedFor"]> =>
  match.token === null || match.kind === "foreign" || !match.offerable
    ? null
    : kit.expectedFor(match.token, null, syntax);

/**
 * Why a finding that HAS a nearest token carries no replacement — the visible half of V6
 * finding #1.
 *
 * Silence would read as "the kit has nothing like this colour", which is the opposite of what
 * happened: the kit has it, and naming it from product code is the error this report also
 * raises three lines down. So the note names the token, says what is wrong with it, and hands
 * the reader the only action that exists — ask the design system for the role.
 *
 * The wording carries the token id verbatim because `metrics/health.ts` reads it back out to
 * build the KIT GAPS table; the two regular expressions there are the only other place this
 * sentence's shape is known.
 */
const unofferableNote = (match: ColorMatch, role: ColorRole | null, kit: KitSpec): string => {
  const id = match.token?.id ?? "—";
  const where = role === null ? "с этим цветом" : `«${role}» с этим цветом`;

  return kit.isSemanticTokenId(id)
    ? `Ближайший токен ${id} — другая роль; семантической роли ${where} в ките нет. Подставлять роль от другого свойства нельзя, поэтому замена не предлагается — это пробел кита, а не ошибка проекта.`
    : `Ближайший токен — примитив ${id}; семантической роли ${where} в ките нет. На примитив в ${kit.profile.displayName} ссылаться нельзя — это была бы token.tier.violation, — поэтому замена не предлагается: пробел кита, а не ошибка проекта.`;
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

    const replacement = replacementFor(match, kit, styleValue.source);

    // The kit's nearest answer is one this design system forbids product code to write. Ranked
    // FIRST among the notes, because it is the only branch that explains a MISSING replacement
    // and the two below both describe one that is present.
    const unofferable = match.kind !== "foreign" && match.token !== null && !match.offerable;

    // The property names no role (box-shadow, TS literal), yet the value also exists as a sys
    // token. Which token is right depends on intent the analyzer cannot see — a ring that must
    // follow the theme wants the role, a literal white wants the paint. Named replacement stays
    // (ref: visually safe, claims nothing), but it must not ride into a PR silently, and the AI
    // stage gets it flagged for judgement.
    const sysTwins =
      role === null && match.kind === "exact" && !unofferable
        ? match.alternatives.filter((id) => kit.isSemanticTokenId(id))
        : [];
    const ambiguousRole = sysTwins.length > 0;

    const note = unofferable
      ? unofferableNote(match, role, kit)
      : ambiguousRole
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
      expected: replacement,
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
      replaceWith: replacement?.value ?? null,
    });
  }

  return findings;
};

export const colorLiteralRule = ({ kit }: KitContext): Rule => ({
  id: "token.literal.color",
  category: "token",
  description: "Сырой цвет вместо токена: exact · near · shade · foreign",
  label: { ru: "Цвет литералом вместо токена", en: "Colour literal instead of a token" },
  // The shades this rule grades, named — design §2.4 (V5 finding #6). `ru` is the dashboard's
  // own `SUBKIND_LABEL`, pinned by the parity test; `en` is authored here.
  subkindLabels: {
    exact: { ru: "точно токен", en: "exactly a token" },
    near: { ru: "почти токен", en: "nearly a token" },
    shade: { ru: "оттенок токена", en: "a shade of a token" },
    foreign: { ru: "чужой цвет", en: "a colour from outside the palette" },
  },
  // exact -> error, near -> warning, shade -> info, foreign -> warning (SEVERITY_BY_KIND).
  severity: "mixed",
  run: (context: RuleContext): RawFinding[] =>
    context.observations.styleValues.flatMap((styleValue) => findingsFor(styleValue, kit)),
});
