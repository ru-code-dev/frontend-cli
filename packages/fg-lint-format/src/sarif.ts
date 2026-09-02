/**
 * `sarif` — SARIF 2.1.0, the OASIS interchange format GitHub code scanning, Azure DevOps and
 * most static-analysis viewers ingest.
 *
 * Shape fixed by design §6; the members it names are exactly the ones the structural test
 * validates. Four decisions in here are not restatements of the design and are worth reading:
 *
 *   `ruleIndex` IS AN INDEX INTO `tool.driver.rules`, and `tool.driver.rules` comes from the
 *   RULE CATALOG — not from the findings. That is what makes the rules table complete (a
 *   viewer can list every rule the analyser could have reported, not only the ones that fired)
 *   and it is why a finding whose `rule` is not in the catalog gets `ruleId` but NO
 *   `ruleIndex`: pointing at the wrong row is worse than pointing at nothing, and SARIF treats
 *   an absent `ruleIndex` as "unknown", which is the truth in that case.
 *
 *   LOCATIONS ARE RELATIVE + `uriBaseId`, never absolute. An absolute path in a SARIF file is
 *   what makes a report unusable on the machine that did not produce it; `%SRCROOT%` and a
 *   single `originalUriBaseIds` entry let the consumer re-root the whole run. Backslashes
 *   become forward slashes because `artifactLocation.uri` is a URI reference, not a path.
 *
 *   `mixed` IS NOT A SARIF LEVEL. A catalog rule that grades its own findings per case (
 *   `a11y.lint`, `style.override`…) has `builtinSeverity: "mixed"`, and the SARIF enumeration
 *   is `none|note|warning|error`. It maps to `warning`, which is the level the SARIF spec
 *   itself falls back to when `defaultConfiguration.level` is absent — so a viewer shows the
 *   same thing it would show for a rule that declined to state a default. The per-result
 *   `level` is always the finding's own and is never "mixed", so nothing is actually lost.
 *
 *   `properties.expected` IS `null`, NOT ABSENT, when a rule offered no replacement (design
 *   §6: `expected?.value ?? null`). "There is genuinely nothing to offer" is a statement the
 *   engine makes deliberately (`packages/fg-analyzer-engine/src/domain/findings.ts:19-21`);
 *   an absent key would read as "not computed".
 */
import type { Finding, RuleCatalogEntry, Severity } from "@smart-tools/fg-analyzer-engine";

import { projectRootUri, toPosix } from "./text.ts";

/** The SARIF `level` enumeration, minus `none` which nothing here produces. */
export type SarifLevel = "error" | "warning" | "note";

export const SARIF_SCHEMA_URI = "https://json.schemastore.org/sarif-2.1.0.json";
export const SARIF_VERSION = "2.1.0";
export const SARIF_INFORMATION_URI = "https://github.com/smart-tools/frontend-guard";
/** The one `originalUriBaseIds` key every location is expressed against. */
export const SARIF_URI_BASE_ID = "%SRCROOT%";

export interface SarifRule {
  readonly id: string;
  readonly shortDescription: { readonly text: string };
  readonly defaultConfiguration: { readonly level: SarifLevel };
  readonly properties: { readonly category: string };
}

export interface SarifResult {
  readonly ruleId: string;
  readonly ruleIndex?: number;
  readonly level: SarifLevel;
  readonly message: { readonly text: string };
  readonly locations: readonly {
    readonly physicalLocation: {
      readonly artifactLocation: { readonly uri: string; readonly uriBaseId: string };
      readonly region: { readonly startLine: number; readonly startColumn: number };
    };
  }[];
  readonly partialFingerprints: { readonly impactKey: string };
  readonly properties: {
    readonly subkind: string | null;
    readonly confidence: number;
    readonly category: string;
    readonly actual: string;
    readonly expected: string | null;
  };
}

export interface SarifLog {
  readonly $schema: string;
  readonly version: string;
  readonly runs: readonly {
    readonly tool: {
      readonly driver: {
        readonly name: string;
        readonly version: string;
        readonly informationUri: string;
        readonly rules: readonly SarifRule[];
      };
    };
    readonly originalUriBaseIds: Readonly<Record<string, { readonly uri: string }>>;
    readonly results: readonly SarifResult[];
  }[];
}

/** A finding's own severity. `info` and `candidate` are both "note" — SARIF has no fourth. */
export function sarifLevelOf(severity: Severity): SarifLevel {
  switch (severity) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "info":
    case "candidate":
      return "note";
  }
}

/** A catalog entry's declared default. See the `mixed` note in this file's header. */
export function sarifDefaultLevelOf(builtinSeverity: Severity | "mixed"): SarifLevel {
  return builtinSeverity === "mixed" ? "warning" : sarifLevelOf(builtinSeverity);
}

export interface SarifOptions {
  readonly projectRoot: string;
  readonly catalog: readonly RuleCatalogEntry[];
  readonly tool: { readonly name: string; readonly version: string };
}

/**
 * The document as an object, exported so the structural test can inspect the tree the
 * serialiser was handed rather than one it re-parsed out of a string.
 */
export function sarifLogOf(findings: readonly Finding[], options: SarifOptions): SarifLog {
  const rules: readonly SarifRule[] = options.catalog.map((entry) => ({
    id: entry.id,
    shortDescription: { text: entry.description },
    defaultConfiguration: { level: sarifDefaultLevelOf(entry.builtinSeverity) },
    properties: { category: entry.category },
  }));
  // One pass over the catalog instead of an `indexOf` per finding: a run with the EDS adapter
  // has 32 rules and a large project has thousands of findings.
  const indexOfRule = new Map(rules.map((rule, index) => [rule.id, index] as const));

  const results = findings.map((finding): SarifResult => {
    const index = indexOfRule.get(finding.rule);
    const head =
      index === undefined ? { ruleId: finding.rule } : { ruleId: finding.rule, ruleIndex: index };
    return {
      ...head,
      level: sarifLevelOf(finding.severity),
      message: { text: finding.why },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: toPosix(finding.file), uriBaseId: SARIF_URI_BASE_ID },
            region: { startLine: finding.line, startColumn: finding.column },
          },
        },
      ],
      partialFingerprints: { impactKey: finding.impactKey },
      properties: {
        subkind: finding.subkind,
        confidence: finding.confidence,
        category: finding.category,
        actual: finding.actual,
        expected: finding.expected?.value ?? null,
      },
    };
  });

  return {
    $schema: SARIF_SCHEMA_URI,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: options.tool.name,
            version: options.tool.version,
            informationUri: SARIF_INFORMATION_URI,
            rules,
          },
        },
        originalUriBaseIds: { [SARIF_URI_BASE_ID]: { uri: projectRootUri(options.projectRoot) } },
        results,
      },
    ],
  };
}

export function formatSarif(findings: readonly Finding[], options: SarifOptions): string {
  // 2-space JSON (design §6). Unlike `json`, a SARIF file is routinely opened by a human
  // before it reaches a viewer, and the key order is the literal order above either way.
  return JSON.stringify(sarifLogOf(findings, options), null, 2);
}
