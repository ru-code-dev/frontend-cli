/**
 * Shared fixtures for the tier-1 suites.
 *
 * The template tests read the REAL build output rather than a stub: the property under test
 * ("one file, no network, these panels and not those") is a property of the artifact this
 * package ships, and a stub would prove nothing about it. `pnpm build` therefore has to have
 * run — the loader below says so in one sentence instead of failing with ENOENT.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AnalyzerResult, EngineFinding, EngineUsage } from "../src/index.ts";

export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const templatePath = join(packageRoot, "dashboard", "dist", "index.html");
export const bundlePath = join(packageRoot, "dist", "index.mjs");

const readBuilt = (path: string, how: string): string => {
  if (!existsSync(path)) {
    throw new Error(
      `${path} is missing — run \`${how}\` first (the tier-1 lane asserts on the real build).`,
    );
  }
  return readFileSync(path, "utf8");
};

export const builtTemplate = (): string =>
  readBuilt(templatePath, "pnpm --filter @smart-tools/fe-analyzer-report build");

export const builtBundle = (): string =>
  readBuilt(bundlePath, "pnpm --filter @smart-tools/fe-analyzer-report build");

/** A finding with every required field and nothing optional — the mapping's floor. */
export const minimalFinding: EngineFinding = {
  id: "a11y.name.missing:src/Button.tsx:12",
  rule: "a11y.name.missing",
  category: "a11y",
  severity: "error",
  file: "src/Button.tsx",
  line: 12,
  column: 5,
  snippet: { before: "<button onClick={close} />", after: null, highlightLine: 1, startLine: 12 },
  actual: "<button>",
  why: "Контрол без доступного имени",
  autoFixable: false,
  impact: { occurrences: 1, files: 1 },
  impactKey: "a11y.name.missing:button",
};

export const resultOf = (findings: readonly EngineFinding[]): AnalyzerResult => ({
  findings,
  summary: { files: { scanned: 10, clean: 9 } },
  project: { name: "demo", root: "/tmp/demo" },
});

/**
 * One `usage` block, of the shape the engine emits when an adapter is connected.
 *
 * Small but not empty: every list has exactly one entry, so a mapping that dropped a field
 * would show as a missing value rather than as an empty array that looks plausible. The
 * numbers are arbitrary; only their arrival intact is the subject.
 */
export const engineUsage: EngineUsage = {
  components: [
    { name: "Button", usages: 4, files: 2, findings: 1, overrides: 1, props: { size: { m: 3 } } },
  ],
  unusedComponents: ["Drawer"],
  foreignComponents: [{ name: "DatePicker", usages: 2, local: false, source: "some-picker" }],
  customComponents: [
    {
      name: "Card",
      file: "src/Card.tsx",
      line: 3,
      usages: 5,
      files: 3,
      props: ["title"],
      kitComponentsUsed: ["Button"],
      hasInlineSvg: false,
      snippet: "const Card = () => <div />;",
      verdict: "kit-candidate",
      nameMatch: null,
      tokenRefs: 2,
      hardcodedValues: 1,
      tokenVerdict: "mixed",
    },
  ],
  elementBreakdown: {
    total: 10,
    kit: 4,
    kitClean: 3,
    customTokens: 2,
    customMixed: 1,
    customHardcode: 1,
    customUnstyled: 1,
    foreign: 1,
  },
  tokenUsage: { "--x-color-fg": 7 },
};

/** The adapter-gated half of a summary, as the engine emits it beside {@link engineUsage}. */
export const engineKitSummary = {
  healthScore: 71,
  healthFormula: "50% чистота · 30% внедрение · 20% токены",
  adoption: 0.4,
  tokenCoverage: 0.62,
  kitGaps: [{ value: "#ff0000", token: "--x-color-danger", role: "background", occurrences: 2 }],
} as const;

/** The same result {@link resultOf} builds, with everything an adapter adds. */
export const kitResultOf = (findings: readonly EngineFinding[]): AnalyzerResult => ({
  findings,
  summary: { ...engineKitSummary, files: { scanned: 10, clean: 9 } },
  usage: engineUsage,
  project: { name: "demo", root: "/tmp/demo" },
});
