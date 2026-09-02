import {
  buildSketch,
  editDistance,
  sketchSimilarity,
  type Declaration,
} from "@smart-tools/fe-analyzer-engine";

import type { KitSignature } from "../domain/artifacts.ts";

/**
 * Scores a local component against one kit signature. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/rules/components/score.ts:1-274`; only the MinHash import
 * moves, because the engine already carries that module for its own duplicate rule and two
 * copies of a hash family would silently stop agreeing.
 *
 * Heuristics are combined as **independent evidence** (noisy-OR: `1 − Π(1 − wᵢ·sᵢ)`), not
 * averaged. The kit's own knowledge is partial by construction — props of wrapped upstream
 * components are invisible on a bare checkout, many components render no host tags of their own
 * — and averaging would punish the *local* component for the *kit's* blind spots. Under
 * noisy-OR, absent evidence contributes nothing, and only present agreement raises the score. A
 * zero prop overlap with both sides populated still contributes nothing rather than dragging the
 * score down, for the same reason: partial kit knowledge makes disagreement weak evidence,
 * agreement strong.
 *
 * Weights follow architecture.md §5.5. Thresholds live in the rules, not here.
 */

export interface ScorePart {
  readonly heuristic: "name" | "aria" | "props" | "tags" | "css" | "clone";
  /** 0..1 raw agreement before weighting. */
  readonly value: number;
  readonly weight: number;
  /** One line of evidence for the reader; Russian because it lands in the report. */
  readonly detail: string;
}

export interface ComponentScore {
  readonly component: string;
  /** 0..1 combined. */
  readonly score: number;
  readonly parts: readonly ScorePart[];
}

const WEIGHT = {
  name: 0.7,
  aria: 0.8,
  props: 1,
  tags: 0.6,
  css: 0.3,
  clone: 0.9,
} as const;

/** `MyButton`, `AppDialog`, `CustomModalV2` — the noise people wrap kit concepts in. */
const NAME_NOISE =
  /^(?:My|App|Custom|Base|New|Ui|Common|Styled|Wrapped|Legacy|Old)+|(?:V\d+|Component|Wrapper)$/g;

const normalizeName = (name: string): string => name.replace(NAME_NOISE, "").toLowerCase();

const MIN_NAME_LENGTH = 4;
const MAX_NAME_DISTANCE = 2;

const nameScore = (
  local: string,
  signature: KitSignature,
): { value: number; detail: string } | null => {
  const normalized = normalizeName(local);
  const kitNames = [signature.name, ...signature.synonyms];

  for (const kitName of kitNames) {
    if (normalizeName(kitName) === normalized) {
      return {
        value: kitName === signature.name ? 1 : 0.9,
        detail: `имя «${local}» — это «${kitName}»${kitName === signature.name ? "" : ` (синоним ${signature.name})`}`,
      };
    }
  }

  for (const kitName of kitNames) {
    if (kitName.length >= MIN_NAME_LENGTH && normalized.includes(kitName.toLowerCase())) {
      return {
        value: kitName === signature.name ? 0.75 : 0.65,
        detail: `имя содержит «${kitName}»`,
      };
    }
  }

  for (const kitName of kitNames) {
    if (
      kitName.length >= MIN_NAME_LENGTH &&
      normalized.length >= MIN_NAME_LENGTH &&
      editDistance(normalized, kitName.toLowerCase()) <= MAX_NAME_DISTANCE
    ) {
      return { value: 0.55, detail: `имя почти совпадает с «${kitName}»` };
    }
  }

  return null;
};

/**
 * ARIA that identifies nothing: present on half the DOM, so agreement on it says only "both are
 * accessible", not "both are the same widget".
 */
const GENERIC_ARIA = new Set([
  "aria-label",
  "aria-labelledby",
  "aria-describedby",
  "aria-hidden",
  "aria-disabled",
  "aria-live",
]);

/** Overlap coefficient: the kit pattern is allowed to be a subset of what the local renders. */
const ariaScore = (
  local: Declaration,
  signature: KitSignature,
): { value: number; detail: string } | null => {
  const distinctive = (roles: readonly string[], attributes: readonly string[]): Set<string> =>
    new Set([...roles, ...attributes.filter((attribute) => !GENERIC_ARIA.has(attribute))]);

  const localRoles = distinctive(local.ariaRoles, local.ariaAttributes);
  const kitRoles = distinctive(signature.ariaRoles, signature.ariaAttributes);

  if (localRoles.size === 0 || kitRoles.size === 0) {
    return null;
  }

  const shared = [...localRoles].filter((role) => kitRoles.has(role));
  if (shared.length === 0) {
    return null;
  }

  return {
    value: shared.length / Math.min(localRoles.size, kitRoles.size),
    detail: `ARIA совпадает: ${shared.join(", ")}`,
  };
};

/** One shared prop name proves nothing — `size` alone matched a spinner to a form label. */
const MIN_SHARED_PROPS = 2;

