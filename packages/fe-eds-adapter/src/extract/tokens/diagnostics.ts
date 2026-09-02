import type { DiagnosticDto, TokenDto } from "../domain/tokens.ts";

import { findCssVariableCollisions } from "./reverse-index.ts";
import { compareStrings } from "@smart-tools/fe-analyzer-engine";

/**
 * Findings about the *design system itself*, produced as a by-product of extraction.
 *
 * These are not consumer-code violations — they describe gaps and inconsistencies in
 * the kit that constrain what the project analyser can check. The most consequential
 * one is `spacing-scale-missing`: without a spacing tier, "custom padding" cannot be
 * defined as "off the scale" and has to fall back to weaker heuristics.
 */

const MAX_SAMPLES = 10;

const sample = (ids: readonly string[]): string[] => [...ids].slice(0, MAX_SAMPLES);

const diagnostic = (
  code: string,
  severity: DiagnosticDto["severity"],
  message: string,
  ids: readonly string[],
): DiagnosticDto => ({
  code,
  severity,
  message,
  samples: sample(ids),
  count: ids.length,
});

/** Path roots that would constitute a spacing scale if the kit had one. */
const SPACING_ROOT_CANDIDATES = ["spacing", "space", "padding", "margin", "gap", "size", "sizes"];

const hasUnresolvedTemplate = (value: unknown): boolean =>
  typeof value === "string" && /\{[^{}]+\}/.test(value);

export const buildTokenDiagnostics = (tokens: readonly TokenDto[]): DiagnosticDto[] => {
  const diagnostics: DiagnosticDto[] = [];

  const refRoots = new Set(
    tokens.filter((token) => token.tier === "ref").map((token) => token.path[0] ?? ""),
  );
  const spacingRoots = SPACING_ROOT_CANDIDATES.filter((candidate) => refRoots.has(candidate));

  if (spacingRoots.length === 0) {
    diagnostics.push(
      diagnostic(
        "spacing-scale-missing",
        "warning",
        "The ref tier defines no spacing/padding scale (only borderRadius, borderWidth and the type ramp). " +
          'Padding and gap values live inside component implementations, so "off-scale padding" in consumer ' +
          "code cannot be decided against a token list and needs a frequency-based heuristic instead.",
        [...refRoots].sort(compareStrings),
      ),
    );
  }

  const unresolved = tokens.filter(
    (token) =>
      hasUnresolvedTemplate(token.resolved.light) || hasUnresolvedTemplate(token.resolved.dark),
  );
  if (unresolved.length > 0) {
    diagnostics.push(
      diagnostic(
        "reference-unresolved",
        "error",
        "Tokens whose resolved value still contains a `{…}` template. These point at a path that does not " +
          "exist in the referenced tier, so consumers receive a literal brace string at runtime.",
        unresolved.map((token) => token.id),
      ),
    );
  }

  const nonFinite = tokens.filter((token) => token.anomalies.includes("non-finite-number"));
  if (nonFinite.length > 0) {
    diagnostics.push(
      diagnostic(
        "value-non-finite",
        "error",
        "Tokens that evaluate to NaN or Infinity at runtime. Consumers receive `NaN` in the theme object, " +
          "which browsers drop as an invalid CSS value. Typically caused by arithmetic applied to an " +
          "unresolved `{…}` template string.",
        nonFinite.map((token) => token.id),
      ),
    );
  }

  const unknownKind = tokens.filter((token) => token.kind === "unknown");
  if (unknownKind.length > 0) {
    diagnostics.push(
      diagnostic(
        "value-kind-unknown",
        "info",
        "Tokens whose value kind could not be inferred from either path or value shape. They are still " +
          "present in the artifact but are excluded from the typed scales.",
        unknownKind.map((token) => token.id),
      ),
    );
  }

  const collisions = findCssVariableCollisions(tokens);
  if (collisions.size > 0) {
    diagnostics.push(
      diagnostic(
        "css-variable-collision",
        "error",
        "Distinct tokens that flatten to the same CSS custom property name. The generator emits both, so the " +
          "last one written wins and the other token is unreachable from CSS.",
        [...collisions].map(([variable, ids]) => `${variable} <- ${ids.join(", ")}`),
      ),
    );
  }

  const hardcodedComp = tokens.filter(
    (token) =>
      token.tier === "comp" &&
      token.references.light.length === 0 &&
      typeof token.resolved.light === "string" &&
      token.category !== "other",
  );
  if (hardcodedComp.length > 0) {
    diagnostics.push(
      diagnostic(
        "comp-token-literal",
        "warning",
        "Component tokens whose value is a literal rather than a reference to the sys/ref tier. These bypass " +
          "theming: they will not change when the theme mode or brand palette changes.",
        hardcodedComp.map((token) => token.id),
      ),
    );
  }

  const themeInvariantColors = tokens.filter(
    (token) => token.tier === "sys" && token.category === "color" && !token.themeDependent,
  );
  if (themeInvariantColors.length > 0) {
    diagnostics.push(
      diagnostic(
        "sys-color-theme-invariant",
        "info",
        "Semantic colour tokens that resolve identically in light and dark mode. Intentional for the " +
          "`*Const` families, but a likely dark-mode gap elsewhere.",
        themeInvariantColors.map((token) => token.id),
      ),
    );
  }

  const unparsedCompKeys = tokens.filter(
    (token) => token.tier === "comp" && token.facets?.category === null,
  );
  if (unparsedCompKeys.length > 0) {
    diagnostics.push(
      diagnostic(
        "comp-key-unparsed",
        "info",
        "Component-token keys that do not match the `[slot][category][modifiers][state]` naming convention, " +
          "so their facets could not be derived. Raw key matching still works for these.",
        unparsedCompKeys.map((token) => token.id),
      ),
    );
  }

  return diagnostics;
};
