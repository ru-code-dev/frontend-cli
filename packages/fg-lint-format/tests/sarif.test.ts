/**
 * `sarif` — SARIF 2.1.0.
 *
 * The design asks for "a structural zod schema check of the required members". `zod` is NOT
 * resolvable from this package — its only dependency is `@smart-tools/fg-analyzer-engine`, the
 * manifests are the orchestrator's to edit, and a transitive `zod` under the engine is not on
 * this package's resolution path (checked with `require.resolve("zod", { paths: [<this
 * package>] })`, which throws). So the check below is the same check, hand-written: a walker
 * over the required members that collects EVERY violation rather than throwing on the first,
 * so a broken document reports all of its problems in one run the way a schema would. Only
 * the required members are checked — extra keys are allowed, as SARIF itself allows them.
 *
 * MUTATION CHECKS ACTUALLY RUN (patch applied, suite run, patch reverted — see the report):
 *  - `uriBaseId` dropped from `artifactLocation` (`src/sarif.ts:140`) — 4 fail, including
 *    "validates against the required SARIF 2.1.0 members".
 *  - `ruleIndex` fixed at `0` (`src/sarif.ts:132`) — 3 fail, including "`ruleIndex` addresses
 *    the rule the result belongs to".
 *  - `toPosix` dropped from the location uri (`src/sarif.ts:140`) — 1 fails: "turns Windows
 *    separators into URI slashes".
 *  - `sarifLevelOf` mapping `candidate` to `warning` (`src/sarif.ts:98`) — 3 fail, including
 *    "maps the four severities onto SARIF's three levels".
 *  - the trailing `/` removed from `projectRootUri` (`src/text.ts:41`) — 6 fail, including
 *    "publishes the project root as a base URI".
 */
import { describe, expect, it } from "vite-plus/test";

import { formatLint, SARIF_URI_BASE_ID, sarifLogOf } from "../src/index.ts";
import {
  FIXTURE_CATALOG,
  FIXTURE_FINDINGS,
  PROJECT_ROOT,
  UNCATALOGUED_FINDING,
  WINDOWS_FINDING,
} from "./fixtures/findings.ts";
import { golden } from "./fixtures/golden.ts";

const BASE = {
  findings: FIXTURE_FINDINGS,
  catalog: FIXTURE_CATALOG,
  projectRoot: PROJECT_ROOT,
  tool: { name: "fg", version: "1.0.0" },
  lang: "ru",
} as const;

const log = (findings: readonly (typeof FIXTURE_FINDINGS)[number][] = FIXTURE_FINDINGS) =>
  sarifLogOf(findings, {
    projectRoot: PROJECT_ROOT,
    catalog: FIXTURE_CATALOG,
    tool: { name: "fg", version: "1.0.0" },
  });

/* ──────────────── the structural check, standing in for a zod schema ──────────────── */

