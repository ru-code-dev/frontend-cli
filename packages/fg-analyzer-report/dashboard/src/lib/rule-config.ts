import type {
  FindingCategory,
  RuleCatalogEntry,
  RuleConfig,
  RuleLevel,
  Severity,
  Summary,
} from "../contract.js";

/**
 * THE CONFIG, APPLIED IN THE BROWSER.
 *
 * The payload carries every raw finding (design D11) plus the config the generator summarised
 * under. This module is what turns the second into a view over the first, live, so a reader who
 * asks "and what did the file hide from me?" gets an answer in a dropdown instead of a
 * regenerated report.
 *
 * `resolveLevel` and `applyRuleConfig` are a TRANSCRIPTION of
 * `packages/fg-analyzer-engine/src/config/apply.ts:36-106` — the engine names this file in its
 * own header. Two copies exist because they run in two places: the engine's decides what the
 * console and the summary say, this one decides what the screen says, and the browser cannot
 * import the engine (the dashboard is a zero-dependency single-file build). What keeps them
 * honest is not discipline but `tests/rule-config-parity.test.ts`, which imports BOTH and runs
 * them over a generated table of findings × configs. Anything clever here would be a bug there:
 * the precedence below is spelled out for exactly that reason.
 *
 * `recountFindings` is the same transcription of `src/payload.ts`'s `countFindings`, and the
 * same suite proves the two agree with the engine's own `buildSummary`.
 *
 * Types only from `../contract.js`; no React, no DOM, no `window` — the whole module is pure,
 * which is what lets the parity suite run it under node beside the engine's copy.
 */

/** Every level, in the order the panel's `<select>` lists them. */
export const RULE_LEVELS: readonly RuleLevel[] = [
  "off",
  "on",
  "error",
  "warning",
  "info",
  "candidate",
];

/** Category order, matching the payload's `byCategory` and `CATEGORY_LABEL` in `data.ts`. */
export const CATEGORIES: readonly FindingCategory[] = [
  "token",
  "typography",
  "font",
  "api",
  "override",
  "component",
  "icon",
  "a11y",
];

const SEVERITIES: readonly Severity[] = ["error", "warning", "info", "candidate"];

/**
 * The identity view — nothing hidden, nothing re-graded, no file behind it.
 *
 * Used when a payload predates the feature and carries no `ruleConfig` at all. Renders exactly
 * the report this dashboard rendered before the panel existed.
 */
export const DEFAULT_RULE_CONFIG: RuleConfig = {
  default: "on",
  categories: {},
  rules: {},
  source: { kind: "defaults" },
};

/** What a finding is addressed BY, and nothing else — engine `src/config/apply.ts:17`. */
export interface ConfigurableFinding {
  readonly rule: string;
  readonly subkind: string | null;
  readonly category: FindingCategory;
}

/** The five fields the counters read — mirrors `src/payload.ts`'s `CountableFinding`. */
export interface CountableFinding {
  readonly rule: string;
  readonly category: FindingCategory;
  readonly severity: Severity;
  readonly autoFixable: boolean;
  readonly needsAgent?: boolean | undefined;
}

/**
 * The level in force for one finding, per design D7:
 *
 *   1. `rules["<rule>/<subkind>"]`     — the most specific thing a config can name
 *   2. the LONGEST key in `rules` that is the rule id or a dot-prefix of it
 *   3. `categories[<category>]`
 *   4. `default`
 *
 * "Dot-prefix" and not "prefix": `style.override` addresses `style.override.repaint`, while
 * `token.literal` must NOT be matched by a hypothetical `token.literalism`. Longest wins so
 * that `{"style.override": "off", "style.override.important": "error"}` reads the way it looks
 * — the general rule first, the exception after it — whatever order the keys were written in.
 *
 * One pass, own properties only (`Object.entries`), so a config carrying a key named
 * `toString` cannot resolve through `Object.prototype`.
 */
