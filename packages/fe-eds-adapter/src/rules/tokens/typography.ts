import {
  compareStrings,
  TYPOGRAPHY_PROPERTIES,
  type RawFinding,
  type Rule,
  type RuleContext,
  type StyleValue,
} from "@smart-tools/fe-analyzer-engine";

import type { KitContext } from "../kit-context.ts";

/**
 * `token.typography.partial` — a type style that half-matches a kit tuple. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/rules/tokens/typography.ts:1-121`.
 *
 * Typography in this kit is a five-field tuple: family, size, weight, line-height,
 * letter-spacing. The single most common real-world deviation is taking the size from the design
 * system and typing the line-height by hand, which produces text that is *almost* right — right
 * enough that nobody notices, wrong enough that vertical rhythm drifts across the product.
 *
 * A block is reported when most of its typographic fields agree with one tuple and at least one
 * does not. Full agreement is left to the individual literal rules, which already report each
 * value; total disagreement is a deliberate custom style and saying so adds nothing.
 */

/** Below this many comparable fields there is no tuple to speak of, only two values. */
const MIN_FIELDS = 3;

const FIELD_BY_PROPERTY: Readonly<
  Record<string, "fontFamily" | "fontSize" | "fontWeight" | "lineHeight" | "letterSpacing">
> = {
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "font-weight": "fontWeight",
  "line-height": "lineHeight",
  "letter-spacing": "letterSpacing",
};

/** Declarations sharing a file and a selector form one authored type style. */
const blockKeyOf = (styleValue: StyleValue): string =>
  `${styleValue.file}::${styleValue.selector ?? "-"}`;

export const partialTypographyRule = ({ kit }: KitContext): Rule => ({
  id: "token.typography.partial",
  category: "typography",
  description: "Кортеж типографики совпал частично",
  run: (context: RuleContext): RawFinding[] => {
    const blocks = new Map<string, StyleValue[]>();

    for (const styleValue of context.observations.styleValues) {
      if (!TYPOGRAPHY_PROPERTIES.has(styleValue.property) || styleValue.value.includes("var(")) {
        continue;
      }
      const key = blockKeyOf(styleValue);
      const bucket = blocks.get(key);
      if (bucket) {
        bucket.push(styleValue);
      } else {
        blocks.set(key, [styleValue]);
      }
    }

    const findings: RawFinding[] = [];

    for (const key of [...blocks.keys()].sort(compareStrings)) {
      const declarations = blocks.get(key) ?? [];

      if (declarations.length < MIN_FIELDS) {
        continue;
      }

      const fields: Partial<Record<string, string>> = {};
      for (const declaration of declarations) {
        const field = FIELD_BY_PROPERTY[declaration.property];
        if (field !== undefined) {
          fields[field] = declaration.value;
        }
      }

      // A foreign face makes the whole tuple unmatchable, and `font.foreign` already says so in
      // stronger terms. Reporting both would be reporting the same fact twice.
      const family = fields["fontFamily"];
      if (family !== undefined && !family.split(",").every((name) => kit.isKnownFontFamily(name))) {
        continue;
      }

      const match = kit.matchTypography(fields);
      if (match === null || match.mismatches.length === 0 || match.matched < MIN_FIELDS - 1) {
        continue;
      }

      const anchor = declarations.reduce((earliest, candidate) =>
        candidate.line < earliest.line ? candidate : earliest,
      );
      const detail = match.mismatches
        .map((mismatch) => `${mismatch.property}: ${mismatch.actual} вместо ${mismatch.expected}`)
        .join("; ");

      findings.push({
        rule: "token.typography.partial",
        subkind: null,
        category: "typography",
        severity: "warning",
        confidence: 0.8,
        file: anchor.file,
        line: anchor.line,
        column: anchor.column,
        actual: [fields["fontSize"], fields["lineHeight"], fields["fontWeight"]]
          .filter(Boolean)
          .join("/"),
        expected: { token: match.tuple.id, cssVar: null, component: null, value: match.tuple.id },
        why: `Стиль совпал с ${match.tuple.id} на ${String(match.matched)} из ${String(match.compared)} полей, расходится в: ${detail}. Это классический случай «кегль из токена, интерлиньяж руками».`,
        note: "Типографика в ките — единый кортеж из пяти полей; брать из него части по одному значит терять вертикальный ритм.",
        rootCause: anchor.rootCause,
        appliedTo:
          anchor.appliedTo?.kind === "kit-component" && anchor.appliedTo.name !== null
            ? { component: anchor.appliedTo.name, slot: anchor.appliedTo.slot }
            : null,
        autoFixable: false,
        needsAgent: false,
        candidates: [],
        impactKey: `token.typography.partial:${match.tuple.id}`,
        replaceWith: null,
      });
    }

    return findings;
  },
});
