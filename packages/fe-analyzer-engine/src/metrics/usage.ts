import type { KitBinding } from "../adapter.ts";
import { extractValueLiterals } from "../css/value.ts";
import type { Finding, Usage } from "../domain/findings.ts";
import type { Declaration, Observations } from "../domain/observations.ts";
import { editDistance } from "../shared/edit-distance.ts";
import { compareStrings, sortStrings } from "../shared/sort.ts";

/**
 * Component and token usage statistics. Ported from
 * `hackathon2026/ds-analyzer/src/metrics/usage.ts:1-369`, with its `kit: KitSpec` parameter
 * replaced by the three queries it actually made — that is the whole change.
 *
 * Computed only when an adapter is connected, because every counter here is relative to a
 * design system: `unusedComponents` is *the kit's* components nobody rendered, `tokenUsage` is
 * references to *its* tokens. With no adapter these are not zero, they are unanswerable.
 *
 * This is the half of the report that is not a complaint. An audit that only lists violations
 * gets read once; one that also shows what is working — which components carry the product,
 * which variants are actually needed, which parts of the kit nobody uses — is something a team
 * comes back to. The variant histogram in particular answers a question the kit's own
 * maintainers cannot answer from their side.
 */

interface ComponentStats {
  usages: number;
  readonly files: Set<string>;
  findings: number;
  overrides: number;
  readonly props: Map<string, Map<string, number>>;
}

const emptyStats = (): ComponentStats => ({
  usages: 0,
  files: new Set(),
  findings: 0,
  overrides: 0,
  props: new Map(),
});

const toRecord = (
  props: ReadonlyMap<string, Map<string, number>>,
): Record<string, Record<string, number>> => {
  const result: Record<string, Record<string, number>> = {};

  for (const key of sortStrings(props.keys())) {
    const values = props.get(key);
    if (values === undefined) {
      continue;
    }
    const inner: Record<string, number> = {};
    for (const value of sortStrings(values.keys())) {
      inner[value] = values.get(value) ?? 0;
    }
    result[key] = inner;
  }

  return result;
};

/** How many lines of a declaration the report shows side by side with the kit candidate. */
const SNIPPET_LINES = 24;

/** Reuse thresholds for promoting a local component to a design-system candidate. */
const CANDIDATE_MIN_USAGES = 3;
const CANDIDATE_MIN_FILES = 2;

/** Below this length, `contains` and small edit distances match by accident. */
const MIN_NAME_LENGTH_FOR_FUZZY = 4;
const MAX_NAME_EDIT_DISTANCE = 2;

/** Rules whose finding means "a design value written by hand" for the token verdict. */
const HARDCODE_RULES: ReadonlySet<string> = new Set([
  "token.literal.color",
  "token.literal.dimension",
  "token.typography.partial",
  "font.foreign",
]);

const STYLE_IMPORT = /\.(?:css|scss|sass|less|styl)$/;

type TokenVerdict = Usage["customComponents"][number]["tokenVerdict"];

/**
 * Does this local component's name point at a kit component?
 *
 * Deliberately conservative: `exact` and `contains` are the renames people actually make
 * (`Spinner`, `MyButton`, `OldCard`); the edit-distance rung only catches typo-grade
 * differences.
 */
const matchName = (
  name: string,
  kitNames: readonly string[],
): { component: string; kind: "exact" | "contains" | "similar" } | null => {
  const lower = name.toLowerCase();

  for (const kitName of kitNames) {
    if (kitName.toLowerCase() === lower) {
      return { component: kitName, kind: "exact" };
    }
  }

  for (const kitName of kitNames) {
    if (kitName.length >= MIN_NAME_LENGTH_FOR_FUZZY && lower.includes(kitName.toLowerCase())) {
      return { component: kitName, kind: "contains" };
    }
  }

  for (const kitName of kitNames) {
    if (
      kitName.length >= MIN_NAME_LENGTH_FOR_FUZZY &&
      name.length >= MIN_NAME_LENGTH_FOR_FUZZY &&
      editDistance(lower, kitName.toLowerCase()) <= MAX_NAME_EDIT_DISTANCE
    ) {
      return { component: kitName, kind: "similar" };
    }
  }

  return null;
};

const snippetOf = (
  declaration: Declaration,
  sources: ReadonlyMap<string, readonly string[]>,
): string => {
  const lines = sources.get(declaration.file);
  if (lines === undefined) {
    return "";
  }
  const slice = lines.slice(declaration.line - 1, declaration.line - 1 + SNIPPET_LINES);
  return slice.join("\n");
};