const SARIF_LEVELS = new Set(["none", "note", "warning", "error"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns one message per violated requirement; `[]` means the document is well-formed. */
export function sarifViolations(document: unknown): readonly string[] {
  const bad: string[] = [];
  const need = (ok: boolean, message: string): void => {
    if (!ok) bad.push(message);
  };
  const str = (holder: Record<string, unknown>, key: string, where: string): string | undefined => {
    const value = holder[key];
    if (typeof value !== "string" || value === "") {
      need(false, `${where}.${key} must be a non-empty string`);
      return undefined;
    }
    return value;
  };
  const int = (holder: Record<string, unknown>, key: string, where: string): void => {
    const value = holder[key];
    need(
      typeof value === "number" && Number.isInteger(value) && value > 0,
      `${where}.${key} must be a positive integer`,
    );
  };

  if (!isRecord(document)) return ["document must be an object"];
  need(
    document["$schema"] === "https://json.schemastore.org/sarif-2.1.0.json",
    "$schema must be the SARIF 2.1.0 schema uri",
  );
  need(document["version"] === "2.1.0", 'version must be "2.1.0"');

  const runs = document["runs"];
  if (!Array.isArray(runs) || runs.length !== 1)
    return [...bad, "runs must be an array with exactly one run"];
  const run: unknown = runs[0];
  if (!isRecord(run)) return [...bad, "runs[0] must be an object"];

  const tool = run["tool"];
  const driver = isRecord(tool) ? tool["driver"] : undefined;
  const ruleIds: string[] = [];
  if (!isRecord(driver)) {
    need(false, "runs[0].tool.driver must be an object");
  } else {
    str(driver, "name", "tool.driver");
    str(driver, "version", "tool.driver");
    str(driver, "informationUri", "tool.driver");
    const rules = driver["rules"];
    if (!Array.isArray(rules)) {
      need(false, "tool.driver.rules must be an array");
    } else {
      rules.forEach((rule: unknown, index) => {
        const where = `tool.driver.rules[${index}]`;
        if (!isRecord(rule)) return need(false, `${where} must be an object`);
        const id = str(rule, "id", where);
        ruleIds.push(id ?? "");
        const shortDescription = rule["shortDescription"];
        if (isRecord(shortDescription)) str(shortDescription, "text", `${where}.shortDescription`);
        else need(false, `${where}.shortDescription must be an object`);
        const config = rule["defaultConfiguration"];
        if (isRecord(config))
          need(
            SARIF_LEVELS.has(String(config["level"])),
            `${where}.defaultConfiguration.level must be a SARIF level`,
          );
        else need(false, `${where}.defaultConfiguration must be an object`);
        const properties = rule["properties"];
        if (isRecord(properties)) str(properties, "category", `${where}.properties`);
        else need(false, `${where}.properties must be an object`);
      });
    }
  }

  const bases = run["originalUriBaseIds"];
  if (!isRecord(bases)) {
    need(false, "runs[0].originalUriBaseIds must be an object");
  } else {
    const base = bases[SARIF_URI_BASE_ID];
    if (!isRecord(base))
      need(false, `originalUriBaseIds["${SARIF_URI_BASE_ID}"] must be an object`);
    else {
      const uri = str(base, "uri", `originalUriBaseIds["${SARIF_URI_BASE_ID}"]`);
      need(uri === undefined || uri.startsWith("file:///"), "the base uri must be a file:// uri");
      need(uri === undefined || uri.endsWith("/"), "the base uri must end with a slash");
    }
  }

  const results = run["results"];
  if (!Array.isArray(results)) return [...bad, "runs[0].results must be an array"];
  results.forEach((result: unknown, index) => {
    const where = `results[${index}]`;
    if (!isRecord(result)) return need(false, `${where} must be an object`);
    const ruleId = str(result, "ruleId", where);
    if ("ruleIndex" in result) {
      const ruleIndex = result["ruleIndex"];
      need(
        typeof ruleIndex === "number" && Number.isInteger(ruleIndex) && ruleIndex >= 0,
        `${where}.ruleIndex must be a non-negative integer`,
      );
      need(
        typeof ruleIndex === "number" && ruleIds[ruleIndex] === ruleId,
        `${where}.ruleIndex must address the rule named by ruleId`,
      );
    }
    need(SARIF_LEVELS.has(String(result["level"])), `${where}.level must be a SARIF level`);
    const message = result["message"];
    if (isRecord(message)) str(message, "text", `${where}.message`);
    else need(false, `${where}.message must be an object`);

    const locations = result["locations"];
    if (!Array.isArray(locations) || locations.length === 0) {
      need(false, `${where}.locations must be a non-empty array`);
    } else {
      locations.forEach((location: unknown, li) => {
        const lw = `${where}.locations[${li}].physicalLocation`;
        const physical = isRecord(location) ? location["physicalLocation"] : undefined;
        if (!isRecord(physical)) return need(false, `${lw} must be an object`);
        const artifact = physical["artifactLocation"];
        if (!isRecord(artifact)) need(false, `${lw}.artifactLocation must be an object`);
        else {
          const uri = str(artifact, "uri", `${lw}.artifactLocation`);
          need(
            uri === undefined || !uri.includes("\\"),
            `${lw}.artifactLocation.uri must not contain a backslash`,
          );
          need(
            artifact["uriBaseId"] === SARIF_URI_BASE_ID,
            `${lw}.artifactLocation.uriBaseId must be ${SARIF_URI_BASE_ID}`,
          );
        }
        const region = physical["region"];
        if (!isRecord(region)) need(false, `${lw}.region must be an object`);
        else {
          int(region, "startLine", `${lw}.region`);
          int(region, "startColumn", `${lw}.region`);
        }
      });
    }

    const fingerprints = result["partialFingerprints"];
    if (isRecord(fingerprints)) str(fingerprints, "impactKey", `${where}.partialFingerprints`);
    else need(false, `${where}.partialFingerprints must be an object`);

    const properties = result["properties"];
    if (!isRecord(properties)) {
      need(false, `${where}.properties must be an object`);
    } else {
      for (const key of ["subkind", "confidence", "category", "actual", "expected"]) {
        need(key in properties, `${where}.properties.${key} must be present`);
      }
      need(
        typeof properties["confidence"] === "number",
        `${where}.properties.confidence must be a number`,
      );
    }
  });

  return bad;
}

/* ─────────────────────────────────────── the suite ─────────────────────────────────────── */

describe("sarif", () => {
  it("matches the golden document", () => {
    expect(formatLint("sarif", BASE).text).toBe(golden("sarif.txt"));
  });

  it("validates against the required SARIF 2.1.0 members", () => {
    expect(sarifViolations(JSON.parse(formatLint("sarif", BASE).text))).toEqual([]);
  });

  it("the validator has teeth — a missing uriBaseId is reported, not tolerated", () => {
    const broken = JSON.parse(formatLint("sarif", BASE).text) as {
      runs: {
        results: {
          locations: { physicalLocation: { artifactLocation: Record<string, unknown> } }[];
        }[];
      }[];
    };
    const artifact = broken.runs[0]?.results[0]?.locations[0]?.physicalLocation.artifactLocation;
    if (artifact === undefined) throw new Error("unreachable");
    delete artifact["uriBaseId"];
    expect(sarifViolations(broken).length).toBeGreaterThan(0);
  });

  it("publishes the whole catalog as `tool.driver.rules`, in catalog order", () => {
    const rules = log().runs[0]?.tool.driver.rules ?? [];
    expect(rules.map((r) => r.id)).toEqual(FIXTURE_CATALOG.map((e) => e.id));
    expect(rules).toHaveLength(FIXTURE_CATALOG.length);
  });

  it("maps a catalog entry's `mixed` built-in severity onto SARIF's `warning` default", () => {
    const rules = log().runs[0]?.tool.driver.rules ?? [];
    const byId = new Map(rules.map((r) => [r.id, r.defaultConfiguration.level] as const));
    // `token.literal.color` and `a11y.lint` are "mixed" in the fixture catalog.
    expect(byId.get("token.literal.color")).toBe("warning");
    expect(byId.get("a11y.lint")).toBe("warning");
    expect(byId.get("token.tier.violation")).toBe("error");
    expect(byId.get("style.override.size")).toBe("note");
    expect(byId.get("component.duplicate")).toBe("note");
  });

  it("`ruleIndex` addresses the rule the result belongs to", () => {
    const run = log().runs[0];
    if (run === undefined) throw new Error("unreachable");
    for (const result of run.results) {
      expect(result.ruleIndex).toBeDefined();
      expect(run.tool.driver.rules[result.ruleIndex ?? -1]?.id).toBe(result.ruleId);
    }
    // …and it is not trivially 0/ascending: the fixture catalog is ordered by category, the
    // findings by file.
    expect(run.results.map((r) => r.ruleIndex)).toEqual([6, 5, 2, 3, 1, 0]);
  });

  it("names the rule but omits `ruleIndex` when the catalog does not list it", () => {
    const run = log([UNCATALOGUED_FINDING]).runs[0];
    const result = run?.results[0];
    expect(result?.ruleId).toBe("future.rule.nobody.declared");
    expect(result === undefined ? true : "ruleIndex" in result).toBe(false);
    expect(sarifViolations(JSON.parse(JSON.stringify(log([UNCATALOGUED_FINDING]))))).toEqual([]);
  });

  it("maps the four severities onto SARIF's three levels", () => {
    expect(log().runs[0]?.results.map((r) => r.level)).toEqual([
      "error", // error
      "warning", // warning
      "note", // info
      "note", // candidate
      "error",
      "warning",
    ]);
  });

  it("locates every result relative to the base id, never absolutely", () => {
    const run = log().runs[0];
    if (run === undefined) throw new Error("unreachable");
    for (const result of run.results) {
      const artifact = result.locations[0]?.physicalLocation.artifactLocation;
      expect(artifact?.uriBaseId).toBe("%SRCROOT%");
      expect(artifact?.uri.startsWith("/")).toBe(false);
    }
    expect(run.results.map((r) => r.locations[0]?.physicalLocation.artifactLocation.uri)).toEqual(
      FIXTURE_FINDINGS.map((f) => f.file),
    );
  });

  it("publishes the project root as a base URI, with the trailing slash a base URI needs", () => {
    expect(log().runs[0]?.originalUriBaseIds["%SRCROOT%"]?.uri).toBe(
      "file:///home/dev/projects/shop/",
    );
  });

  it("turns Windows separators into URI slashes", () => {
    const uri = log([WINDOWS_FINDING]).runs[0]?.results[0]?.locations[0]?.physicalLocation
      .artifactLocation.uri;
    expect(uri).toBe("src/legacy/Old.tsx");
    const fromWindowsRoot = sarifLogOf([WINDOWS_FINDING], {
      projectRoot: "C:\\work\\shop",
      catalog: FIXTURE_CATALOG,
      tool: { name: "fg", version: "1.0.0" },
    });
    expect(fromWindowsRoot.runs[0]?.originalUriBaseIds["%SRCROOT%"]?.uri).toBe(
      "file:///C:/work/shop/",
    );
  });

  it("carries the fingerprint and the finding's own facts in `properties`", () => {
    const result = log().runs[0]?.results[1];
    expect(result?.partialFingerprints).toEqual({ impactKey: "a11y.lint:alt-text" });
    expect(result?.properties).toEqual({
      subkind: "alt-text",
      confidence: 1,
      category: "a11y",
      actual: "<img src={icon} />",
      expected: null,
    });
    expect(log().runs[0]?.results[2]?.properties.expected).toBe("var(--eds-size-m)");
  });

  it("is a run with no results when there is nothing to report", () => {
    const text = formatLint("sarif", { ...BASE, findings: [] }).text;
    const parsed = JSON.parse(text) as { runs: { results: unknown[] }[] };
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0]?.results).toEqual([]);
    expect(sarifViolations(parsed)).toEqual([]);
  });

  it("is never coloured, whatever the caller asks for", () => {
    expect(formatLint("sarif", { ...BASE, color: true }).text).toBe(formatLint("sarif", BASE).text);
  });
});