export const resolveLevel = (finding: ConfigurableFinding, config: RuleConfig): RuleLevel => {
  const subkindKey = finding.subkind === null ? null : `${finding.rule}/${finding.subkind}`;

  let subkindLevel: RuleLevel | undefined;
  let longestKey: string | null = null;
  let longestLevel: RuleLevel | undefined;

  for (const [key, level] of Object.entries(config.rules)) {
    if (subkindKey !== null && key === subkindKey) {
      subkindLevel = level;
      continue;
    }

    if (key === finding.rule || finding.rule.startsWith(`${key}.`)) {
      // Two distinct matching keys cannot share a length: both would be dot-prefixes of the
      // same id, and equal-length prefixes of one string are the same string.
      if (longestKey === null || key.length > longestKey.length) {
        longestKey = key;
        longestLevel = level;
      }
    }
  }

  if (subkindLevel !== undefined) {
    return subkindLevel;
  }

  if (longestLevel !== undefined) {
    return longestLevel;
  }

  return config.categories[finding.category] ?? config.default;
};

/** `false` only for `off`. Named because "not off" reads worse at every call site. */
export const isVisible = (finding: ConfigurableFinding, config: RuleConfig): boolean =>
  resolveLevel(finding, config) !== "off";

/**
 * The visible findings under a config, in the order they arrived.
 *
 * `off` drops, `on` keeps the rule's own severity, a severity level replaces it — and NOTHING
 * else changes. `id`, `impact` and `impactKey` in particular stay the raw ones: they were
 * computed over the whole un-filtered run, every deep link in the report is built on `id`, and
 * every list on the plan/files/a11y screens folds on `impactKey`. Renumbering either to close
 * the gaps would break a shared URL the moment somebody touched a dropdown.
 *
 * A finding whose level does not change its severity is passed through BY IDENTITY, which is
 * what lets the screens' `useMemo`s see an untouched config as an untouched payload.
 */
export const applyRuleConfig = <T extends ConfigurableFinding & { readonly severity: Severity }>(
  findings: readonly T[],
  config: RuleConfig,
): T[] => {
  const visible: T[] = [];

  for (const finding of findings) {
    const level = resolveLevel(finding, config);

    if (level === "off") {
      continue;
    }

    // The spread replaces `severity` in place rather than appending it, so key order survives
    // a re-grade — the same property the generator's byte-for-byte parity suite depends on.
    visible.push(
      level === "on" || level === finding.severity ? finding : { ...finding, severity: level },
    );
  }

  return visible;
};

const emptyCounts = <K extends string>(keys: readonly K[]): Record<K, number> => {
  const counts = {} as Record<K, number>;
  for (const key of keys) {
    counts[key] = 0;
  }
  return counts;
};

/**
 * `summary.findings`, recomputed over the visible set.
 *
 * A transcription of `src/payload.ts`'s `countFindings`, which is itself what the generator
 * runs when the engine carries no counters. Both are proven equal to the engine's
 * `buildSummary` output under the same config by `tests/rule-config-parity.test.ts` — the
 * counters on screen and the counters in the console are then the same number by test, not by
 * coincidence.
 *
 * What is NOT recomputed: `files.clean`. It needs the list of scanned files, which the payload
 * does not carry (it carries findings, not a file inventory), so it stays the generator's value
 * and the screens label it as such. Guessing it from the findings would count a file clean
 * merely because its only finding was switched off — a different and much worse lie than an
 * honestly stale number.
 */
export const recountFindings = (findings: readonly CountableFinding[]): Summary["findings"] => {
  const bySeverity = emptyCounts(SEVERITIES);
  const byCategory = emptyCounts(CATEGORIES);
  const byRule: Record<string, number> = {};
  let autoFixable = 0;
  let needsAgent = 0;

  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byCategory[finding.category] += 1;
    byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
    if (finding.autoFixable) {
      autoFixable += 1;
    }
    if (finding.needsAgent === true) {
      needsAgent += 1;
    }
  }

  return { total: findings.length, bySeverity, byRule, byCategory, autoFixable, needsAgent };
};

/**
 * WHAT THE READER CHANGED, and nothing else.
 *
 * The URL carries the overrides, not the resolved config: a link then says "the file's view,
 * plus these three flips", which survives regenerating the report with a different file and is
 * short enough to paste into a ticket. Embedding the whole config would freeze a copy of
 * somebody's `fg.config.json` into every shared link.
 */
export interface RuleOverrides {
  readonly default?: RuleLevel | undefined;
  readonly categories: Readonly<Partial<Record<FindingCategory, RuleLevel>>>;
  readonly rules: Readonly<Record<string, RuleLevel>>;
}

export const EMPTY_OVERRIDES: RuleOverrides = { categories: {}, rules: {} };

