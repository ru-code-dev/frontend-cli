import {
  compareStrings,
  TYPOGRAPHY_PROPERTIES,
  type RawFinding,
  type Rule,
  type RuleContext,
  type StyleValue,
} from "@smart-tools/fg-analyzer-engine";

import type { TypographyMatch, TypographyTuple } from "../../kit/spec.ts";
import type { KitContext } from "../kit-context.ts";
import { effectiveValue, referencedToken } from "../style-value.ts";

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
 *
 * ## The anchored case, and why it needs its own path
 *
 * The search above answers "which tuple is this block closest to". When a declaration REFERENCES
 * a tuple's own token — `fontSize: themeTokens.edsSys.Typography.Body.BodyM.fontSize`, which is
 * how a half-migrated EDS 2.x block looks — the block has NAMED the tuple it means, and
 * searching would be answering a question that has already been answered. Worse, it would
 * usually answer it wrong: one matching field out of four falls below the search path's own
 * threshold, so the clearest possible instance of this defect would go unreported.
 *
 * So a block that references a tuple is compared against THAT tuple, and the foreign-family
 * bail-out below does not apply to it: a block that takes its size from the ramp and its face
 * from Inter is not "unmatchable", it is the defect.
 *
 * Nothing here is profile-gated, and nothing needs to be: a block is only formed from
 * declarations with no `var(…)` in them, so an EDS 1.x block can never contain a token
 * reference and this path is unreachable under it.
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

/**
 * Compares a block's fields against ONE named tuple, rather than searching for the best.
 *
 * The same accounting `matchTypography` does — only fields present in the code are compared, a
 * tuple field the kit leaves `null` is skipped — with the tuple fixed instead of ranked.
 */
const compareTo = (
  tuple: TypographyTuple,
  fields: Readonly<Partial<Record<string, string>>>,
): TypographyMatch => {
  const present = Object.entries(fields).filter(
    (entry): entry is [keyof Omit<TypographyTuple, "id">, string] => entry[1] !== undefined,
  );

  let matched = 0;
  const mismatches: TypographyMatch["mismatches"] = [];

  for (const [field, actual] of present) {
    const expected = tuple[field];
    if (expected === null || expected === undefined) continue;
    if (actual.trim().toLowerCase() === expected.trim().toLowerCase()) {
      matched += 1;
    } else {
      mismatches.push({
        property: field.replace(/([A-Z])/g, (letter) => `-${letter.toLowerCase()}`),
        actual,
        expected,
      });
    }
  }

  return { tuple, matched, compared: present.length, mismatches };
};

/** Declarations sharing a file and a selector form one authored type style. */
const blockKeyOf = (styleValue: StyleValue): string =>
  `${styleValue.file}::${styleValue.selector ?? "-"}`;

export const partialTypographyRule = ({ kit }: KitContext): Rule => ({
  id: "token.typography.partial",
  category: "typography",
  description: "Кортеж типографики совпал частично",
  label: { ru: "Типографика набрана вручную", en: "Hand-assembled typography" },
  severity: "warning",
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

    for (const key of [...blocks.keys()].toSorted(compareStrings)) {
      const declarations = blocks.get(key) ?? [];

      if (declarations.length < MIN_FIELDS) {
        continue;
      }

      const fields: Partial<Record<string, string>> = {};
      let namedTuple: TypographyTuple | null = null;
      for (const declaration of declarations) {
        const field = FIELD_BY_PROPERTY[declaration.property];
        if (field !== undefined) {
          // The token's own resolved value when the declaration references one, so both halves
          // of a half-migrated block are compared in the same vocabulary.
          fields[field] = effectiveValue(declaration, kit);
        }
        const token = referencedToken(declaration, kit);
        if (token !== null) {
          namedTuple ??= kit.typographyGroupOf(token);
        }
      }
      const anchored = namedTuple;

      // A foreign face makes the whole tuple unmatchable, and `font.foreign` already says so in
      // stronger terms. Reporting both would be reporting the same fact twice — unless the block
      // itself named a tuple, in which case the mismatched face is part of the finding.
      const family = fields["fontFamily"];
      if (
        anchored === null &&
        family !== undefined &&
        !family.split(",").every((name) => kit.isKnownFontFamily(name))
      ) {
        continue;
      }

      const match = anchored === null ? kit.matchTypography(fields) : compareTo(anchored, fields);
      if (match === null || match.mismatches.length === 0) {
        continue;
      }
      if (anchored === null && match.matched < MIN_FIELDS - 1) {
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
