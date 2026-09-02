import {
  colorRoleOf,
  extractValueLiterals,
  literalColumn,
  type RawFinding,
  type Rule,
  type RuleContext,
  type StyleValue,
} from "@smart-tools/fg-analyzer-engine";

import type { TokenDto } from "../../domain/artifacts.ts";
import type { KitSpec } from "../../kit/spec.ts";
import type { KitContext } from "../kit-context.ts";

/**
 * `token.tier.violation` — a `ref` custom property used where a `sys` one exists. Ported verbatim
 * from `hackathon2026/ds-analyzer/src/rules/tokens/tier.ts:1-96`.
 *
 * This is the one rule that fires on code doing the right thing. A palette variable is a token,
 * correctly referenced — and it is still wrong, because `ref` is a colour and `sys` is a role.
 *
 *   ref.palette.electric.electric700   light #2969e3   dark #2969e3
 *   sys.Border.borderAccent            light #2969e3   dark #2a72f8
 *
 * The two are indistinguishable until somebody switches the theme, at which point the `ref`
 * reference silently stays light. Nothing warns, nothing breaks, the border is just quietly
 * wrong.
 *
 * The rule only fires when a `sys` token of the *same role* holds the same value. Without that
 * condition it would demand fixes that cannot be made: the kit has far more palette entries than
 * semantic roles, and a colour with no role cannot be expressed as one.
 *
 * h5 §1b notes this rule assumes a two-tier `ref`/`sys` token architecture. That assumption is
 * sound *here* — it is a property of the design system this adapter describes, which is exactly
 * the kind of knowledge that belongs in an adapter rather than in the engine.
 *
 * WHICH tiers are primitive and which semantic is the PROFILE's answer (`KitProfile.tokens`),
 * because the two EDS versions disagree: 1.x has one primitive tier (`ref`), 2.x has two
 * (`edsRef`, the legacy palette, and `ref`, a newer material-style one) and its semantic tier is
 * called `edsSys` (S1 break V5). Nothing below names a tier.
 *
 * TWO REFERENCE CHANNELS, one rule. A 1.x consumer writes `var(--sds-eng-palette-electric700)`
 * and the reference is a literal inside the value text; a 2.x consumer writes
 * `themeTokens.edsRef.palette.electric.electric700` and the reference is a member expression the
 * value text cannot express at all. Both arrive here as a token, through the two loops below.
 */

/** One offence: the primitive token that was referenced, and where it was written. */
interface Referenced {
  readonly token: TokenDto;
  /** Column of the reference inside the line, for the caret. */
  readonly column: number;
  /** What the finding quotes as `actual` — the spelling the developer used. */
  readonly actual: string;
}

/**
 * Primitive-tier references in one declaration, from BOTH channels.
 *
 * The css-var pass walks the value text exactly as it always has, so EDS 1.x behaviour is
 * unchanged bit for bit; the js-path pass reads `StyleValue.reference`, which is `null` on
 * every 1.x observation.
 */
const primitiveReferences = (styleValue: StyleValue, kit: KitSpec): Referenced[] => {
  const found: Referenced[] = [];
  const isPrimitive = (token: TokenDto): boolean =>
    kit.profile.tokens.primitive.includes(token.tier);

  for (const literal of extractValueLiterals(styleValue.value)) {
    if (literal.kind !== "var") continue;
    const token = kit.tokenByCssVariable(literal.name);
    if (token === null || !isPrimitive(token)) continue;
    found.push({
      token,
      column: literalColumn(styleValue, literal.offset),
      actual: literal.name,
    });
  }

  const reference = styleValue.reference;
  if (reference !== null && reference.kind === "js-path") {
    const token = kit.tokenForReference(reference);
    if (token !== null && isPrimitive(token)) {
      found.push({
        token,
        column: styleValue.column,
        actual: token.jsPath ?? token.id,
      });
    }
  }

  return found;
};

export const tierViolationRule = ({ kit }: KitContext): Rule => ({
  id: "token.tier.violation",
  category: "token",
  description: "ref-переменная там, где есть sys-роль",
  // Capitalised like the other 61: it was the only label in the catalog starting lowercase
  // (V5 finding #18), and a column of labels with one lowercase row reads as a typo.
  label: { ru: "ref-переменная вместо sys-роли", en: "Ref variable instead of a sys role" },
  severity: "error",
  run: (context: RuleContext): RawFinding[] => {
    const findings: RawFinding[] = [];

    for (const styleValue of context.observations.styleValues) {
      const role = colorRoleOf(styleValue.property);

      for (const { token, column, actual } of primitiveReferences(styleValue, kit)) {
        const value = token.resolved[kit.mode];
        if (typeof value !== "string") {
          continue;
        }

        const semantic = kit.semanticTokenFor(value, role);

        // WHEN A REFERENCE INTO THE PALETTE IS A FINDING. Under `same-role-only` it takes a
        // semantic twin of the same role to exist, because without one the rule would be asking
        // for a fix that cannot be written. Under `any-colour` the reference is wrong on its own
        // — the primitive tiers are the kit's internal composition layer — and the twin, when
        // there is one, is a suggestion rather than the reason.
        if (kit.profile.tokens.tierViolation === "same-role-only") {
          if (semantic === null) continue;
        } else if (token.color === null) {
          // Non-colour primitives (`edsRef.borderRadius.m`) have no semantic layer above them
          // and are exactly what the kit consumes for radii; reporting them would be noise.
          continue;
        }

        // The FILE's dialect picks the channel: a v2 consumer's `.css` gets
        // `var(--sds-eng-edsSys-…)`, its `.css.ts` gets `themeTokens.edsSys.…` (V6 finding #4).
        const expected =
          semantic === null ? null : kit.expectedFor(semantic, null, styleValue.source);
        if (kit.profile.tokens.tierViolation === "same-role-only" && expected === null) {
          continue;
        }

        const dark = semantic?.resolved.dark;
        const themeNote =
          semantic === null
            ? `В ${kit.profile.displayName} роль под этот цвет не объявлена — замену придётся согласовать с дизайн-системой.`
            : typeof dark === "string" && dark.toLowerCase() !== value.toLowerCase()
              ? `В тёмной теме ${semantic.id} становится ${dark}, а ${token.id} остаётся ${value}.`
              : "Значения тем сейчас совпадают, но роль переживёт смену палитры, а краска — нет.";

        findings.push({
          rule: "token.tier.violation",
          subkind: null,
          category: "token",
          severity: "error",
          confidence: 1,
          file: styleValue.file,
          line: styleValue.line,
          column,
          actual,
          expected,
          why: `${actual} — это краска (${token.id}), а не роль. ${themeNote}`,
          note: null,
          rootCause: styleValue.rootCause,
          appliedTo:
            styleValue.appliedTo?.kind === "kit-component" && styleValue.appliedTo.name !== null
              ? { component: styleValue.appliedTo.name, slot: styleValue.appliedTo.slot }
              : null,
          autoFixable: expected !== null,
          needsAgent: expected === null,
          candidates: [],
          impactKey: `token.tier.violation:${actual}`,
          replaceWith: expected?.value ?? null,
        });
      }
    }

    return findings;
  },
});