/** How many things the reader has flipped — the number on the chip. */
export const overrideCount = (overrides: RuleOverrides): number =>
  (overrides.default === undefined ? 0 : 1) +
  Object.keys(overrides.categories).length +
  Object.keys(overrides.rules).length;

/** The file's view with the reader's flips on top. Each layer overrides the same layer below. */
export const mergeConfig = (base: RuleConfig, overrides: RuleOverrides): RuleConfig => ({
  default: overrides.default ?? base.default,
  categories: { ...base.categories, ...overrides.categories },
  rules: { ...base.rules, ...overrides.rules },
  // The source is a fact about where the DEFAULTS came from; the reader's flips do not change
  // which file was read, and the panel header keeps naming it.
  source: base.source,
});

const isLevel = (value: string): value is RuleLevel =>
  (RULE_LEVELS as readonly string[]).includes(value);

const isCategory = (value: string): value is FindingCategory =>
  (CATEGORIES as readonly string[]).includes(value);

/**
 * `cfg` ⇄ overrides. `@a11y:off;token.literal.color:warning;a11y.lint/alt-text:on;*:on`.
 *
 * `*` is the default, `@` prefixes a category, everything else is a rule key (an id, a
 * dot-prefix of one, or `<rule>/<subkind>` — the same three shapes the file accepts, design
 * D4/D5). Chosen over JSON-in-a-query-param because a person reading the URL in a code review
 * can see what was switched off.
 *
 * Parsing NEVER throws and never rejects the whole string: a hand-edited or truncated link must
 * degrade to "the flips I could read", not to a blank report. An unknown level, an unknown
 * category or a token without a colon is dropped, and the rest still applies.
 */
export const parseOverrides = (raw: string | null): RuleOverrides => {
  if (raw === null || raw.length === 0) {
    return EMPTY_OVERRIDES;
  }

  let fallback: RuleLevel | undefined;
  const categories: Partial<Record<FindingCategory, RuleLevel>> = {};
  const rules: Record<string, RuleLevel> = {};

  for (const token of raw.split(";")) {
    const separator = token.indexOf(":");
    if (separator <= 0) {
      continue;
    }

    const key = token.slice(0, separator);
    const level = token.slice(separator + 1);
    if (!isLevel(level)) {
      continue;
    }

    if (key === "*") {
      fallback = level;
    } else if (key.startsWith("@")) {
      const category = key.slice(1);
      if (isCategory(category)) {
        categories[category] = level;
      }
    } else {
      rules[key] = level;
    }
  }

  return { ...(fallback === undefined ? {} : { default: fallback }), categories, rules };
};

/**
 * Overrides → `cfg`. `""` when there are none, which keeps the parameter out of the URL.
 *
 * Deterministic: the default first, then categories in payload order, then rules sorted by key.
 * Two readers who flip the same three things in a different order produce the same link, and
 * the round-trip test can compare strings instead of parsed objects.
 */
export const serialiseOverrides = (overrides: RuleOverrides): string => {
  const parts: string[] = [];

  if (overrides.default !== undefined) {
    parts.push(`*:${overrides.default}`);
  }
  for (const category of CATEGORIES) {
    const level = overrides.categories[category];
    if (level !== undefined) {
      parts.push(`@${category}:${level}`);
    }
  }
  for (const key of Object.keys(overrides.rules).toSorted()) {
    parts.push(`${key}:${String(overrides.rules[key])}`);
  }

  return parts.join(";");
};

/**
 * «как в файле» — the panel's seventh `<select>` entry, which is not a level but a removal.
 *
 * Spelled `"inherit"` to match the config FILE's seventh level (`config/names.ts`), because it
 * means the same thing at a different layer: "no opinion here, the scope below decides". In the
 * file that scope is the category; here it is the report's own config.
 */
export const INHERIT_OPTION = "inherit";

/** What a row of the panel can be set to: one of the six levels, or back to the file's. */
export type LevelChoice = RuleLevel | typeof INHERIT_OPTION;

/**
 * Set, replace, or REMOVE one override. Returns a new object — the state is never mutated.
 *
 * The remove path ({@link INHERIT_OPTION}) is what makes the panel's undo per-row. Before it,
 * `withOverride` could only ever add, so the sole way back was «сбросить к файлу» (all of them
 * at once) and a reader who re-picked a row's own file value had that no-op recorded, counted
 * on the chip and serialised into the shared `cfg` link (V4 audit finding 3). Removing an
 * override that is not there is a no-op that returns an equal object, so the caller never has
 * to check first.
 */
