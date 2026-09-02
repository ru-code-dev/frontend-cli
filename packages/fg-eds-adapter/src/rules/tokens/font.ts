import {
  literalColumn,
  splitFontFamilies,
  type RawFinding,
  type Rule,
  type RuleContext,
} from "@smart-tools/fg-analyzer-engine";

import type { KitContext } from "../kit-context.ts";

/**
 * `font.foreign` — a typeface outside the kit's stack. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/rules/tokens/font.ts:1-73`.
 *
 * Reported once per declaration rather than once per family: `Inter, sans-serif` is one
 * decision, and `sans-serif` is the fallback every stack ends with.
 *
 * A foreign face is an `error` even though nothing crashes. It is the most visible possible
 * break with the design system — every character on screen is wrong — and unlike a colour it
 * cannot be fixed by substituting a token, because the kit's families are whole stacks rather
 * than single names.
 *
 * h5 §1b flags the suggested replacement as a wart: the custom property below is a hardcoded
 * literal rather than something derived from `kit.scales.fontFamilies`, even though the
 * *detection* right above it is fully parametric. It is kept exactly as written, and this is the
 * one file in the repository where that is the right call — a hardcoded name for *this* design
 * system belongs in *this* design system's adapter, and changing it would break parity against
 * the tool this port has to match byte for byte. An adapter for a different kit writes its own.
 */

export const foreignFontRule = ({ kit }: KitContext): Rule => ({
  id: "font.foreign",
  category: "font",
  description: "Гарнитура вне стека кита",
  label: { ru: "Гарнитура не из кита", en: "Typeface outside the kit" },
  severity: "error",
  run: (context: RuleContext): RawFinding[] => {
    const findings: RawFinding[] = [];
    const stack = kit.scales.fontFamilies;

    for (const styleValue of context.observations.styleValues) {
      if (styleValue.property !== "font-family" || styleValue.value.includes("var(")) {
        continue;
      }

      const foreign = splitFontFamilies(styleValue.value).filter(
        (family) => !kit.isKnownFontFamily(family),
      );
      if (foreign.length === 0) {
        continue;
      }

      // THE FILE'S OWN DIALECT decides the spelling: a `.css` under EDS 2.x gets the custom
      // property, a `.css.ts` gets the member path (V6 finding #4).
      const replacement = kit.expectedFontFamily(styleValue.source);

      findings.push({
        rule: "font.foreign",
        subkind: null,
        category: "font",
        severity: "error",
        confidence: 1,
        file: styleValue.file,
        line: styleValue.line,
        column: literalColumn(styleValue, 0),
        actual: foreign.join(", "),
        expected: replacement,
        why: `${foreign.join(", ")} не входит в стек кита (${stack.length} гарнитур${stack.length === 1 ? "а" : ""}: SB Sans Text / SB Sans Display) — текст будет отрисован чужим шрифтом.`,
        note: "Гарнитуры кита — это целые стеки с фолбэками, поэтому подставлять надо переменную, а не одно имя.",
        rootCause: styleValue.rootCause,
        appliedTo:
          styleValue.appliedTo?.kind === "kit-component" && styleValue.appliedTo.name !== null
            ? { component: styleValue.appliedTo.name, slot: styleValue.appliedTo.slot }
            : null,
        autoFixable: false,
        needsAgent: false,
        candidates: [],
        impactKey: `font.foreign:${foreign.join(",").toLowerCase()}`,
        replaceWith: replacement?.value ?? null,
      });
    }

    return findings;
  },
});
