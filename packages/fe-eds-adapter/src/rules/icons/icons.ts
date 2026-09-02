import {
  overElements,
  overImports,
  overStyleValues,
  type RawFinding,
  type Rule,
  type RuleContext,
} from "@smart-tools/fe-analyzer-engine";

import { svgFingerprint } from "../../icons/fingerprint.ts";
import type { IconMatch, IconSpec } from "../../kit/icon-spec.ts";
import type { KitContext } from "../kit-context.ts";

/**
 * Icons that bypass the kit's icon set. Ported from
 * `hackathon2026/ds-analyzer/src/rules/icons/icons.ts:1-263`, minus `foreignIconPackRule`
 * (221-263) — that one needs no kit data at all (h5 §1d) and lives ungated in the engine, which
 * restores the source's wording from `context.kit.iconCount` when this adapter is connected.
 *
 * Two ways an icon enters a project past the design system, two rules here:
 *
 *  - `icon.inline-svg`   — `<svg>` markup pasted into a component;
 *  - `icon.foreign-file` — an imported `.svg` file, or one referenced from CSS `url()`.
 *
 * The verdict is two-tier, matching the colour rules' philosophy. When the kit draws exactly
 * this geometry, the finding is a warning with the kit icon named — a deviation with a known
 * replacement. When it does not, the finding is a `candidate`: input for the design-system team,
 * not debt for the product team. Matching is exact-on-geometry only; "visually similar" is a
 * claim static analysis cannot make honestly.
 */

/** How far past the opening line an inline `<svg>` is allowed to stretch. */
const MAX_INLINE_SVG_LINES = 80;

const CSS_SVG_URL = /url\(\s*['"]?([^'")]+\.svg(?:[?#][^'")]*)?)['"]?\s*\)/gi;

const matchNote = (match: IconMatch): string | null =>
  match.alternatives.length > 0
    ? `Геометрически идентична также: ${match.alternatives.join(", ")}.`
    : null;

const matchedFinding = (
  base: Pick<RawFinding, "rule" | "file" | "line" | "column" | "actual">,
  match: IconMatch,
): RawFinding => ({
  ...base,
  subkind: "kit-icon",
  category: "icon",
  severity: "warning",
  confidence: 0.95,
  expected: { token: null, cssVar: null, component: match.name, value: match.name },
  why:
    `В ките есть ровно эта иконка — ${match.name} (${String(match.size)}px). ` +
    "Собственная копия не перекрасится токенами темы и разойдётся с набором при его обновлении.",
  note: matchNote(match),
  rootCause: null,
  appliedTo: null,
  autoFixable: false,
  needsAgent: true,
  candidates: [{ component: match.name, score: 1, reasons: ["точное совпадение геометрии"] }],
  impactKey: `${base.rule}:${match.name}`,
  replaceWith: null,
});

const unmatchedFinding = (
  base: Pick<RawFinding, "rule" | "file" | "line" | "column" | "actual">,
  icons: IconSpec,
  impactSuffix: string,
): RawFinding => ({
  ...base,
  subkind: "no-match",
  category: "icon",
  severity: "candidate",
  confidence: 0.8,
  expected: null,
  why:
    `Иконка мимо дизайн-системы, и точного совпадения среди ${String(icons.iconCount)} иконок кита нет — ` +
    "кандидат на добавление в набор.",
  note: null,
  rootCause: null,
  appliedTo: null,
  autoFixable: false,
  needsAgent: true,
  candidates: [],
  impactKey: `${base.rule}:${impactSuffix}`,
  replaceWith: null,
});

/**
 * Reassembles the inline `<svg>` element's markup from the file it sits in.
 *
 * The collectors record that an `<svg>` exists; its drawing attributes live only in the source
 * text. Reading them here keeps the observation schema out of it — the fingerprint is a per-rule
 * concern, not a fact every stage needs.
 */
const inlineSvgMarkup = (context: RuleContext, file: string, line: number): string | null => {
  const lines = context.sources.get(file);
  if (lines === undefined) {
    return null;
  }

  const slice = lines.slice(line - 1, line - 1 + MAX_INLINE_SVG_LINES).join("\n");
  const start = slice.indexOf("<svg");
  if (start === -1) {
    return null;
  }
  const end = slice.indexOf("</svg>", start);

  return end === -1 ? slice.slice(start) : slice.slice(start, end + "</svg>".length);
};

export const inlineSvgRule = ({ icons }: KitContext): Rule => ({
  id: "icon.inline-svg",
  category: "icon",
  description: "Инлайновый <svg> вместо иконки кита: kit-icon · no-match",
  run: overElements((element, context) => {
    if (!icons.available || element.name !== "svg") {
      return [];
    }

    const base = {
      rule: "icon.inline-svg",
      file: element.file,
      line: element.line,
      column: element.column,
      actual: "<svg>",
    };

    const markup = inlineSvgMarkup(context, element.file, element.line);
    const geometry = markup === null ? null : svgFingerprint(markup);

    if (geometry === null) {
      // No static geometry — paths built from expressions. Matching is impossible and claiming
      // "not in the kit" would be a guess; the inline icon itself is still worth a card.
      return [unmatchedFinding(base, icons, `${element.file}:${String(element.line)}`)];
    }

    const match = icons.match(geometry.fingerprint);

    return [
      match === null
        ? unmatchedFinding(base, icons, geometry.fingerprint)
        : matchedFinding(base, match),
    ];
  }),
});

export const foreignSvgFileRule = ({ icons }: KitContext): Rule => ({
  id: "icon.foreign-file",
  category: "icon",
  description: "SVG-файл мимо набора иконок кита: kit-icon · no-match",
  run: (context) => {
    if (!icons.available) {
      return [];
    }

    const fromImports = overImports((record, ruleContext) => {
      if (!/\.svg(?:[?#]|$)/.test(record.specifier)) {
        return [];
      }

      const base = {
        rule: "icon.foreign-file",
        file: record.file,
        line: record.line,
        column: record.column,
        actual: record.specifier,
      };

      const content = ruleContext.svg(record.file, record.specifier);
      const geometry = content === null ? null : svgFingerprint(content);

      if (geometry === null) {
        return [unmatchedFinding(base, icons, record.specifier)];
      }

      const match = icons.match(geometry.fingerprint);

      return [
        match === null
          ? unmatchedFinding(base, icons, geometry.fingerprint)
          : matchedFinding(base, match),
      ];
    });

    const fromStyles = overStyleValues((styleValue, ruleContext) => {
      const findings: RawFinding[] = [];

      for (const url of styleValue.value.matchAll(CSS_SVG_URL)) {
        const reference = url[1];
        if (reference === undefined) {
          continue;
        }

        const base = {
          rule: "icon.foreign-file",
          file: styleValue.file,
          line: styleValue.line,
          column: styleValue.column,
          actual: reference,
        };

        const content = ruleContext.svg(styleValue.file, reference);
        const geometry = content === null ? null : svgFingerprint(content);

        if (geometry === null) {
          findings.push(unmatchedFinding(base, icons, reference));
          continue;
        }

        const match = icons.match(geometry.fingerprint);
        findings.push(
          match === null
            ? unmatchedFinding(base, icons, geometry.fingerprint)
            : matchedFinding(base, match),
        );
      }

      return findings;
    });

    return [...fromImports(context), ...fromStyles(context)];
  },
});