interface ForeignUse {
  usages: number;
  /** Import specifier → how often, to name the package a third-party component comes from. */
  readonly sources: Map<string, number>;
  readonly files: Set<string>;
}

export const buildUsage = (
  observations: Observations,
  findings: readonly Finding[],
  kit: KitBinding,
  sources: ReadonlyMap<string, readonly string[]> = new Map(),
): Usage => {
  const components = new Map<string, ComponentStats>();
  const foreign = new Map<string, ForeignUse>();

  for (const element of observations.jsxElements) {
    if (element.kitComponent === null) {
      // Host elements are not components in the sense that matters here; a `<div>` is not a
      // missed opportunity to use the design system.
      if (/^[A-Z]/.test(element.name)) {
        const use = foreign.get(element.name) ?? {
          usages: 0,
          sources: new Map<string, number>(),
          files: new Set<string>(),
        };
        use.usages += 1;
        use.files.add(element.file);
        if (element.resolvedFrom !== null) {
          use.sources.set(element.resolvedFrom, (use.sources.get(element.resolvedFrom) ?? 0) + 1);
        }
        foreign.set(element.name, use);
      }
      continue;
    }

    const stats = components.get(element.kitComponent) ?? emptyStats();
    stats.usages += 1;
    stats.files.add(element.file);

    for (const [prop, value] of Object.entries(element.props)) {
      // Only literal values say anything about which variants are needed.
      if (value === null || kit.variantValues(element.kitComponent, prop) === null) {
        continue;
      }
      const byValue = stats.props.get(prop) ?? new Map<string, number>();
      byValue.set(value, (byValue.get(value) ?? 0) + 1);
      stats.props.set(prop, byValue);
    }

    components.set(element.kitComponent, stats);
  }

  for (const finding of findings) {
    const component = finding.appliedTo?.component ?? finding.expected?.component;
    if (component === undefined || component === null) {
      continue;
    }
    const stats = components.get(component);
    if (stats === undefined) {
      continue;
    }
    stats.findings += 1;
    if (finding.category === "override") {
      stats.overrides += 1;
    }
  }

  const tokenUsage: Record<string, number> = {};
  /** Kit-token references per file — the raw material of the token verdict. */
  const tokenRefsByFile = new Map<string, number>();
  for (const styleValue of observations.styleValues) {
    for (const literal of extractValueLiterals(styleValue.value)) {
      if (literal.kind !== "var") {
        continue;
      }
      const tokenId = kit.tokenIdOf(literal.name);
      if (tokenId !== null) {
        tokenUsage[tokenId] = (tokenUsage[tokenId] ?? 0) + 1;
        tokenRefsByFile.set(styleValue.file, (tokenRefsByFile.get(styleValue.file) ?? 0) + 1);
      }
    }
  }

  // Hardcoded design values per file, taken from the findings rather than re-tokenized — the
  // findings already encode every judgement call (zero is not a value, keywords are not
  // colours), and a second counter would inevitably disagree with them.
  const hardcodeByFile = new Map<string, number>();
  for (const finding of findings) {
    if (HARDCODE_RULES.has(finding.rule)) {
      hardcodeByFile.set(finding.file, (hardcodeByFile.get(finding.file) ?? 0) + 1);
    }
  }

  // Stylesheets a file imports; the component's styles live there as often as inline.
  const styleImportsByFile = new Map<string, string[]>();
  for (const record of observations.imports) {
    if (!STYLE_IMPORT.test(record.specifier) || record.resolution.file === null) {
      continue;
    }
    const bucket = styleImportsByFile.get(record.file) ?? [];
    bucket.push(record.resolution.file);
    styleImportsByFile.set(record.file, bucket);
  }

  /**
   * Token verdict of one component: its own file plus the stylesheets that file imports.
   * Styles reaching a component through unrelated global classes cannot be attributed
   * statically — the verdict covers what provably belongs to the component.
   */
  const tokenVerdictOf = (
    declaration: Declaration,
  ): { tokenRefs: number; hardcodedValues: number; tokenVerdict: TokenVerdict } => {
    const files = [declaration.file, ...(styleImportsByFile.get(declaration.file) ?? [])];
    const tokenRefs = files.reduce((sum, file) => sum + (tokenRefsByFile.get(file) ?? 0), 0);
    const hardcodedValues = files.reduce((sum, file) => sum + (hardcodeByFile.get(file) ?? 0), 0);

    const tokenVerdict: TokenVerdict =
      tokenRefs > 0 && hardcodedValues === 0
        ? "tokens"
        : tokenRefs > 0
          ? "mixed"
          : hardcodedValues > 0
            ? "hardcode"
            : "no-styles";

    return { tokenRefs, hardcodedValues, tokenVerdict };
  };

  const used = new Set(components.keys());
  const kitNames = kit.componentNames();

  // One declaration per name: with a name collision the larger body is the one someone would
  // actually mistake for a kit component.
  const declarationByName = new Map<string, Declaration>();
  for (const declaration of observations.declarations) {
    if (declaration.kind !== "component" && declaration.kind !== "styled-component") {
      continue;
    }
    const existing = declarationByName.get(declaration.name);
    if (existing === undefined || declaration.elementCount > existing.elementCount) {
      declarationByName.set(declaration.name, declaration);
    }
  }

  const customComponents: Usage["customComponents"] = [];
  for (const [name, declaration] of declarationByName.entries()) {
    const use = foreign.get(name);
    const usages = use?.usages ?? 0;
    const filesCount = use?.files.size ?? 0;
    const nameMatch = matchName(name, kitNames);
    const reused = usages >= CANDIDATE_MIN_USAGES && filesCount >= CANDIDATE_MIN_FILES;

    // Feature screens rendered once are not design-system material; without this cut the list
    // is every component in the product and nobody reads it.
    if (nameMatch === null && !reused && !declaration.hasInlineSvg) {
      continue;
    }

    customComponents.push({
      name,
      file: declaration.file,
      line: declaration.line,
      usages,
      files: filesCount,
      props: declaration.props,
      kitComponentsUsed: declaration.kitComponentsUsed,
      hasInlineSvg: declaration.hasInlineSvg,
      snippet: snippetOf(declaration, sources),
      verdict: nameMatch !== null ? "kit-like" : reused ? "kit-candidate" : "local",
      nameMatch,
      ...tokenVerdictOf(declaration),
    });
  }
  customComponents.sort(
    (left, right) => right.usages - left.usages || compareStrings(left.name, right.name),
  );

  // One scale, one hundred per cent: every rendered component element lands in exactly one
  // bucket, so the breakdown always sums to the total.
  const elementBreakdown = {
    total: 0,
    kit: 0,
    kitClean: 0,
    customTokens: 0,
    customMixed: 0,
    customHardcode: 0,
    customUnstyled: 0,
    foreign: 0,
  };
  for (const element of observations.jsxElements) {
    if (!/^[A-Z]/.test(element.name)) {
      continue;
    }
    elementBreakdown.total += 1;

    if (element.kitComponent !== null) {
      elementBreakdown.kit += 1;
      if ((components.get(element.kitComponent)?.findings ?? 0) === 0) {
        elementBreakdown.kitClean += 1;
      }
      continue;
    }

    const declaration = declarationByName.get(element.name);
    if (declaration === undefined) {
      elementBreakdown.foreign += 1;
      continue;
    }

    switch (tokenVerdictOf(declaration).tokenVerdict) {
      case "tokens":
        elementBreakdown.customTokens += 1;
        break;
      case "mixed":
        elementBreakdown.customMixed += 1;
        break;
      case "hardcode":
        elementBreakdown.customHardcode += 1;
        break;
      case "no-styles":
        elementBreakdown.customUnstyled += 1;
        break;
    }
  }

  return {
    components: [...components.entries()]
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([name, stats]) => ({
        name,
        usages: stats.usages,
        files: stats.files.size,
        findings: stats.findings,
        overrides: stats.overrides,
        props: toRecord(stats.props),
      })),
    unusedComponents: kitNames.filter((name) => !used.has(name)),
    foreignComponents: [...foreign.entries()]
      .map(([name, use]) => {
        const local = declarationByName.has(name);
        const topSource = [...use.sources.entries()].sort(
          (left, right) => right[1] - left[1] || compareStrings(left[0], right[0]),
        )[0];

        return { name, usages: use.usages, local, source: local ? null : (topSource?.[0] ?? null) };
      })
      .sort((left, right) => right.usages - left.usages || compareStrings(left.name, right.name)),
    customComponents,
    elementBreakdown,
    tokenUsage: Object.fromEntries(
      sortStrings(Object.keys(tokenUsage)).map((id) => [id, tokenUsage[id] ?? 0]),
    ),
  };
};