export const withOverride = (
  overrides: RuleOverrides,
  target:
    | { kind: "default" }
    | { kind: "category"; id: FindingCategory }
    | { kind: "rule"; id: string },
  choice: LevelChoice,
): RuleOverrides => {
  if (target.kind === "default") {
    // Rebuilt field by field rather than spread-and-delete: `RuleOverrides` has exactly three
    // of them, and an omitted key is how "no override" is spelled everywhere else here.
    return choice === INHERIT_OPTION
      ? { categories: overrides.categories, rules: overrides.rules }
      : { ...overrides, default: choice };
  }
  if (target.kind === "category") {
    const categories = { ...overrides.categories };
    if (choice === INHERIT_OPTION) delete categories[target.id];
    else categories[target.id] = choice;
    return { ...overrides, categories };
  }
  const rules = { ...overrides.rules };
  if (choice === INHERIT_OPTION) delete rules[target.id];
  else rules[target.id] = choice;
  return { ...overrides, rules };
};

/**
 * Visible / hidden counts per bucket, over the RAW findings under one config.
 *
 * Both halves matter to the panel: "0 shown" next to "14 hidden" is the sentence the reader
 * came for, and a panel that only counted what survived could not write it.
 */
export interface RuleTally {
  readonly visible: number;
  readonly hidden: number;
}

const EMPTY_TALLY: RuleTally = { visible: 0, hidden: 0 };

const bump = (tally: Map<string, RuleTally>, key: string, shown: boolean): void => {
  const current = tally.get(key) ?? EMPTY_TALLY;
  tally.set(key, {
    visible: current.visible + (shown ? 1 : 0),
    hidden: current.hidden + (shown ? 0 : 1),
  });
};

/**
 * One pass over the findings, producing the numbers every row of the panel shows.
 *
 * Keyed three ways because the panel has three kinds of row: by category, by finding-level
 * rule id, and by `<rule>/<subkind>` for `a11y.lint`'s 30 sub-rules.
 */
export const tallyFindings = (
  findings: readonly ConfigurableFinding[],
  config: RuleConfig,
): {
  readonly byCategory: ReadonlyMap<string, RuleTally>;
  readonly byRule: ReadonlyMap<string, RuleTally>;
  readonly bySubrule: ReadonlyMap<string, RuleTally>;
} => {
  const byCategory = new Map<string, RuleTally>();
  const byRule = new Map<string, RuleTally>();
  const bySubrule = new Map<string, RuleTally>();

  for (const finding of findings) {
    const shown = isVisible(finding, config);
    bump(byCategory, finding.category, shown);
    bump(byRule, finding.rule, shown);
    if (finding.subkind !== null) {
      bump(bySubrule, `${finding.rule}/${finding.subkind}`, shown);
    }
  }

  return { byCategory, byRule, bySubrule };
};

/**
 * The catalog grouped by category, with the ids the findings carry folded in.
 *
 * A payload generated without a catalog (`ruleCatalog: []` — the documented default) still has
 * to produce a usable panel, so any rule id present in the findings but absent from the catalog
 * is added as a synthetic entry. The panel is then "every rule this report can talk about",
 * which is the smallest honest thing it can be.
 */
export const catalogByCategory = (
  catalog: readonly RuleCatalogEntry[],
  findings: readonly ConfigurableFinding[],
): ReadonlyMap<FindingCategory, readonly RuleCatalogEntry[]> => {
  const known = new Set(catalog.map((entry) => entry.id));
  const extra: RuleCatalogEntry[] = [];

  for (const finding of findings) {
    if (!known.has(finding.rule)) {
      known.add(finding.rule);
      extra.push({
        id: finding.rule,
        category: finding.category,
        description: "",
        builtinSeverity: "mixed",
        subrules: [],
        origin: "engine",
      });
    }
  }

  const grouped = new Map<FindingCategory, RuleCatalogEntry[]>();
  for (const category of CATEGORIES) {
    grouped.set(category, []);
  }
  for (const entry of [...catalog, ...extra]) {
    const bucket = grouped.get(entry.category);
    if (bucket === undefined) {
      grouped.set(entry.category, [entry]);
    } else {
      bucket.push(entry);
    }
  }
  for (const bucket of grouped.values()) {
    bucket.sort((left, right) => left.id.localeCompare(right.id));
  }

  return grouped;
};