const propsScore = (
  local: Declaration,
  signature: KitSignature,
): { value: number; detail: string } | null => {
  if (local.props.length === 0 || signature.propSignature.length === 0) {
    return null;
  }

  const kitProps = new Set(signature.propSignature);
  const shared = local.props.filter((prop) => kitProps.has(prop));
  if (shared.length < MIN_SHARED_PROPS) {
    return null;
  }

  const weightOf = (prop: string): number => Math.max(signature.propWeights[prop] ?? 0, 0);
  const union = new Set([...local.props, ...signature.propSignature]);
  const unionWeight = [...union].reduce((sum, prop) => sum + Math.max(weightOf(prop), 0.1), 0);
  const sharedWeight = shared.reduce((sum, prop) => sum + Math.max(weightOf(prop), 0.1), 0);

  return {
    value: unionWeight === 0 ? 0 : sharedWeight / unionWeight,
    detail: `общие пропы: ${shared.join(", ")}`,
  };
};

/**
 * Share of the kit component's own prop API that the local component reproduces.
 * `OldCard` carrying `accent, elevation, draggable, classes` — Card's entire visible API — is
 * fork-grade evidence even when the code has drifted past shingle similarity.
 */
export const kitApiCoverage = (
  local: Declaration,
  signature: KitSignature,
): { coverage: number; shared: string[] } => {
  const kitProps = new Set(signature.propSignature);
  const shared = local.props.filter((prop) => kitProps.has(prop));
  const weightOf = (prop: string): number => Math.max(signature.propWeights[prop] ?? 0, 0.1);
  const kitWeight = signature.propSignature.reduce((sum, prop) => sum + weightOf(prop), 0);
  const sharedWeight = shared.reduce((sum, prop) => sum + weightOf(prop), 0);

  return { coverage: kitWeight === 0 ? 0 : sharedWeight / kitWeight, shared };
};

/** Exact name identity after noise stripping, for the fork-by-API check. */
export const namesIdentical = (local: string, signature: KitSignature): boolean =>
  [signature.name, ...signature.synonyms].some(
    (kitName) => normalizeName(kitName) === normalizeName(local),
  );

const jaccard = (left: readonly string[], right: readonly string[]): number => {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const shared = [...leftSet].filter((entry) => rightSet.has(entry)).length;
  const union = new Set([...leftSet, ...rightSet]).size;

  return union === 0 ? 0 : shared / union;
};

/**
 * Every JSX component shares boilerplate — imports, destructuring, return-JSX scaffolding — so
 * unrelated components routinely measure 30–45% similar. Below this floor the estimate is that
 * boilerplate, not evidence, and it is excluded entirely.
 */
const CLONE_EVIDENCE_FLOOR = 0.5;

/**
 * Tags that carry no identity: everything is built out of the first row, and the SVG internals
 * are icon guts — the icon rules own those, and letting them identify a *component* matched a
 * static glyph to the kit spinner.
 */
const GENERIC_TAGS = new Set([
  "div",
  "span",
  "p",
  "svg",
  "path",
  "g",
  "defs",
  "desc",
  "clipPath",
  "circle",
  "rect",
  "line",
  "ellipse",
  "polygon",
  "polyline",
  "animateTransform",
  "foreignObject",
]);

export const scoreAgainst = (
  local: Declaration,
  signature: KitSignature,
  localSketch: Uint32Array | null,
  kitSketch: Uint32Array | null,
): ComponentScore => {
  const parts: ScorePart[] = [];

  const name = nameScore(local.name, signature);
  if (name !== null) {
    parts.push({ heuristic: "name", value: name.value, weight: WEIGHT.name, detail: name.detail });
  }

  const aria = ariaScore(local, signature);
  if (aria !== null) {
    parts.push({ heuristic: "aria", value: aria.value, weight: WEIGHT.aria, detail: aria.detail });
  }

  const props = propsScore(local, signature);
  if (props !== null) {
    parts.push({
      heuristic: "props",
      value: props.value,
      weight: WEIGHT.props,
      detail: props.detail,
    });
  }

  const localTags = local.nativeTags.filter((tag) => !GENERIC_TAGS.has(tag));
  const kitTags = signature.nativeTags.filter((tag) => !GENERIC_TAGS.has(tag));
  if (localTags.length > 0 && kitTags.length > 0) {
    const shared = localTags.filter((tag) => kitTags.includes(tag));
    // Damped by shared count: one common <button> between two one-tag sets is a Jaccard of 1.0
    // and evidence of almost nothing.
    const value = jaccard(localTags, kitTags) * Math.min(1, shared.length / 2);
    if (value > 0) {
      parts.push({
        heuristic: "tags",
        value,
        weight: WEIGHT.tags,
        detail: `нативные теги пересекаются: ${shared.join(", ")}`,
      });
    }
  }

  if (local.cssProperties.length > 0 && signature.cssProperties.length > 0) {
    const value = jaccard(local.cssProperties, signature.cssProperties);
    if (value > 0) {
      parts.push({
        heuristic: "css",
        value,
        weight: WEIGHT.css,
        detail: "похожий набор CSS-свойств",
      });
    }
  }

  if (localSketch !== null && kitSketch !== null) {
    const similarity = sketchSimilarity(localSketch, kitSketch);
    if (similarity >= CLONE_EVIDENCE_FLOOR) {
      parts.push({
        heuristic: "clone",
        value: similarity,
        weight: WEIGHT.clone,
        detail: `структура кода совпадает на ${String(Math.round(similarity * 100))}%`,
      });
    }
  }

  const score = 1 - parts.reduce((product, part) => product * (1 - part.weight * part.value), 1);

  return { component: signature.name, score: Math.round(score * 1000) / 1000, parts };
};

export { buildSketch };
