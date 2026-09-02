import type { Finding } from "../domain/findings.ts";
import type { RuleConfig, RuleLevel } from "./types.ts";

/**
 * The config as a VIEW over findings. Pure, synchronous, no I/O — and deliberately small
 * enough to be transcribed.
 *
 * It is transcribed: the dashboard runs in a browser over an embedded payload and applies the
 * same config live when the reader flips a rule, so a second copy of these two functions lives
 * in `packages/fg-analyzer-report/dashboard/src/lib/rule-config.ts` with a parity test that
 * feeds both copies the same table. That is why the precedence below is spelled out rather
 * than expressed cleverly: the two implementations have to agree on every edge, including the
 * ones nobody has thought of yet.
 */

/** What the finding is addressed by, and nothing else — so a caller can ask before one exists. */
export type ConfigurableFinding = Pick<Finding, "rule" | "subkind" | "category">;

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
 * that `{"style.override": "off", "style.override.important": "error"}` reads the way it
 * looks — the general rule first, the exception after it — regardless of key order, which
 * JSON does not guarantee and a user should not have to think about.
 *
 * One pass over the keys, own properties only (`Object.entries`), so a config carrying a key
 * named `toString` cannot resolve through `Object.prototype`.
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
 * else changes. `id`, `impact` and `impactKey` in particular are the raw ones: they were
 * computed over the whole un-filtered run, they are what the payload's raw findings carry, and
 * a dashboard that re-derives this set in the browser must land on the same objects. Design
 * D11 is the law here; renumbering `id` to close the gaps would break every deep link in a
 * report the moment its config changed.
 *
 * A finding whose level does not change its severity is passed through BY IDENTITY, not
 * copied. That is measurable on a real project (most findings are unaffected by a typical
 * config) and it is testable, which is why it is stated rather than left to the reader.
 */
export const applyRuleConfig = (findings: readonly Finding[], config: RuleConfig): Finding[] => {
  const visible: Finding[] = [];

  for (const finding of findings) {
    const level = resolveLevel(finding, config);

    if (level === "off") {
      continue;
    }

    // The spread replaces `severity` in place rather than appending it, so key order — which
    // the report's byte-for-byte parity suite depends on — survives a re-grade.
    visible.push(
      level === "on" || level === finding.severity ? finding : { ...finding, severity: level },
    );
  }

  return visible;
};
