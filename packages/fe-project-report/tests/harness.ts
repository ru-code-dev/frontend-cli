/**
 * The tier-1 harness: a `CommandContext` that captures instead of printing, a real-shaped
 * engine result, and scratch space.
 *
 * Scratch space is `mkdtemp` under `os.tmpdir()` rather than `@smart-tools/fe-testkit`'s
 * `makeTempDir`: that package is a devDependency of `cli` and of nothing else in
 * `packages/`, and taking it on here would add a workspace edge for two lines of code that
 * `node:fs/promises` already provides. `packages/fe-source/tests/fixtures/scratch.ts:96-119`
 * makes the same call for the same reason.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AnalyzerResult } from "@smart-tools/fe-analyzer-engine";
import type { CommandContext, Lang } from "@smart-tools/fe-cli-kit";

export interface Capture {
  readonly ctx: CommandContext;
  readonly out: string[];
  readonly err: string[];
}

/**
 * A context carrying only what a command may read. `env` and `flags` are EMPTY: this command
 * reads neither, and an empty pair is the enforcement — a future edit that starts reading a
 * setting fails the suite instead of silently depending on the runner's environment.
 */
export function capture(
  fields: {
    readonly source?: string | undefined;
    readonly out?: string | undefined;
    readonly lang?: Lang | undefined;
  } = {},
): Capture {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: CommandContext = {
    source: fields.source,
    out: fields.out,
    lang: fields.lang ?? "ru",
    env: {},
    flags: {},
    stdout: (s) => void out.push(s),
    stderr: (s) => void err.push(s),
  };
  return { ctx, out, err };
}

/** Everything written to a stream, joined — the assertions read one string, not an array. */
export const text = (chunks: readonly string[]): string => chunks.join("");

/**
 * An engine result of the REAL shape.
 *
 * Every field is the one `analyzerResultSchema` requires
 * (`packages/fe-analyzer-engine/src/domain/findings.ts:99-186`), so the payload built from it
 * exercises the same mapping a real scan would. Two findings, deliberately of different
 * severity and category, so the summary line's counts cannot all be the same number and a
 * transposed pair of arguments would show.
 */
export const ENGINE_RESULT: AnalyzerResult = {
  $schema: "fe-analyzer-engine/analysis@1",
  domains: ["a11y", "components", "icons"],
  findings: [
    {
      id: "f1",
      rule: "a11y.name.missing",
      subkind: "iconOnly",
      category: "a11y",
      severity: "error",
      confidence: 1,
      file: "src/App.tsx",
      line: 7,
      column: 5,
      snippet: {
        before: '<button className="icon-button" />',
        after: null,
        highlightLine: 1,
        startLine: 7,
      },
      actual: "<button>",
      expected: null,
      why: "кнопка без доступного имени",
      note: null,
      rootCause: null,
      appliedTo: null,
      a11y: { wcag: ["4.1.2"], pattern: null, impact: "скринридер объявит «кнопка»", fix: null },
      autoFixable: false,
      needsAgent: false,
      candidates: [],
      impact: { occurrences: 1, files: 1 },
      impactKey: "a11y.name.missing|button",
    },
    {
      id: "f2",
      rule: "icon.foreign-pack",
      subkind: null,
      category: "icon",
      severity: "warning",
      confidence: 0.9,
      file: "src/Icons.tsx",
      line: 2,
      column: 1,
      snippet: {
        before: 'import { Check } from "lucide-react";',
        after: null,
        highlightLine: 1,
        startLine: 2,
      },
      actual: "lucide-react",
      expected: null,
      why: "иконки из стороннего пакета",
      note: null,
      rootCause: null,
      appliedTo: null,
      a11y: null,
      autoFixable: false,
      needsAgent: false,
      candidates: [],
      impact: { occurrences: 1, files: 1 },
      impactKey: "icon.foreign-pack|lucide-react",
    },
  ],
  summary: {
    files: { scanned: 9, clean: 7 },
    findings: {
      total: 2,
      bySeverity: { error: 1, warning: 1, info: 0, candidate: 0 },
      byRule: { "a11y.name.missing": 1, "icon.foreign-pack": 1 },
      byCategory: { a11y: 1, icon: 1, component: 0 },
      autoFixable: 0,
      needsAgent: 0,
    },
    limitations: [],
  },
};

/** A scratch directory and the way back out of it. */
export async function scratch(): Promise<{ dir: string; remove: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "fe-project-report-test-"));
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) };
}
