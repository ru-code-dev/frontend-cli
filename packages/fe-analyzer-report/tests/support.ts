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

import type { AnalyzerResult, EngineFinding } from "../src/index.ts";

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
